-- Water import fixes from the Phase 6 testing pass (#58).
-- 1. A Health sample dated more than an hour ahead is skipped, the same bound manual water has. Before, one dated after
--    a history deletion was past the cutoff, so Delete Water History could not keep it from coming back.
-- 2. The profile-zone fallback is checked by the same Area/City, UTC or GMT rule as the sample zone, and falls back to
--    UTC when the profile zone fails it too. Before, a profile zone such as EST5EDT failed water_entry_prepare and one
--    sample with a bad HKTimeZone failed every later import.
create or replace function public.apply_health_water(p_owner uuid, p_device uuid, p_samples jsonb, p_remove uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare r jsonb; v numeric; tz text; at timestamptz; cutoff timestamptz;
begin
  if auth.uid() is null or auth.uid() <> p_owner then raise exception 'Health account changed'; end if;
  if p_device is null or p_samples is null or p_remove is null or jsonb_typeof(p_samples) <> 'array' then
    raise exception 'invalid Health payload';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text || ':water', 0));
  select c.deleted_at into cutoff from public.water_history_cutoffs c where c.user_id = p_owner;
  delete from public.water_entries where user_id = p_owner and source = 'healthkit'
    and health_device_id = p_device and health_uuid = any(p_remove);
  for r in select * from jsonb_array_elements(p_samples) loop
    v := (r->>'ml')::numeric;
    if v is null or v = 'NaN'::numeric or v = 'Infinity'::numeric then raise exception 'invalid Health value'; end if;
    at := (r->>'consumed_at')::timestamptz;
    if v < 0 or v > 20000 or at <= cutoff or at > now() + interval '1 hour' then continue; end if;
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

-- 3. The history cutoff also covers deleted Health water dated up to an hour ahead (the most an import accepts), so a
--    recheck cannot bring that back either.
create or replace function public.delete_my_water_history() returns void
language plpgsql security definer set search_path = '' as $$
declare cutoff timestamptz;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':water', 0));
  select greatest(now(), max(e.consumed_at)) into cutoff from public.water_entries e
    where e.user_id = auth.uid() and e.source = 'healthkit';
  delete from public.water_entries where user_id = auth.uid();
  delete from public.water_targets where user_id = auth.uid();
  delete from public.health_exports where user_id = auth.uid() and kind = 'water';
  insert into public.water_history_cutoffs (user_id, deleted_at) values (auth.uid(), cutoff)
  on conflict (user_id) do update set deleted_at = excluded.deleted_at;
end $$;
