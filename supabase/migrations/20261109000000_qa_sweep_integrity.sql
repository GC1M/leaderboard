-- Fixes from the Phase 1 to 5 QA sweep.

-- Profiles: an unknown time zone made every group query that converts with it fail for the whole group, and
-- display names had no server limit. Existing rows are repaired first so the new rules hold for everyone.
update public.profiles set timezone = 'UTC'
where timezone not in (select name from pg_catalog.pg_timezone_names);
update public.profiles
set display_name = coalesce(nullif(btrim(left(btrim(display_name), 40)), ''), 'Player ' || upper(left(replace(id::text, '-', ''), 4)))
where char_length(btrim(display_name)) not between 1 and 40;
alter table public.profiles add constraint profiles_display_name_length check (char_length(btrim(display_name)) between 1 and 40);

create function public.check_profile_timezone() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'unknown time zone %', new.timezone using errcode = '22023';
  end if;
  return new;
end $$;
create trigger profiles_timezone_check before insert or update of timezone on public.profiles
for each row execute function public.check_profile_timezone();
revoke execute on function public.check_profile_timezone() from public, anon, authenticated;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(btrim(left(btrim(new.raw_user_meta_data ->> 'display_name'), 40)), ''),
      nullif(btrim(left(btrim(new.raw_user_meta_data ->> 'full_name'), 40)), ''),
      nullif(btrim(left(btrim(new.raw_user_meta_data ->> 'name'), 40)), ''),
      'Player ' || upper(left(replace(new.id::text, '-', ''), 4))
    )
  );
  return new;
end $$;

-- NaN and Infinity passed "value >= 0". Manual sleep over a day, manual workouts over a day or starting in the future,
-- and future manual weights are rejected, as the app already does. NOT VALID: old rows are not rechecked.
alter table public.daily_metrics
  add constraint daily_metrics_finite check (value < 'Infinity'::numeric) not valid,
  add constraint daily_metrics_manual_sleep_cap check (metric <> 'sleep_min' or source <> 'manual' or value <= 1440) not valid;
alter table public.goals
  add constraint goals_finite check (start_value < 'Infinity'::numeric and target_value < 'Infinity'::numeric) not valid;
alter table public.weight_measurements
  add constraint weight_manual_not_future check (source <> 'manual' or measured_at <= now() + interval '5 minutes') not valid;
alter table public.workouts
  add constraint workouts_manual_bounds check (source <> 'manual' or (ended_at - started_at <= interval '24 hours' and started_at <= now() + interval '5 minutes')) not valid;

-- Deleting an owner who had joined a competition in their own group failed: the cascade marked them as left,
-- and the audit row for that change pointed at a competition the same cascade was deleting. Removing the
-- owned groups first lets those competitions go before the profile does.
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  delete from public.groups where owner_id = auth.uid();
  delete from auth.users where id = auth.uid();
end $$;

-- Leaving a group after a competition was finalized erased the frozen result for good. Only competitions
-- not yet finalized mark a departing member as left; finalized standings hide them while they are out.
create or replace function public.competition_group_departure() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.competition_participants p set status='left',departed_at=now()
  from public.competitions c where p.competition_id=c.id and c.group_id=old.group_id and p.user_id=old.user_id and p.status='joined' and c.status='scheduled';
  return old;
end $$;

-- Finalized standings changed when a participant later changed time zone. A finalized competition shows the
-- frozen scores; only the privacy gates (stopped sharing, left the group) hide a row.
create or replace function public.competition_standings(p_id uuid)
returns table(user_id uuid,display_name text,score numeric,rank bigint,eligibility text,manual_entries bigint,health_entries bigint,excluded_entries bigint,updated_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare c public.competitions;
begin
  select * into c from public.competitions where id=p_id for share;
  if not found or auth.uid() is null or not public.is_group_member(c.group_id) then raise exception 'competition unavailable'; end if;
  if c.status='cancelled' then return; end if;
  if c.status='finalized' then
    -- Ranks are over the visible frozen scores, so a hidden score leaves no revealing gap.
    return query
    select v.user_id,pr.display_name,v.value,case when v.value is not null then rank() over(order by v.value desc nulls last) end,
      v.why,v.manual_n,v.health_n,v.excluded_n,v.fresh
    from (
      select l.user_id,
        case when not h.hidden then r.score end as value,
        case when h.hidden then l.eligibility else coalesce(r.eligibility,'no_data') end as why,
        case when h.hidden then 0::bigint else coalesce(r.manual_entries,0) end as manual_n,
        case when h.hidden then 0::bigint else coalesce(r.health_entries,0) end as health_n,
        case when h.hidden then 0::bigint else coalesce(r.excluded_entries,0) end as excluded_n,
        case when not h.hidden then r.updated_at end as fresh
      from public.competition_live_scores(p_id) l
      cross join lateral (select l.eligibility in ('not_sharing','left_group') as hidden) h
      left join public.competition_results r on r.competition_id=p_id and r.user_id=l.user_id
    ) v join public.profiles pr on pr.id=v.user_id
    order by v.value desc nulls last,pr.display_name,v.user_id;
    return;
  end if;
  return query
  select l.user_id,pr.display_name,l.score,case when l.score is not null then rank() over(order by l.score desc nulls last) end,
    l.eligibility,l.manual_entries,l.health_entries,l.excluded_entries,l.updated_at
  from public.competition_live_scores(p_id) l join public.profiles pr on pr.id=l.user_id
  order by l.score desc nulls last,pr.display_name,l.user_id;
end $$;

-- The owner could probe for and delete manual steps of a member who does not share steps with the group.
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
  if not exists (select 1 from public.metric_shares s where s.group_id = p_group_id and s.user_id = p_user_id and s.metric = 'steps') then
    raise exception 'this member does not share steps with the group';
  end if;
  select (now() at time zone p.timezone)::date into member_today from public.profiles p where p.id = p_user_id;
  delete from public.daily_metrics
  where user_id = p_user_id and date = member_today and metric = p_metric and source = 'manual';
  if not found then raise exception 'no manual entry for today'; end if;
end $$;

-- A removed member could rejoin at once with the same code. The owner can now replace it; the old code and
-- links stop working.
create function public.regenerate_invite_code(p_group_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  code text;
begin
  update public.groups set invite_code = public.gen_invite_code()
  where id = p_group_id and owner_id = auth.uid()
  returning invite_code into code;
  if code is null then raise exception 'only the group owner can change the invite code'; end if;
  return code;
end $$;
revoke execute on function public.regenerate_invite_code(uuid) from public, anon;
grant execute on function public.regenerate_invite_code(uuid) to authenticated;
