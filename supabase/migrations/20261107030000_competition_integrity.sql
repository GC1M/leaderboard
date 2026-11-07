-- #42: moderation changes participation, never the underlying measurements or score inputs.
create table public.competition_audit (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions on delete cascade,
  actor_id uuid references public.profiles on delete set null,
  target_id uuid references public.profiles on delete set null,
  event text not null check(event in ('created','joined','left','removed','cancelled','finalized','contribution_changed')),
  reason text check(char_length(reason)<=500),
  created_at timestamptz not null default now()
);
create index on public.competition_audit(competition_id,created_at);
alter table public.competition_audit enable row level security;
create policy competition_audit_read on public.competition_audit for select to authenticated using(exists(select 1 from public.competitions c where c.id=competition_id and public.is_group_member(c.group_id)));
revoke all on public.competition_audit from public,anon,authenticated;
grant select on public.competition_audit to authenticated;
create function public.audit_competition_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare cid uuid; target uuid; kind text; actor uuid;
begin
  if tg_table_name='competitions' then
    cid:=new.id;
    if tg_op='INSERT' then kind:='created';
    elsif new.status is distinct from old.status and new.status in ('cancelled','finalized') then kind:=new.status;
    else return new; end if;
  else
    cid:=new.competition_id; target:=new.user_id;
    if tg_op='UPDATE' and new.status is not distinct from old.status then return new; end if;
    kind:=new.status;
  end if;
  if not exists(select 1 from public.competitions where id=cid) then return new; end if;
  select id into actor from public.profiles where id=auth.uid();
  if not exists(select 1 from public.profiles where id=target) then target:=null; end if;
  insert into public.competition_audit(competition_id,actor_id,target_id,event,reason)
  values(cid,actor,target,kind,nullif(current_setting('app.competition_reason',true),''));
  return new;
end $$;
create trigger competition_audit_change after insert or update on public.competitions for each row execute function public.audit_competition_change();
create trigger competition_participation_audit after insert or update on public.competition_participants for each row execute function public.audit_competition_change();

create function public.moderate_competition(p_id uuid,p_action text,p_reason text,p_user_id uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.competitions;
begin
  select * into c from public.competitions where id=p_id for update;
  if not found or auth.uid() is null or not public.is_group_member(c.group_id) then raise exception 'competition unavailable'; end if;
  if not(c.creator_id=auth.uid() or exists(select 1 from public.groups g where g.id=c.group_id and g.owner_id=auth.uid())) then raise exception 'only the creator or current group owner can moderate'; end if;
  if c.status='finalized' then raise exception 'finalized results cannot be moderated'; end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 1 and 500 then raise exception 'give a moderation reason of 1 to 500 characters'; end if;
  perform set_config('app.competition_reason',btrim(p_reason),true);
  if p_action='cancel' then
    if c.status<>'cancelled' then update public.competitions set status='cancelled',cancelled_at=now() where id=p_id; end if;
  elsif p_action='remove' then
    if c.status='cancelled' then raise exception 'competition is cancelled'; end if;
    update public.competition_participants set status='removed',departed_at=now() where competition_id=p_id and user_id=p_user_id and status='joined';
    if not found then raise exception 'participant is not enrolled'; end if;
  else raise exception 'unsupported moderation action'; end if;
  perform set_config('app.competition_reason','',true);
end $$;

-- Owner-only explanations. No route exposes another participant's detailed measurements.
create function public.my_competition_contributions(p_id uuid)
returns table(record_id text,measured_on date,source text,value numeric,included boolean,reason text,flagged boolean,updated_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare c public.competitions; state text; tz text; shared boolean;
begin
  select * into c from public.competitions where id=p_id;
  if not found or auth.uid() is null or not public.is_group_member(c.group_id) then raise exception 'competition unavailable'; end if;
  select p.status into state from public.competition_participants p where p.competition_id=p_id and p.user_id=auth.uid();
  if state is null then return; end if;
  select p.timezone into tz from public.profiles p where p.id=auth.uid();
  shared:=exists(select 1 from public.metric_shares s where s.group_id=c.group_id and s.user_id=auth.uid() and s.metric=case when c.metric='steps' then 'steps' else 'workouts' end);
  return query
  with records as (
    select dm.date::text as rid,dm.date as day,dm.source as src,dm.value as amount,dm.updated_at as fresh,false as boundary,false as duplicate,dm.value>100000 as anomaly
    from public.daily_metrics dm where c.metric='steps' and dm.metric='steps' and dm.user_id=auth.uid() and dm.date>=(c.starts_at at time zone c.timezone)::date and dm.date<(c.ends_at at time zone c.timezone)::date
    union all
    select w.id::text,(w.started_at at time zone c.timezone)::date,w.source,
      case when c.metric='workout_count' then 1::numeric else coalesce(w.duration_s,extract(epoch from w.ended_at-w.started_at)) end,w.updated_at,
      w.started_at<c.starts_at or w.ended_at>c.ends_at,
      c.include_manual and w.source='healthkit' and exists(select 1 from public.workouts i where i.user_id=w.user_id and i.source='import' and i.started_at<w.ended_at and i.ended_at>w.started_at),
      coalesce(w.duration_s,extract(epoch from w.ended_at-w.started_at))>43200
    from public.workouts w where c.metric in ('workout_count','workout_duration') and w.user_id=auth.uid() and w.started_at<c.ends_at and w.ended_at>=c.starts_at
  ), reasons as (
    select r.*,case when c.status='cancelled' then 'competition_cancelled' when state<>'joined' then 'not_enrolled' when not shared then 'not_sharing'
      when c.metric='steps' and tz is distinct from c.timezone then 'timezone_mismatch'
      when c.status='finalized' and r.fresh>c.finalized_at then 'after_finalization'
      when r.boundary then 'outside_period' when r.duplicate then 'duplicate_import_summary'
      when not c.include_manual and r.src in ('manual','import') then 'manual_entries_excluded' else 'eligible' end as why
    from records r
  )
  select r.rid,r.day,r.src,r.amount,r.why='eligible',r.why,r.anomaly,r.fresh from reasons r order by r.day,r.rid;
end $$;
revoke execute on function public.audit_competition_change(),public.moderate_competition(uuid,text,text,uuid),public.my_competition_contributions(uuid) from public,anon,authenticated;
grant execute on function public.moderate_competition(uuid,text,text,uuid),public.my_competition_contributions(uuid) to authenticated;

-- Record correction/deletion activity without copying any private measurement into the audit trail.
create function public.audit_competition_measurement() returns trigger
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
    join public.metric_shares s on s.group_id=c.group_id and s.user_id=subject and s.metric=case when c.metric='steps' then 'steps' else 'workouts' end
    where c.status='scheduled' and exists(select 1 from public.group_members m where m.group_id=c.group_id and m.user_id=subject)
      and ((tg_table_name='daily_metrics' and c.metric='steps' and coalesce(after_row->>'metric',before_row->>'metric')='steps'
        and ((after_row->>'date')::date >= (c.starts_at at time zone c.timezone)::date and (after_row->>'date')::date < (c.ends_at at time zone c.timezone)::date
          or (before_row->>'date')::date >= (c.starts_at at time zone c.timezone)::date and (before_row->>'date')::date < (c.ends_at at time zone c.timezone)::date))
      or (tg_table_name='workouts' and c.metric in ('workout_count','workout_duration')
        and ((after_row->>'started_at')::timestamptz<c.ends_at and (after_row->>'ended_at')::timestamptz>=c.starts_at
          or (before_row->>'started_at')::timestamptz<c.ends_at and (before_row->>'ended_at')::timestamptz>=c.starts_at)))
  loop
    insert into public.competition_audit(competition_id,actor_id,target_id,event,reason)
    values(cid,actor,subject,'contribution_changed','Source records changed; provisional scores recompute.');
  end loop;
  return null;
end $$;
create trigger competition_steps_corrections after insert or update or delete on public.daily_metrics for each row execute function public.audit_competition_measurement();
create trigger competition_workout_corrections after insert or update or delete on public.workouts for each row execute function public.audit_competition_measurement();
revoke execute on function public.audit_competition_measurement() from public,anon,authenticated;
