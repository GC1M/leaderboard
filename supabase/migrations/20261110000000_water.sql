-- Phase 6 water tracking (#55, #56, #57). Docs: docs/water.md.
--
-- Units: canonical millilitres (mL). Fluid ounces are display only (1 US fl oz = 29.5735295625 mL, defined
--   once in src/lib/water/units.ts); no fl oz is ever stored.
-- Records: one row per intake, with the time it was drunk. Manual rows come from this app (client_id is the
--   device-generated id, so a retried save cannot duplicate). Health rows are Apple Health samples (health_uuid
--   is the sample UUID, so a repeated import upserts) and keep the source app/device name Health reported.
-- Dates: each row keeps the IANA zone it was drunk in; local_date is the calendar date there, set by the
--   trigger. Daily totals group by that local_date, so travelling never moves an old entry to another day.
-- Missing vs zero: a day with no rows has no total (no data). A row is never written for "no data". Health
--   may hold a recorded 0 mL sample, which is kept as a recorded zero; manual entries must be above 0.
-- Exports: water this app saved to Apple Health is never imported back (the device filters it by its record
--   key), and health_exports keeps the mapping under kind 'water'. Only manual rows are ever exported.
create table public.water_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles on delete cascade,
  source text not null check (source in ('manual', 'healthkit')),
  client_id uuid,
  health_uuid uuid,
  health_device_id uuid,
  source_name text check (char_length(source_name) between 1 and 200),
  consumed_at timestamptz not null check (isfinite(consumed_at)),
  timezone text not null,
  -- Always set by the trigger; the default only keeps it optional in generated insert types.
  local_date date not null default current_date,
  ml numeric not null check (ml >= 0 and ml <= 20000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((source = 'manual') = (client_id is not null)),
  check ((source = 'healthkit') = (health_uuid is not null and health_device_id is not null)),
  -- A manual entry is one drink: above zero, at most 5 L, and not in the future (an hour's allowance for a fast clock).
  constraint water_manual_bounds check (source <> 'manual' or (ml > 0 and ml <= 5000 and consumed_at <= now() + interval '1 hour')),
  unique (user_id, client_id),
  unique (user_id, health_uuid)
);
create index on public.water_entries (user_id, local_date);

create function public.water_entry_prepare() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- Same rule as food_entries: Area/City, UTC or GMT only.
  if (tg_op = 'INSERT' or new.timezone is distinct from old.timezone)
    and not exists (select 1 from pg_timezone_names z where z.name = new.timezone and (z.name in ('UTC', 'GMT') or z.name like '%/%')) then
    raise exception 'invalid timezone' using errcode = '22023';
  end if;
  new.local_date := (new.consumed_at at time zone new.timezone)::date;
  -- Identity never changes; the row id stays the same so the Health export mapping stays stable.
  if tg_op = 'UPDATE' and (new.id, new.user_id, new.source, new.client_id, new.health_uuid, new.created_at)
    is distinct from (old.id, old.user_id, old.source, old.client_id, old.health_uuid, old.created_at) then
    raise exception 'a water entry''s identity cannot be changed' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger water_entries_prepare before insert or update on public.water_entries
  for each row execute function public.water_entry_prepare();

-- Owner only. The app writes manual rows directly; Health rows only arrive through apply_health_water and leave
-- through the delete functions below, so a client cannot forge or hide an imported reading.
alter table public.water_entries enable row level security;
revoke all on public.water_entries from anon;
create policy water_entries_select on public.water_entries for select to authenticated
  using (user_id = (select auth.uid()));
create policy water_entries_insert on public.water_entries for insert to authenticated
  with check (user_id = (select auth.uid()) and source = 'manual');
create policy water_entries_update on public.water_entries for update to authenticated
  using (user_id = (select auth.uid()) and source = 'manual')
  with check (user_id = (select auth.uid()) and source = 'manual');
create policy water_entries_delete on public.water_entries for delete to authenticated
  using (user_id = (select auth.uid()) and source = 'manual');

-- Optional personal daily target, set by the user. Never a default and never shared.
create table public.water_targets (
  user_id uuid primary key references public.profiles on delete cascade,
  daily_ml numeric not null check (daily_ml > 0 and daily_ml <= 20000),
  updated_at timestamptz not null default now()
);
create trigger water_targets_touch before update on public.water_targets
  for each row execute function public.touch_updated_at();
alter table public.water_targets enable row level security;
revoke all on public.water_targets from anon;
create policy water_targets_all on public.water_targets for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Apple Health water import. Same contract as apply_health_workouts: bound to the signed-in account, one atomic
-- idempotent transaction per call, the same sample UUID upserts, and a tombstone only deletes rows this device
-- imported. A correction in Health is a delete plus a new sample, so it arrives as a tombstone and an upsert.
-- A sample zone the server does not accept falls back to the profile's zone rather than failing the batch.
create function public.apply_health_water(p_owner uuid, p_device uuid, p_samples jsonb, p_remove uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare r jsonb; v numeric; tz text;
begin
  if auth.uid() is null or auth.uid() <> p_owner then raise exception 'Health account changed'; end if;
  if p_device is null or p_samples is null or p_remove is null or jsonb_typeof(p_samples) <> 'array' then
    raise exception 'invalid Health payload';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text || ':water', 0));
  delete from public.water_entries where user_id = p_owner and source = 'healthkit'
    and health_device_id = p_device and health_uuid = any(p_remove);
  for r in select * from jsonb_array_elements(p_samples) loop
    v := (r->>'ml')::numeric;
    if v is null or v = 'NaN'::numeric or v = 'Infinity'::numeric then raise exception 'invalid Health value'; end if;
    tz := r->>'timezone';
    if tz is null or not exists (select 1 from pg_timezone_names z where z.name = tz and (z.name in ('UTC', 'GMT') or z.name like '%/%')) then
      select p.timezone into tz from public.profiles p where p.id = p_owner;
    end if;
    insert into public.water_entries (user_id, source, health_uuid, health_device_id, source_name, consumed_at, timezone, ml)
    values (p_owner, 'healthkit', (r->>'health_uuid')::uuid, p_device, nullif(left(btrim(r->>'source_name'), 200), ''),
      (r->>'consumed_at')::timestamptz, tz, v)
    on conflict (user_id, health_uuid) do update set health_device_id = excluded.health_device_id,
      source_name = excluded.source_name, consumed_at = excluded.consumed_at, timezone = excluded.timezone, ml = excluded.ml;
  end loop;
end $$;
revoke execute on function public.apply_health_water(uuid, uuid, jsonb, uuid[]) from public, anon;
grant execute on function public.apply_health_water(uuid, uuid, jsonb, uuid[]) to authenticated;

-- Daily totals for the 7/30/90-day history. One row per local day that has entries; a day without entries has no
-- row (no data, not 0 mL). Split by source so the app can say where a total came from, with the newest entry
-- time and the last time an imported row was received (freshness). Security invoker: RLS limits it to the caller.
create function public.water_daily_totals(p_from date, p_to date) returns table (
  local_date date, entries int, total_ml numeric, manual_ml numeric, health_ml numeric,
  last_entry_at timestamptz, health_received_at timestamptz
) language plpgsql stable security invoker set search_path = '' as $$
begin
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 366 then
    raise exception 'invalid date range' using errcode = '22023';
  end if;
  return query
  select e.local_date, count(*)::int, sum(e.ml),
    coalesce(sum(e.ml) filter (where e.source = 'manual'), 0), coalesce(sum(e.ml) filter (where e.source = 'healthkit'), 0),
    max(e.consumed_at), max(e.updated_at) filter (where e.source = 'healthkit')
  from public.water_entries e
  where e.user_id = (select auth.uid()) and e.local_date between p_from and p_to
  group by e.local_date
  order by e.local_date;
end $$;
revoke all on function public.water_daily_totals(date, date) from public, anon;
grant execute on function public.water_daily_totals(date, date) to authenticated;

-- Sharing: per group, through the same metric_shares switch. Off unless the member turns it on. A group sees one
-- number per member and local day that has entries: the day's total mL. Never an entry, its time, its source or
-- the member's target. Water is never ranked: competitions only accept steps and workouts.
-- Revoking, leaving the group (cascade from group_members) and deleting the account all stop the next read.
alter table public.metric_shares drop constraint metric_shares_metric_check;
alter table public.metric_shares add constraint metric_shares_metric_check
  check (metric in ('steps', 'sleep', 'weight', 'workouts', 'food', 'water'));

create function public.group_water(p_group_id uuid, p_from date, p_to date)
returns table (user_id uuid, local_date date, total_ml numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_group_member(p_group_id) then
    raise exception 'not a member of this group';
  end if;
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 30 then
    raise exception 'invalid date range' using errcode = '22023';
  end if;
  return query
  select e.user_id, e.local_date, sum(e.ml)
  from public.water_entries e
  join public.metric_shares s on s.user_id = e.user_id and s.group_id = p_group_id and s.metric = 'water'
  where e.local_date between p_from and p_to
  group by e.user_id, e.local_date
  order by e.local_date, e.user_id;
end $$;
revoke execute on function public.group_water(uuid, date, date) from public, anon;
grant execute on function public.group_water(uuid, date, date) to authenticated;

-- Delete water history: every water entry (manual and imported), the target, and the record of which entries were
-- saved to Apple Health. Sharing choices stay. Imported rows do not come back: the device's import cursor has already
-- passed them, so only water added to Health later is imported. Same lock as apply_health_water.
create function public.delete_my_water_history() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':water', 0));
  delete from public.water_entries where user_id = auth.uid();
  delete from public.water_targets where user_id = auth.uid();
  delete from public.health_exports where user_id = auth.uid() and kind = 'water';
end $$;
revoke execute on function public.delete_my_water_history() from public, anon;
grant execute on function public.delete_my_water_history() to authenticated;

-- Deleting imported Health data also removes imported water (manual water stays). Security definer now, because
-- clients cannot delete imported water rows directly; every delete is still limited to the caller's rows.
create or replace function public.delete_my_health_imports() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':' || m, 0))
  from unnest(array['steps', 'sleep', 'weight', 'workouts', 'water']) m;
  delete from public.daily_metrics where user_id = auth.uid() and source = 'healthkit';
  delete from public.weight_measurements where user_id = auth.uid() and source = 'healthkit';
  delete from public.workouts where user_id = auth.uid() and source = 'healthkit';
  delete from public.water_entries where user_id = auth.uid() and source = 'healthkit';
end $$;

-- Account deletion needs nothing extra: deleting the profile cascades to water_entries and water_targets, and
-- health_exports already cascades.
