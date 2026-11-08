-- Water import fixes from the Phase 6 testing pass (#58).
-- 1. Delete Water History also remembers the Health sample ids it deleted that are dated after the deletion (a wrong
--    clock or a pre-logged reminder in another app). Imports skip those ids as well as anything drunk before the cutoff,
--    so a recheck cannot bring them back, while water drunk after the deletion still imports. The cutoff never moves
--    back, so a second deletion cannot release what the first one blocked.
-- 2. The profile-zone fallback is checked by the same Area/City, UTC or GMT rule as the sample zone, and falls back to
--    UTC when the profile zone fails it too. Before, a profile zone such as EST5EDT failed water_entry_prepare and one
--    sample with a bad HKTimeZone failed every later import.
alter table public.water_history_cutoffs add column health_uuids uuid[] not null default '{}';

create or replace function public.apply_health_water(p_owner uuid, p_device uuid, p_samples jsonb, p_remove uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare r jsonb; v numeric; tz text; at timestamptz; cutoff timestamptz; blocked uuid[];
begin
  if auth.uid() is null or auth.uid() <> p_owner then raise exception 'Health account changed'; end if;
  if p_device is null or p_samples is null or p_remove is null or jsonb_typeof(p_samples) <> 'array' then
    raise exception 'invalid Health payload';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text || ':water', 0));
  select c.deleted_at, c.health_uuids into cutoff, blocked from public.water_history_cutoffs c where c.user_id = p_owner;
  delete from public.water_entries where user_id = p_owner and source = 'healthkit'
    and health_device_id = p_device and health_uuid = any(p_remove);
  for r in select * from jsonb_array_elements(p_samples) loop
    v := (r->>'ml')::numeric;
    if v is null or v = 'NaN'::numeric or v = 'Infinity'::numeric then raise exception 'invalid Health value'; end if;
    at := (r->>'consumed_at')::timestamptz;
    if v < 0 or v > 20000 or at <= cutoff or (r->>'health_uuid')::uuid = any(blocked) then continue; end if;
    tz := r->>'timezone';
    if tz is null or not exists (select 1 from pg_timezone_names z where z.name = tz and (z.name in ('UTC', 'GMT') or z.name like '%/%')) then
      select p.timezone into tz from public.profiles p where p.id = p_owner;
      if tz is null or not exists (select 1 from pg_timezone_names z where z.name = tz and (z.name in ('UTC', 'GMT') or z.name like '%/%')) then
        tz := 'UTC';
      end if;
    end if;
    insert into public.water_entries (user_id, source, health_uuid, health_device_id, source_name, consumed_at, timezone, ml)
    values (p_owner, 'healthkit', (r->>'health_uuid')::uuid, p_device, nullif(left(btrim(r->>'source_name'), 200), ''),
      at, tz, v)
    on conflict (user_id, health_uuid) do update set health_device_id = excluded.health_device_id,
      source_name = excluded.source_name, consumed_at = excluded.consumed_at, timezone = excluded.timezone, ml = excluded.ml;
  end loop;
end $$;

create or replace function public.delete_my_water_history() returns void
language plpgsql security definer set search_path = '' as $$
declare ahead uuid[];
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':water', 0));
  select coalesce(array_agg(e.health_uuid), '{}') into ahead from public.water_entries e
    where e.user_id = auth.uid() and e.source = 'healthkit' and e.consumed_at > now();
  delete from public.water_entries where user_id = auth.uid();
  delete from public.water_targets where user_id = auth.uid();
  delete from public.health_exports where user_id = auth.uid() and kind = 'water';
  insert into public.water_history_cutoffs as c (user_id, deleted_at, health_uuids) values (auth.uid(), now(), ahead)
  on conflict (user_id) do update set deleted_at = greatest(c.deleted_at, excluded.deleted_at),
    health_uuids = array(select distinct u from unnest(c.health_uuids || excluded.health_uuids) u);
end $$;
