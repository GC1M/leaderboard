-- Per-day values behind the standings, so the app can draw the race day by day.
-- The day-by-day rules move out of competition_live_scores into competition_day_values (internal, never granted), which
-- live scores then add up as before. competition_daily_values is the member-facing view of those days: only group
-- members may call it, only participants the standings already show as eligible appear, and only days with something
-- counted. A member therefore learns nothing here that the group leaderboards and standings do not already show.

create or replace function public.competition_day_values(p_id uuid)
returns table(uid uuid,day date,val numeric,manuals bigint,health bigint,excluded bigint,fresh timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare c public.competitions; first_day date; last_day date;
begin
  select * into c from public.competitions where id=p_id;
  if c.scoring_version is distinct from 1 then raise exception 'unsupported scoring version'; end if;
  first_day := (c.starts_at at time zone c.timezone)::date; last_day := (c.ends_at at time zone c.timezone)::date;
  return query
  with readings as (
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
  )
  select r.uid,r.day,
    case when sum(r.value) filter(where c.include_manual or not r.manual) is null then null
      when c.metric='active_days' then sign(sum(r.value) filter(where c.include_manual or not r.manual))
      when c.metric='water_days_on_target' then (t.daily_ml is not null and sum(r.value) filter(where c.include_manual or not r.manual) >= t.daily_ml)::int::numeric
      else sum(r.value) filter(where c.include_manual or not r.manual) end,
    count(*) filter(where r.manual),
    count(*) filter(where not r.manual),
    count(*) filter(where r.manual and not c.include_manual),
    max(r.fresh) filter(where c.include_manual or not r.manual)
  from readings r left join public.water_targets t on t.user_id=r.uid
  group by r.uid,r.day,t.daily_ml;
end $$;
revoke execute on function public.competition_day_values(uuid) from public,anon,authenticated;

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
  ), days as (
    select * from public.competition_day_values(p_id)
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

-- ponytail: the day values are computed twice per call (once here, once inside live scores for eligibility); fold them
-- into one query if a competition ever has enough members for that to show.
create function public.competition_daily_values(p_id uuid)
returns table(user_id uuid,day date,value numeric)
language plpgsql stable security definer set search_path = '' as $$
declare c public.competitions;
begin
  select * into c from public.competitions where id=p_id;
  if not found or auth.uid() is null or not public.is_group_member(c.group_id) then raise exception 'competition unavailable'; end if;
  if c.status='cancelled' then return; end if;
  return query
  select d.uid,d.day,d.val
  from public.competition_day_values(p_id) d
  join public.competition_live_scores(p_id) l on l.user_id=d.uid and l.eligibility='eligible'
  where d.val is not null
  order by d.uid,d.day;
end $$;
revoke execute on function public.competition_daily_values(uuid) from public,anon;
grant execute on function public.competition_daily_values(uuid) to authenticated;
