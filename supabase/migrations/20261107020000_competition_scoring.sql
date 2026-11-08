-- #40: scores are derived on the server; clients cannot insert scores or ranks.
create table public.competition_results (
  competition_id uuid not null,
  user_id uuid not null,
  score numeric check (score >= 0 and score < 'Infinity'::numeric),
  eligibility text not null,
  manual_entries bigint not null,
  health_entries bigint not null,
  excluded_entries bigint not null,
  updated_at timestamptz,
  primary key(competition_id,user_id),
  foreign key(competition_id,user_id) references public.competition_participants on delete cascade
);
alter table public.competition_results enable row level security;
revoke all on public.competition_results from public,anon,authenticated;

-- Internal calculation. Never executable by the API roles. Source details are masked before returning.
create function public.competition_live_scores(p_id uuid)
returns table(user_id uuid,score numeric,eligibility text,manual_entries bigint,health_entries bigint,excluded_entries bigint,updated_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare c public.competitions;
begin
  select * into c from public.competitions where id=p_id;
  if c.scoring_version is distinct from 1 then raise exception 'unsupported scoring version'; end if;
  return query
  with people as (
    select p.user_id as uid,
      case when not exists(select 1 from public.group_members m where m.group_id=c.group_id and m.user_id=p.user_id) then 'left_group'
      when not exists(select 1 from public.metric_shares s where s.group_id=c.group_id and s.user_id=p.user_id and s.metric=case when c.metric='steps' then 'steps' else 'workouts' end) then 'not_sharing'
      when c.metric='steps' and pr.timezone is distinct from c.timezone then 'timezone_mismatch'
      else 'eligible' end as allowed
    from public.competition_participants p join public.profiles pr on pr.id=p.user_id where p.competition_id=p_id and p.status='joined'
  ), readings as (
    select dm.user_id as uid,dm.value as value,dm.source='manual' as manual,dm.updated_at as fresh
    from public.daily_metrics dm
    where c.metric='steps' and dm.metric='steps'
      and dm.date >= (c.starts_at at time zone c.timezone)::date and dm.date < (c.ends_at at time zone c.timezone)::date
    union all
    select w.user_id,case when c.metric='workout_count' then 1::numeric else coalesce(w.duration_s,extract(epoch from w.ended_at-w.started_at)) end,
      w.source in ('manual','import'),w.updated_at
    from public.workouts w
    where c.metric in ('workout_count','workout_duration') and w.started_at>=c.starts_at and w.started_at<c.ends_at and w.ended_at<=c.ends_at
      -- Match the existing detailed-import overlap policy, after source eligibility is considered.
      and not(c.include_manual and w.source='healthkit' and exists(select 1 from public.workouts i where i.user_id=w.user_id and i.source='import' and i.started_at<w.ended_at and i.ended_at>w.started_at))
  ), totals as (
    select p.uid,p.allowed,
      sum(r.value) filter(where c.include_manual or not r.manual) as total,
      count(*) filter(where r.uid is not null and r.manual) as manuals,
      count(*) filter(where r.uid is not null and not r.manual) as health,
      count(*) filter(where r.uid is not null and r.manual and not c.include_manual) as excluded,
      max(r.fresh) filter(where c.include_manual or not r.manual) as fresh
    from people p left join readings r on r.uid=p.uid group by p.uid,p.allowed
  )
  select t.uid,case when t.allowed='eligible' then t.total end,
    case when t.allowed<>'eligible' then t.allowed when t.total is not null then 'eligible' when t.excluded>0 then 'manual_entries_excluded' else 'no_data' end,
    case when t.allowed='eligible' then t.manuals else 0::bigint end,
    case when t.allowed='eligible' then t.health else 0::bigint end,
    case when t.allowed='eligible' then t.excluded else 0::bigint end,
    case when t.allowed='eligible' then t.fresh end
  from totals t;
end $$;

create function public.competition_standings(p_id uuid)
returns table(user_id uuid,display_name text,score numeric,rank bigint,eligibility text,manual_entries bigint,health_entries bigint,excluded_entries bigint,updated_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare c public.competitions;
begin
  select * into c from public.competitions where id=p_id for share;
  if not found or auth.uid() is null or not public.is_group_member(c.group_id) then raise exception 'competition unavailable'; end if;
  if c.status='cancelled' then return; end if;
  return query
  with live as (select * from public.competition_live_scores(p_id)), scores as (
    select l.user_id,
      case when c.status='finalized' then case when l.eligibility not in ('not_sharing','timezone_mismatch','left_group') then r.score end else l.score end as value,
      case when c.status='finalized' then case when l.eligibility in ('not_sharing','timezone_mismatch','left_group') then l.eligibility else coalesce(r.eligibility,'no_data') end else l.eligibility end as why,
      case when c.status='finalized' then case when l.eligibility not in ('not_sharing','timezone_mismatch','left_group') then coalesce(r.manual_entries,0) else 0 end else l.manual_entries end as manual_n,
      case when c.status='finalized' then case when l.eligibility not in ('not_sharing','timezone_mismatch','left_group') then coalesce(r.health_entries,0) else 0 end else l.health_entries end as health_n,
      case when c.status='finalized' then case when l.eligibility not in ('not_sharing','timezone_mismatch','left_group') then coalesce(r.excluded_entries,0) else 0 end else l.excluded_entries end as excluded_n,
      case when c.status='finalized' then case when l.eligibility not in ('not_sharing','timezone_mismatch','left_group') then r.updated_at end else l.updated_at end as fresh
    from live l left join public.competition_results r on r.competition_id=p_id and r.user_id=l.user_id
  )
  select s.user_id,pr.display_name,s.value,case when s.value is not null then rank() over(order by s.value desc nulls last) end,
    s.why,s.manual_n,s.health_n,s.excluded_n,s.fresh
  from scores s join public.profiles pr on pr.id=s.user_id order by s.value desc nulls last,pr.display_name,s.user_id;
end $$;

create function public.finalize_competition(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.competitions;
begin
  select * into c from public.competitions where id=p_id for update;
  if not found or auth.uid() is null or not public.is_group_member(c.group_id) then raise exception 'competition unavailable'; end if;
  if not(coalesce(c.creator_id=auth.uid(),false) or exists(select 1 from public.groups g where g.id=c.group_id and g.owner_id=auth.uid()) or exists(select 1 from public.competition_participants p where p.competition_id=p_id and p.user_id=auth.uid() and p.status='joined')) then raise exception 'only participants, the creator or group owner can finalize'; end if;
  if c.status='finalized' then return; end if;
  if c.status='cancelled' then raise exception 'cancelled competitions cannot be finalized'; end if;
  if now()<c.ends_at+interval '24 hours' then raise exception 'finalization opens 24 hours after the end'; end if;
  insert into public.competition_results select p_id,s.* from public.competition_live_scores(p_id) s;
  update public.competitions set status='finalized',finalized_at=now() where id=p_id;
end $$;
revoke execute on function public.competition_live_scores(uuid),public.competition_standings(uuid),public.finalize_competition(uuid) from public,anon,authenticated;
grant execute on function public.competition_standings(uuid),public.finalize_competition(uuid) to authenticated;
