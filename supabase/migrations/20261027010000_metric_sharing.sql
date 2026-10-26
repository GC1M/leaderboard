-- Per-group, per-metric sharing (issue #16). Health access (granted on the phone) and sharing (stored
-- here) are separate: a row means "show my <metric> to this group"; no row means not shared.
--   steps:  daily totals, readable directly and ranked by group_leaderboard().
--   sleep:  daily asleep minutes only, never the asleep window, via group_sleep().
--   weight: latest reading and goal progress, via group_latest_weight() and group_leaderboard().
-- Steps are shared on join, as before this change (a steps group is what people join); members can
-- turn it off. Sleep and weight are never shared without an explicit opt-in.
-- Leaving or being removed from a group drops its shares (cascade from group_members).
create table public.metric_shares (
  group_id uuid not null,
  user_id uuid not null,
  metric text not null check (metric in ('steps', 'sleep', 'weight')),
  created_at timestamptz not null default now(),
  primary key (group_id, user_id, metric),
  foreign key (group_id, user_id) references public.group_members on delete cascade
);
create index on public.metric_shares (user_id, metric);

alter table public.metric_shares enable row level security;
-- Members see who shares what in their groups (to tell "not sharing" from "no data"); only the
-- member themselves can turn a share on or off. Owners cannot.
create policy metric_shares_select on public.metric_shares for select to authenticated
  using (public.is_group_member(group_id));
create policy metric_shares_insert on public.metric_shares for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy metric_shares_delete on public.metric_shares for delete to authenticated
  using (user_id = (select auth.uid()));

-- Existing members keep sharing steps exactly as before; nothing else is shared.
insert into public.metric_shares (group_id, user_id, metric)
select group_id, user_id, 'steps' from public.group_members;

create function public.share_steps_on_join() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.metric_shares (group_id, user_id, metric) values (new.group_id, new.user_id, 'steps')
  on conflict do nothing;
  return new;
end $$;

create trigger group_members_share_steps after insert on public.group_members
  for each row execute function public.share_steps_on_join();

-- True when p_user_id shares p_metric with at least one group the caller is in.
create function public.shares_metric_with(p_user_id uuid, p_metric text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.group_members me
    join public.metric_shares s on s.group_id = me.group_id
    where me.user_id = (select auth.uid()) and s.user_id = p_user_id and s.metric = p_metric
  );
$$;

-- Steps need a steps share. Sleep rows hold the asleep window, so peers never read them directly
-- (group_sleep() returns the minutes only). Workout and screen time are unchanged (not Phase 1).
drop policy daily_metrics_select on public.daily_metrics;
create policy daily_metrics_select on public.daily_metrics for select to authenticated
  using (
    user_id = (select auth.uid())
    or (metric = 'steps' and public.shares_metric_with(user_id, 'steps'))
    or (metric in ('workout_minutes', 'screen_min') and public.shares_group_with(user_id))
  );

-- Daily asleep minutes for members who share sleep with this group.
create function public.group_sleep(p_group_id uuid, p_from date, p_to date)
returns table (user_id uuid, date date, minutes numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_group_member(p_group_id) then
    raise exception 'not a member of this group';
  end if;
  return query
  select dm.user_id, dm.date, dm.value
  from public.daily_metrics dm
  join public.metric_shares s on s.user_id = dm.user_id and s.group_id = p_group_id and s.metric = 'sleep'
  where dm.metric = 'sleep_min' and dm.date between p_from and p_to
  order by dm.date, dm.user_id;
end $$;

-- Latest weight reading for members who share weight with this group. Same order as latest_weight.
create function public.group_latest_weight(p_group_id uuid)
returns table (user_id uuid, measured_at timestamptz, kg numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_group_member(p_group_id) then
    raise exception 'not a member of this group';
  end if;
  return query
  select distinct on (wm.user_id) wm.user_id, wm.measured_at, wm.kg
  from public.weight_measurements wm
  join public.metric_shares s on s.user_id = wm.user_id and s.group_id = p_group_id and s.metric = 'weight'
  order by wm.user_id, wm.measured_at desc, (wm.source = 'manual') desc, wm.updated_at desc, wm.id desc;
end $$;

-- Same as before except steps and weight progress only count for members who share that metric with
-- this group (the caller always sees their own). Non-sharers rank last like members with no data.
create or replace function public.group_leaderboard(p_group_id uuid, p_metric text, p_period text)
returns table (user_id uuid, display_name text, value numeric, rank bigint)
language plpgsql stable security definer set search_path = '' as $$
declare
  tz text;
  today date;
  d_from date;
  d_to date;
  share_key text;
begin
  if not public.is_group_member(p_group_id) then
    raise exception 'not a member of this group';
  end if;
  if p_metric not in ('steps', 'workout_minutes', 'weight_kg', 'screen_min') then
    raise exception 'invalid metric';
  end if;
  if p_period not in ('day', 'week') then
    raise exception 'invalid period';
  end if;
  share_key := case p_metric when 'steps' then 'steps' when 'weight_kg' then 'weight' end;

  select p.timezone into tz from public.profiles p where p.id = auth.uid();
  today := (now() at time zone coalesce(tz, 'UTC'))::date;
  if p_period = 'day' then
    d_from := today; d_to := today;
  else
    d_from := date_trunc('week', today)::date; d_to := d_from + 6;
  end if;

  return query
  with vals as (
    select m.user_id as uid, p.display_name as name,
      case when share_key is not null and m.user_id <> auth.uid() and not exists (
        select 1 from public.metric_shares s
        where s.group_id = p_group_id and s.user_id = m.user_id and s.metric = share_key
      ) then null
      when p_metric = 'weight_kg' then (
        select least(100, greatest(0,
          (g.start_value - w.kg) / nullif(g.start_value - g.target_value, 0) * 100))
        from public.goals g
        cross join lateral (
          select wm.kg from public.weight_measurements wm
          where wm.user_id = m.user_id
            and (wm.measured_at at time zone p.timezone)::date between g.start_date and d_to
          order by wm.measured_at desc, (wm.source = 'manual') desc, wm.updated_at desc, wm.id desc
          limit 1
        ) w
        where g.user_id = m.user_id and g.metric = 'weight_kg'
          and g.start_date <= today and coalesce(g.end_date, 'infinity') >= today
        order by g.start_date desc limit 1
      ) else (
        select sum(dm.value) from public.daily_metrics dm
        where dm.user_id = m.user_id and dm.metric = p_metric and dm.date between d_from and d_to
      ) end as v
    from public.group_members m
    join public.profiles p on p.id = m.user_id
    where m.group_id = p_group_id
  )
  select vals.uid, vals.name, coalesce(vals.v, 0)::numeric,
    rank() over (order by (vals.v is null), coalesce(vals.v, 0) * (case when p_metric = 'screen_min' then -1 else 1 end) desc)
  from vals
  order by 4, 2;
end $$;

-- New functions are executable by public by default.
revoke execute on function
  public.share_steps_on_join(), public.shares_metric_with(uuid, text),
  public.group_sleep(uuid, date, date), public.group_latest_weight(uuid)
from public, anon;
grant execute on function
  public.shares_metric_with(uuid, text), public.group_sleep(uuid, date, date), public.group_latest_weight(uuid)
to authenticated;
