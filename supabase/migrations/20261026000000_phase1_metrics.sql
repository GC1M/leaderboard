-- Phase 1 metrics: daily steps, daily sleep, timestamped weight (issue #15).
--
-- Units: steps in steps, sleep in minutes, weight in kg. Convert for display only.
-- Dates: `daily_metrics.date` is the user's local calendar date on the device that measured it.
-- Sleep: one `sleep_min` row per wake-up date. All asleep time of sessions that end on that local
--   date counts, naps included; in-bed and awake time do not. `window_start`/`window_end` hold the
--   earliest asleep start and latest asleep end that make up the total.
-- Missing vs zero: no row means no reading. A row with value 0 is a recorded zero. Never write a 0
--   row for "no data". Pending/failed sync is client state and never reaches these tables.
-- Sync metadata: `updated_at` is when the server last received the value, never the measurement time.

alter table public.daily_metrics
  add column window_start timestamptz,
  add column window_end timestamptz,
  add constraint daily_metrics_window_check
    check ((window_start is null) = (window_end is null) and window_end >= window_start);

-- Sleep isn't shared with group-mates until per-metric sharing exists (issue #16).
drop policy daily_metrics_select on public.daily_metrics;
create policy daily_metrics_select on public.daily_metrics for select to authenticated
  using (
    user_id = (select auth.uid())
    or (metric <> 'sleep_min' and public.shares_group_with(user_id))
  );

-- Every reading is kept, several per day allowed. Re-importing the same reading (same time and
-- source) upserts instead of duplicating. Raw kg is private: only the owner can read it.
create table public.weight_measurements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles on delete cascade,
  measured_at timestamptz not null,
  kg numeric not null check (kg > 0 and kg < 1000),
  source text not null check (source in ('healthkit', 'health_connect', 'manual')),
  updated_at timestamptz not null default now(),
  unique (user_id, measured_at, source)
);

create trigger weight_measurements_touch before update on public.weight_measurements
  for each row execute function public.touch_updated_at();

alter table public.weight_measurements enable row level security;
create policy weight_measurements_all on public.weight_measurements for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Latest reading per user. Ties on measured_at: manual beats synced, then most recently received.
-- group_leaderboard() repeats this order; keep them in step.
create view public.latest_weight with (security_invoker = true) as
  select distinct on (user_id) user_id, measured_at, kg, source, updated_at
  from public.weight_measurements
  order by user_id, measured_at desc, (source = 'manual') desc, updated_at desc, id desc;

-- Move existing day-level weight. The time of day is unknown, so use local noon: it maps back to
-- the same date in the user's timezone.
insert into public.weight_measurements (user_id, measured_at, kg, source, updated_at)
select dm.user_id, (dm.date + time '12:00') at time zone p.timezone, dm.value, dm.source, dm.updated_at
from public.daily_metrics dm
join public.profiles p on p.id = dm.user_id
where dm.metric = 'weight_kg' and dm.value > 0;
delete from public.daily_metrics where metric = 'weight_kg';

-- Only after the move: adding the check validates existing rows, and weight_kg rows would fail it.
alter table public.daily_metrics
  drop constraint daily_metrics_metric_check,
  add constraint daily_metrics_metric_check
    check (metric in ('steps', 'sleep_min', 'workout_minutes', 'screen_min'));

-- Same as before except weight progress reads weight_measurements, dated in the member's timezone.
create or replace function public.group_leaderboard(p_group_id uuid, p_metric text, p_period text)
returns table (user_id uuid, display_name text, value numeric, rank bigint)
language plpgsql stable security definer set search_path = '' as $$
declare
  tz text;
  today date;
  d_from date;
  d_to date;
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
      case when p_metric = 'weight_kg' then (
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
