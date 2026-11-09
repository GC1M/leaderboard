-- Custom competitions: any supported metric, a start day up to 90 days back, late joins and three scoring modes.
-- Raw weight, food intake and sleep are never ranked. Every score is still computed here on the server from the
-- rows the imports and manual entry already wrote; a competition never re-imports anything.

-- The Group Info sharing switch a competition metric needs. Active days are built on steps, with workouts added
-- only for members who also share workouts.
create function public.competition_share_metric(p_metric text) returns text
language sql immutable set search_path = '' as $$
  select case p_metric when 'water_days_on_target' then 'water' when 'steps' then 'steps' when 'active_days' then 'steps' else 'workouts' end
$$;
revoke execute on function public.competition_share_metric(text) from public, anon, authenticated;

-- workout_count and workout_duration were never creatable (version 1 refused every metric but steps), so no row needs converting.
alter table public.competitions drop constraint competitions_metric_check;
alter table public.competitions add constraint competitions_metric_check
  check (metric in ('steps', 'workout_minutes', 'workout_count', 'water_days_on_target', 'active_days'));
alter table public.competitions
  add column late_joins boolean not null default false,
  add column scoring text not null default 'total' check (scoring in ('total', 'daily_average', 'best_streak'));
-- Existing steps competitions score exactly as before (total of counted steps), so version 1 keeps its number.
update public.competition_rules set rules = rules || '{
  "metrics": ["steps", "workout_minutes", "workout_count", "water_days_on_target", "active_days"],
  "never_ranked": ["weight", "food", "sleep"],
  "join": "before_start, or until the end when late_joins",
  "start": "up to 90 days back; past days are scored from imported history",
  "scoring": ["total", "daily_average", "best_streak"]
}' where version = 1;

create or replace function public.validate_competition() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from pg_timezone_names z where z.name = new.timezone) then
    raise exception 'invalid competition timezone';
  end if;
  if (new.starts_at at time zone new.timezone)::time <> time '00:00'
    or (new.ends_at at time zone new.timezone)::time <> time '00:00'
    or (new.ends_at at time zone new.timezone)::date - (new.starts_at at time zone new.timezone)::date not between 1 and 90 then
    raise exception 'competitions require 1 to 90 whole local calendar days';
  end if;
  if tg_op = 'INSERT' and (new.creator_id is null or not exists (
    select 1 from public.group_members m where m.group_id = new.group_id and m.user_id = new.creator_id
  )) then raise exception 'creator must belong to the group'; end if;
  if tg_op = 'UPDATE' and (new.group_id, new.metric, new.starts_at, new.ends_at, new.timezone, new.scoring_version, new.include_manual, new.name, new.late_joins, new.scoring)
    is distinct from (old.group_id, old.metric, old.starts_at, old.ends_at, old.timezone, old.scoring_version, old.include_manual, old.name, old.late_joins, old.scoring) then
    raise exception 'competition rules cannot be edited after creation';
  end if;
  return new;
end $$;

drop function public.create_competition(uuid, text, text, date, date, text, boolean);
-- The start day may be up to 90 days back. Those days are scored from the history already imported (and manual
-- entries when the competition counts them); nothing is re-imported. The last scoring day must still be today or
-- later, and a competition that has already started needs late joins on, or nobody could ever enrol in it.
create function public.create_competition(p_group_id uuid, p_name text, p_metric text, p_start_day date, p_end_day date, p_timezone text, p_include_manual boolean default false, p_late_joins boolean default false, p_scoring text default 'total')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_start timestamptz; v_end timestamptz;
begin
  if auth.uid() is null or not public.is_group_member(p_group_id) then raise exception 'not a member of this group'; end if;
  if p_metric is null or p_metric not in ('steps', 'workout_minutes', 'workout_count', 'water_days_on_target', 'active_days') then
    raise exception 'weight, food and sleep are never ranked; choose steps, workout minutes, workouts, water days or active days';
  end if;
  if p_scoring is null or p_scoring not in ('total', 'daily_average', 'best_streak') then raise exception 'scoring must be total, daily_average or best_streak'; end if;
  if not exists (select 1 from pg_timezone_names z where z.name = p_timezone) then raise exception 'invalid competition timezone'; end if;
  v_start := p_start_day::timestamp at time zone p_timezone;
  v_end := p_end_day::timestamp at time zone p_timezone;
  if p_start_day < (now() at time zone p_timezone)::date - 90 then raise exception 'the start day can be at most 90 days ago'; end if;
  if v_end <= now() then raise exception 'choose a last scoring day of today or later'; end if;
  if v_start <= now() and not coalesce(p_late_joins, false) then raise exception 'a competition that has already started needs late joins on'; end if;
  insert into public.competitions(group_id, creator_id, name, metric, starts_at, ends_at, timezone, include_manual, late_joins, scoring)
  values (p_group_id, auth.uid(), btrim(p_name), p_metric, v_start, v_end, p_timezone, p_include_manual, p_late_joins, p_scoring) returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.create_competition(uuid, text, text, date, date, text, boolean, boolean, text) from public, anon;
grant execute on function public.create_competition(uuid, text, text, date, date, text, boolean, boolean, text) to authenticated;

-- Late joins keep enrollment open until the end of the last scoring day; otherwise it still closes at the start.
create or replace function public.join_competition(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.competitions; tz text;
begin
  select * into c from public.competitions where id=p_id for update;
  if not found or auth.uid() is null or not public.is_group_member(c.group_id) then raise exception 'competition unavailable'; end if;
  if c.status <> 'scheduled' or (not c.late_joins and now() >= c.starts_at) then raise exception 'enrollment closes when the competition starts'; end if;
  if now() >= c.ends_at then raise exception 'enrollment closes after the last scoring day'; end if;
  if not exists(select 1 from public.metric_shares s where s.group_id=c.group_id and s.user_id=auth.uid() and s.metric=public.competition_share_metric(c.metric)) then
    raise exception 'enable sharing for this metric in Group Info before joining';
  end if;
  select timezone into tz from public.profiles where id=auth.uid();
  if c.metric in ('steps','active_days') and tz is distinct from c.timezone then raise exception 'your profile timezone must match the competition timezone'; end if;
  if exists(select 1 from public.competition_participants p where p.competition_id=p_id and p.user_id=auth.uid() and p.status='removed') then raise exception 'you were removed from this competition'; end if;
  insert into public.competition_participants(competition_id,user_id) values(p_id,auth.uid())
  on conflict(competition_id,user_id) do update set status='joined',joined_at=case when competition_participants.status='joined' then competition_participants.joined_at else now() end,departed_at=null;
end $$;

-- Scoring. Every source record is filed under a local day of the competition, then each day gets one value:
--   steps, workout_minutes, workout_count: the day's counted sum;
--   active_days: 1 when the day has counted steps above zero or a counted workout, else 0;
--   water_days_on_target: 1 when the day's counted water reaches the member's own daily target, else 0.
-- A day with nothing counted stays null (no data, not zero). The competition's scoring mode then turns the days into
-- one score: total sums them, daily_average divides the total by the days scored so far (today included, never only
-- the days that happen to have data), best_streak is the longest run of consecutive days above zero.
create or replace function public.competition_live_scores(p_id uuid)
returns table(user_id uuid,score numeric,eligibility text,manual_entries bigint,health_entries bigint,excluded_entries bigint,updated_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare c public.competitions; first_day date; last_day date; elapsed integer;
begin
  select * into c from public.competitions where id=p_id;
  if c.scoring_version is distinct from 1 then raise exception 'unsupported scoring version'; end if;
  first_day := (c.starts_at at time zone c.timezone)::date; last_day := (c.ends_at at time zone c.timezone)::date;
  elapsed := greatest(1, least(last_day, (now() at time zone c.timezone)::date + 1) - first_day);
  return query
  with people as (
    select p.user_id as uid,
      case when not exists(select 1 from public.group_members m where m.group_id=c.group_id and m.user_id=p.user_id) then 'left_group'
      when not exists(select 1 from public.metric_shares s where s.group_id=c.group_id and s.user_id=p.user_id and s.metric=public.competition_share_metric(c.metric)) then 'not_sharing'
      when c.metric in ('steps','active_days') and pr.timezone is distinct from c.timezone then 'timezone_mismatch'
      else 'eligible' end as allowed
    from public.competition_participants p join public.profiles pr on pr.id=p.user_id where p.competition_id=p_id and p.status='joined'
  ), readings as (
    select dm.user_id as uid,dm.date as day,dm.value as value,dm.source='manual' as manual,dm.updated_at as fresh
    from public.daily_metrics dm
    where c.metric in ('steps','active_days') and dm.metric='steps' and dm.date >= first_day and dm.date < last_day
    union all
    select w.user_id,(w.started_at at time zone c.timezone)::date,
      case when c.metric='workout_minutes' then coalesce(w.duration_s,extract(epoch from w.ended_at-w.started_at))/60 else 1::numeric end,
      w.source in ('manual','import'),w.updated_at
    from public.workouts w
    where c.metric in ('workout_count','workout_minutes','active_days') and w.started_at>=c.starts_at and w.started_at<c.ends_at and w.ended_at<=c.ends_at
      and (c.metric<>'active_days' or exists(select 1 from public.metric_shares s where s.group_id=c.group_id and s.user_id=w.user_id and s.metric='workouts'))
      -- Match the existing detailed-import overlap policy, after source eligibility is considered.
      and not(c.include_manual and w.source='healthkit' and exists(select 1 from public.workouts i where i.user_id=w.user_id and i.source='import' and i.started_at<w.ended_at and i.ended_at>w.started_at))
    union all
    select e.user_id,e.local_date,e.ml,e.source='manual',e.updated_at
    from public.water_entries e
    where c.metric='water_days_on_target' and e.local_date >= first_day and e.local_date < last_day
  ), days as (
    select r.uid,r.day,
      case when sum(r.value) filter(where c.include_manual or not r.manual) is null then null
        when c.metric='active_days' then sign(sum(r.value) filter(where c.include_manual or not r.manual))
        when c.metric='water_days_on_target' then (t.daily_ml is not null and sum(r.value) filter(where c.include_manual or not r.manual) >= t.daily_ml)::int::numeric
        else sum(r.value) filter(where c.include_manual or not r.manual) end as val,
      count(*) filter(where r.manual) as manuals,
      count(*) filter(where not r.manual) as health,
      count(*) filter(where r.manual and not c.include_manual) as excluded,
      max(r.fresh) filter(where c.include_manual or not r.manual) as fresh
    from readings r left join public.water_targets t on t.user_id=r.uid
    group by r.uid,r.day,t.daily_ml
  ), streaks as (
    select g.uid,max(g.n) as best from (
      select i.uid,count(*) as n from (
        select d.uid,d.day-(row_number() over(partition by d.uid order by d.day))::int as island from days d where d.val>0
      ) i group by i.uid,i.island
    ) g group by g.uid
  ), totals as (
    select p.uid,p.allowed,
      case when sum(d.val) is null then null
        when c.scoring='daily_average' then round(sum(d.val)/elapsed,1)
        when c.scoring='best_streak' then coalesce(max(st.best),0)::numeric
        else sum(d.val) end as total,
      coalesce(sum(d.manuals),0)::bigint as manuals,
      coalesce(sum(d.health),0)::bigint as health,
      coalesce(sum(d.excluded),0)::bigint as excluded,
      max(d.fresh) as fresh
    from people p left join days d on d.uid=p.uid left join streaks st on st.uid=p.uid group by p.uid,p.allowed
  )
  select t.uid,case when t.allowed='eligible' then t.total end,
    case when t.allowed<>'eligible' then t.allowed when t.total is not null then 'eligible' when t.excluded>0 then 'manual_entries_excluded' else 'no_data' end,
    case when t.allowed='eligible' then t.manuals else 0::bigint end,
    case when t.allowed='eligible' then t.health else 0::bigint end,
    case when t.allowed='eligible' then t.excluded else 0::bigint end,
    case when t.allowed='eligible' then t.fresh end
  from totals t;
end $$;

-- Owner-only explanations, now with the unit of each record: an active-days competition lists both steps and workouts.
drop function public.my_competition_contributions(uuid);
create function public.my_competition_contributions(p_id uuid)
returns table(record_id text,measured_on date,source text,value numeric,unit text,included boolean,reason text,flagged boolean,updated_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare c public.competitions; state text; tz text; shared boolean; shares_workouts boolean; first_day date; last_day date;
begin
  select * into c from public.competitions where id=p_id;
  if not found or auth.uid() is null or not public.is_group_member(c.group_id) then raise exception 'competition unavailable'; end if;
  select p.status into state from public.competition_participants p where p.competition_id=p_id and p.user_id=auth.uid();
  if state is null then return; end if;
  select p.timezone into tz from public.profiles p where p.id=auth.uid();
  shared:=exists(select 1 from public.metric_shares s where s.group_id=c.group_id and s.user_id=auth.uid() and s.metric=public.competition_share_metric(c.metric));
  shares_workouts:=exists(select 1 from public.metric_shares s where s.group_id=c.group_id and s.user_id=auth.uid() and s.metric='workouts');
  first_day:=(c.starts_at at time zone c.timezone)::date; last_day:=(c.ends_at at time zone c.timezone)::date;
  return query
  with records as (
    select dm.date::text as rid,dm.date as day,dm.source as src,dm.value as amount,'steps'::text as unit,dm.updated_at as fresh,shared as ok,false as boundary,false as duplicate,dm.value>100000 as anomaly
    from public.daily_metrics dm where c.metric in ('steps','active_days') and dm.metric='steps' and dm.user_id=auth.uid() and dm.date>=first_day and dm.date<last_day
    union all
    select w.id::text,(w.started_at at time zone c.timezone)::date,w.source,
      case when c.metric='workout_count' then 1::numeric else round(coalesce(w.duration_s,extract(epoch from w.ended_at-w.started_at))/60) end,
      case when c.metric='workout_count' then 'workouts' else 'min' end,w.updated_at,
      shared and (c.metric<>'active_days' or shares_workouts),
      w.started_at<c.starts_at or w.ended_at>c.ends_at,
      c.include_manual and w.source='healthkit' and exists(select 1 from public.workouts i where i.user_id=w.user_id and i.source='import' and i.started_at<w.ended_at and i.ended_at>w.started_at),
      coalesce(w.duration_s,extract(epoch from w.ended_at-w.started_at))>43200
    from public.workouts w where c.metric in ('workout_count','workout_minutes','active_days') and w.user_id=auth.uid() and w.started_at<c.ends_at and w.ended_at>=c.starts_at
    union all
    select e.id::text,e.local_date,e.source,e.ml,'mL',e.updated_at,shared,false,false,e.ml>5000
    from public.water_entries e where c.metric='water_days_on_target' and e.user_id=auth.uid() and e.local_date>=first_day and e.local_date<last_day
  ), reasons as (
    select r.*,case when c.status='cancelled' then 'competition_cancelled' when state<>'joined' then 'not_enrolled' when not r.ok then 'not_sharing'
      when c.metric in ('steps','active_days') and tz is distinct from c.timezone then 'timezone_mismatch'
      when c.status='finalized' and r.fresh>c.finalized_at then 'after_finalization'
      when r.boundary then 'outside_period' when r.duplicate then 'duplicate_import_summary'
      when not c.include_manual and r.src in ('manual','import') then 'manual_entries_excluded' else 'eligible' end as why
    from records r
  )
  select r.rid,r.day,r.src,r.amount,r.unit,r.why='eligible',r.why,r.anomaly,r.fresh from reasons r order by r.day,r.rid;
end $$;
revoke execute on function public.my_competition_contributions(uuid) from public,anon;
grant execute on function public.my_competition_contributions(uuid) to authenticated;

-- Source changes audit for every metric a competition can score, water included.
create or replace function public.audit_competition_measurement() returns trigger
language plpgsql security definer set search_path = '' as $$
declare before_row jsonb; after_row jsonb; subject uuid; cid uuid; actor uuid;
begin
  if tg_op<>'INSERT' then before_row:=to_jsonb(old); end if;
  if tg_op<>'DELETE' then after_row:=to_jsonb(new); end if;
  if tg_op='UPDATE' and (before_row-'updated_at') is not distinct from (after_row-'updated_at') then return new; end if;
  subject:=coalesce(after_row->>'user_id',before_row->>'user_id')::uuid;
  select id into actor from public.profiles where id=auth.uid();
  if not exists(select 1 from public.profiles where id=subject) then return null; end if;
  for cid in
    select c.id from public.competitions c
    join public.competition_participants p on p.competition_id=c.id and p.user_id=subject and p.status='joined'
    join public.metric_shares s on s.group_id=c.group_id and s.user_id=subject and s.metric=public.competition_share_metric(c.metric)
    where c.status='scheduled' and exists(select 1 from public.group_members m where m.group_id=c.group_id and m.user_id=subject)
      and ((tg_table_name='daily_metrics' and c.metric in ('steps','active_days') and coalesce(after_row->>'metric',before_row->>'metric')='steps'
        and ((after_row->>'date')::date >= (c.starts_at at time zone c.timezone)::date and (after_row->>'date')::date < (c.ends_at at time zone c.timezone)::date
          or (before_row->>'date')::date >= (c.starts_at at time zone c.timezone)::date and (before_row->>'date')::date < (c.ends_at at time zone c.timezone)::date))
      or (tg_table_name='workouts' and c.metric in ('workout_count','workout_minutes','active_days')
        and ((after_row->>'started_at')::timestamptz<c.ends_at and (after_row->>'ended_at')::timestamptz>=c.starts_at
          or (before_row->>'started_at')::timestamptz<c.ends_at and (before_row->>'ended_at')::timestamptz>=c.starts_at))
      or (tg_table_name='water_entries' and c.metric='water_days_on_target'
        and ((after_row->>'local_date')::date >= (c.starts_at at time zone c.timezone)::date and (after_row->>'local_date')::date < (c.ends_at at time zone c.timezone)::date
          or (before_row->>'local_date')::date >= (c.starts_at at time zone c.timezone)::date and (before_row->>'local_date')::date < (c.ends_at at time zone c.timezone)::date)))
  loop
    insert into public.competition_audit(competition_id,actor_id,target_id,event,reason)
    values(cid,actor,subject,'contribution_changed','Source records changed; provisional scores recompute.');
  end loop;
  return null;
end $$;
create trigger competition_water_corrections after insert or update or delete on public.water_entries for each row execute function public.audit_competition_measurement();
