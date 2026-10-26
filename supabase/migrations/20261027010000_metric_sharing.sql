-- Per-group, per-metric sharing (issue #16). Health access (granted on the phone) and sharing (stored
-- here) are separate: a row means "show my <metric> to this group"; no row means not shared.
--   steps:  daily totals and their source, via group_steps() and group_leaderboard().
--   sleep:  daily asleep minutes only, never the asleep window, via group_sleep().
--   weight: latest reading (kg and local date) and goal progress, via group_latest_weight() and
--           group_leaderboard().
-- Peers never read daily_metrics steps or sleep directly: rows carry no group, so a direct read can't
-- honor a share given to one group and withheld from another.
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

-- Steps and sleep only through the group functions below. Workout and screen time are unchanged
-- (not Phase 1).
drop policy daily_metrics_select on public.daily_metrics;
create policy daily_metrics_select on public.daily_metrics for select to authenticated
  using (
    user_id = (select auth.uid())
    or (metric in ('workout_minutes', 'screen_min') and public.shares_group_with(user_id))
  );

-- Daily step totals for members who share steps with this group.
create function public.group_steps(p_group_id uuid, p_from date, p_to date)
returns table (user_id uuid, date date, steps numeric, source text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_group_member(p_group_id) then
    raise exception 'not a member of this group';
  end if;
  return query
  select dm.user_id, dm.date, dm.value, dm.source
  from public.daily_metrics dm
  join public.metric_shares s on s.user_id = dm.user_id and s.group_id = p_group_id and s.metric = 'steps'
  where dm.metric = 'steps' and dm.date between p_from and p_to
  order by dm.date, dm.user_id;
end $$;

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
-- Only the member's local date of the reading, not its exact time.
create function public.group_latest_weight(p_group_id uuid)
returns table (user_id uuid, measured_on date, kg numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_group_member(p_group_id) then
    raise exception 'not a member of this group';
  end if;
  return query
  select distinct on (wm.user_id) wm.user_id, (wm.measured_at at time zone p.timezone)::date, wm.kg
  from public.weight_measurements wm
  join public.profiles p on p.id = wm.user_id
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

-- Owners may only delete a member's manual steps. Sleep is private unless shared, and this function
-- would otherwise let an owner touch (and probe for) a member's manual sleep.
create or replace function public.delete_member_manual_entry(p_group_id uuid, p_user_id uuid, p_metric text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  member_today date;
begin
  if not exists (select 1 from public.groups g where g.id = p_group_id and g.owner_id = auth.uid()) then
    raise exception 'only the group owner can delete entries';
  end if;
  if p_metric = 'weight_kg' then
    raise exception 'weight entries cannot be deleted by the owner';
  end if;
  if p_metric <> 'steps' then
    raise exception 'only steps entries can be deleted by the owner';
  end if;
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = p_user_id) then
    raise exception 'not a member of this group';
  end if;
  select (now() at time zone p.timezone)::date into member_today from public.profiles p where p.id = p_user_id;
  delete from public.daily_metrics
  where user_id = p_user_id and date = member_today and metric = p_metric and source = 'manual';
  if not found then raise exception 'no manual entry for today'; end if;
end $$;

-- New functions are executable by public by default.
revoke execute on function
  public.share_steps_on_join(), public.group_steps(uuid, date, date),
  public.group_sleep(uuid, date, date), public.group_latest_weight(uuid)
from public, anon;
grant execute on function
  public.group_steps(uuid, date, date), public.group_sleep(uuid, date, date), public.group_latest_weight(uuid)
to authenticated;
