-- #39: membership in a group is separate from competition consent.
create function public.create_competition(p_group_id uuid, p_name text, p_metric text, p_start_day date, p_end_day date, p_timezone text, p_include_manual boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_start timestamptz; v_end timestamptz;
begin
  if auth.uid() is null or not public.is_group_member(p_group_id) then raise exception 'not a member of this group'; end if;
  if p_metric is distinct from 'steps' then raise exception 'only steps competitions are enabled in version 1'; end if;
  if not exists (select 1 from pg_timezone_names z where z.name = p_timezone) then raise exception 'invalid competition timezone'; end if;
  v_start := p_start_day::timestamp at time zone p_timezone;
  v_end := p_end_day::timestamp at time zone p_timezone;
  if v_start <= now() then raise exception 'choose a future start day'; end if;
  insert into public.competitions(group_id,creator_id,name,metric,starts_at,ends_at,timezone,include_manual)
  values(p_group_id,auth.uid(),btrim(p_name),p_metric,v_start,v_end,p_timezone,p_include_manual) returning id into v_id;
  return v_id;
end $$;

create function public.join_competition(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.competitions; tz text;
begin
  select * into c from public.competitions where id=p_id for update;
  if not found or auth.uid() is null or not public.is_group_member(c.group_id) then raise exception 'competition unavailable'; end if;
  if c.status <> 'scheduled' or now() >= c.starts_at then raise exception 'enrollment closes when the competition starts'; end if;
  if not exists(select 1 from public.metric_shares s where s.group_id=c.group_id and s.user_id=auth.uid() and s.metric=case when c.metric='steps' then 'steps' else 'workouts' end) then
    raise exception 'enable sharing for this metric in Group Info before joining';
  end if;
  select timezone into tz from public.profiles where id=auth.uid();
  if c.metric='steps' and tz is distinct from c.timezone then raise exception 'your profile timezone must match the competition timezone'; end if;
  if exists(select 1 from public.competition_participants p where p.competition_id=p_id and p.user_id=auth.uid() and p.status='removed') then raise exception 'you were removed from this competition'; end if;
  insert into public.competition_participants(competition_id,user_id) values(p_id,auth.uid())
  on conflict(competition_id,user_id) do update set status='joined',joined_at=case when competition_participants.status='joined' then competition_participants.joined_at else now() end,departed_at=null;
end $$;

create function public.leave_competition(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.competitions;
begin
  select * into c from public.competitions where id=p_id for update;
  if not found or auth.uid() is null or not public.is_group_member(c.group_id) then raise exception 'competition unavailable'; end if;
  if c.status <> 'scheduled' or now() >= c.ends_at then raise exception 'leaving closes when the competition ends'; end if;
  update public.competition_participants set status='left',departed_at=now() where competition_id=p_id and user_id=auth.uid() and status='joined';
end $$;

-- A group invitation code is required to preview a competition outside its group. No health data is returned.
create function public.competition_invite(p_id uuid, p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select jsonb_build_object('id',c.id,'group_id',c.group_id,'name',c.name,'metric',c.metric,'starts_at',c.starts_at,'ends_at',c.ends_at,'timezone',c.timezone,'include_manual',c.include_manual,'status',c.status,'is_member',public.is_group_member(c.group_id)) into result
  from public.competitions c join public.groups g on g.id=c.group_id
  where c.id=p_id and g.invite_code=upper(p_code);
  if result is null then raise exception 'competition invitation unavailable'; end if;
  return result;
end $$;

create function public.competition_group_departure() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.competition_participants p set status='left',departed_at=now()
  from public.competitions c where p.competition_id=c.id and c.group_id=old.group_id and p.user_id=old.user_id and p.status='joined';
  return old;
end $$;
create trigger competition_group_departure after delete on public.group_members
for each row execute function public.competition_group_departure();
revoke execute on function public.create_competition(uuid,text,text,date,date,text,boolean), public.join_competition(uuid), public.leave_competition(uuid), public.competition_invite(uuid,text), public.competition_group_departure() from public,anon;
revoke execute on function public.competition_group_departure() from authenticated;
grant execute on function public.create_competition(uuid,text,text,date,date,text,boolean), public.join_competition(uuid), public.leave_competition(uuid), public.competition_invite(uuid,text) to authenticated;
