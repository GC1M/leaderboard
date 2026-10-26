-- Issue #30: import Apple Health workouts. Same contract as apply_health_changes: the payload is bound to the
-- signed-in account, every call is an atomic idempotent transaction, and a tombstone only deletes rows this
-- device imported. The same Health sample UUID is an upsert; different UUIDs are always separate rows.
create function public.apply_health_workouts(p_owner uuid, p_device uuid, p_workouts jsonb, p_remove uuid[])
returns void language plpgsql security invoker set search_path = '' as $$
declare r jsonb; v numeric; k text;
begin
  if auth.uid() is null or auth.uid() <> p_owner then raise exception 'Health account changed'; end if;
  if p_device is null or p_workouts is null or p_remove is null or jsonb_typeof(p_workouts) <> 'array' then
    raise exception 'invalid Health payload';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text || ':workouts', 0));
  delete from public.workouts where user_id = p_owner and source = 'healthkit'
    and health_device_id = p_device and health_uuid = any(p_remove);
  for r in select * from jsonb_array_elements(p_workouts) loop
    -- Missing stays null. Negative values are rejected by the table checks; NaN and Infinity are rejected here.
    foreach k in array array['duration_s', 'distance_m', 'energy_kcal'] loop
      v := (r->>k)::numeric;
      if v = 'NaN'::numeric or v = 'Infinity'::numeric then raise exception 'invalid Health value'; end if;
    end loop;
    insert into public.workouts (user_id, source, activity_type, started_at, ended_at, timezone,
      duration_s, distance_m, energy_kcal, health_uuid, health_device_id)
    values (p_owner, 'healthkit', r->>'activity_type', (r->>'started_at')::timestamptz, (r->>'ended_at')::timestamptz,
      r->>'timezone', (r->>'duration_s')::numeric, (r->>'distance_m')::numeric, (r->>'energy_kcal')::numeric,
      (r->>'health_uuid')::uuid, p_device)
    on conflict (user_id, health_uuid) do update set activity_type = excluded.activity_type,
      started_at = excluded.started_at, ended_at = excluded.ended_at, timezone = excluded.timezone,
      duration_s = excluded.duration_s, distance_m = excluded.distance_m, energy_kcal = excluded.energy_kcal,
      health_device_id = excluded.health_device_id;
  end loop;
end $$;
revoke execute on function public.apply_health_workouts(uuid, uuid, jsonb, uuid[]) from public, anon;
grant execute on function public.apply_health_workouts(uuid, uuid, jsonb, uuid[]) to authenticated;

-- Deleting imported Health data also removes imported workouts (manual workouts stay).
create or replace function public.delete_my_health_imports() returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':' || m, 0))
  from unnest(array['steps', 'sleep', 'weight', 'workouts']) m;
  delete from public.daily_metrics where user_id = auth.uid() and source = 'healthkit';
  delete from public.weight_measurements where user_id = auth.uid() and source = 'healthkit';
  delete from public.workouts where user_id = auth.uid() and source = 'healthkit';
end $$;
