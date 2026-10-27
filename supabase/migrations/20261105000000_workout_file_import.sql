-- Issue #120: import workout history from other apps' CSV exports (Strong, Hevy, Fitbod, JEFIT). The app
-- parses the file on the device; this file stores the result.
--   source = 'import' rows are detailed logs like 'manual' ones (exercises and sets, editable), plus where they
--   came from: source_app names the app and source_key identifies the workout inside that app's exports (its
--   start time and name), so re-importing a file or a newer overlapping export never creates duplicates.
--   Owner-only like every workout (the existing policies cover the new rows), private until the user shares
--   workouts with a group, and removed with the account (cascade from profiles).
-- Apple Health duplicates: these apps usually also write a summary of the same session to Health, which the
-- Health importer brings in as a 'healthkit' row. A 'healthkit' row whose time range overlaps an imported row
-- of the same owner is treated as the same session: it stays stored (the Health sync owns it) but is left out
-- of group totals here and of the app's history and totals (see hideHealthDuplicates in src/lib/workouts.ts),
-- so the detailed row is the one that counts.
alter table public.workouts drop constraint workouts_source_check;
alter table public.workouts add constraint workouts_source_check check (source in ('healthkit', 'manual', 'import'));
alter table public.workouts
  add column source_app text check (source_app in ('strong', 'hevy', 'fitbod', 'jefit')),
  add column source_key text check (char_length(source_key) between 1 and 200),
  add constraint workouts_import_identity check ((source = 'import') = (source_app is not null and source_key is not null)),
  add constraint workouts_import_key unique (user_id, source_app, source_key);

-- Imported workouts carry exercises and sets; Health summaries still can't.
alter table public.workout_exercises drop constraint workout_exercises_workout_source_check;
alter table public.workout_exercises add constraint workout_exercises_workout_source_check
  check (workout_source in ('manual', 'import'));

-- Same as before, except an imported workout can be edited too (it keeps its source and key, so a later
-- re-import skips it instead of overwriting the edit). New workouts are still always 'manual'.
create or replace function public.save_manual_workout(p_id uuid, p_workout jsonb) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare v_id uuid; v_source text; e jsonb; s jsonb; v_we uuid; ei int; si int;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_id is null then
    insert into public.workouts (user_id, source, activity_type, started_at, ended_at, timezone, duration_s, distance_m, energy_kcal, notes)
    values (auth.uid(), 'manual', p_workout->>'activity_type', (p_workout->>'started_at')::timestamptz,
      (p_workout->>'ended_at')::timestamptz, p_workout->>'timezone', (p_workout->>'duration_s')::numeric,
      (p_workout->>'distance_m')::numeric, (p_workout->>'energy_kcal')::numeric, p_workout->>'notes')
    returning id, source into v_id, v_source;
  else
    update public.workouts set activity_type = p_workout->>'activity_type',
      started_at = (p_workout->>'started_at')::timestamptz, ended_at = (p_workout->>'ended_at')::timestamptz,
      timezone = p_workout->>'timezone', duration_s = (p_workout->>'duration_s')::numeric,
      distance_m = (p_workout->>'distance_m')::numeric, energy_kcal = (p_workout->>'energy_kcal')::numeric,
      notes = p_workout->>'notes'
    where id = p_id and user_id = auth.uid() and source in ('manual', 'import')
    returning id, source into v_id, v_source;
    if v_id is null then raise exception 'workout not found'; end if;
    delete from public.workout_exercises where workout_id = v_id;
  end if;
  ei := 0;
  for e in select * from jsonb_array_elements(coalesce(p_workout->'exercises', '[]'::jsonb)) loop
    insert into public.workout_exercises (workout_id, workout_source, exercise_id, position, notes)
    values (v_id, v_source, (e->>'exercise_id')::uuid, ei, e->>'notes') returning id into v_we;
    si := 0;
    for s in select * from jsonb_array_elements(coalesce(e->'sets', '[]'::jsonb)) loop
      insert into public.workout_sets (workout_exercise_id, position, reps, load_kg, duration_s, distance_m)
      values (v_we, si, (s->>'reps')::int, (s->>'load_kg')::numeric, (s->>'duration_s')::numeric, (s->>'distance_m')::numeric);
      si := si + 1;
    end loop;
    ei := ei + 1;
  end loop;
  return v_id;
end $$;

-- Atomic import of one batch of parsed workouts from one app. Returns how many were new; a workout whose
-- (app, source_key) the caller already has is skipped untouched, edits included. Exercises are matched by
-- name, case-insensitively, against the catalog and then the caller's own; a name with no match becomes a
-- custom exercise. security invoker: RLS still decides what the caller may touch. p_workouts shape:
-- [{source_key, activity_type, started_at, ended_at, timezone, duration_s?, distance_m?, energy_kcal?, notes?,
--   exercises: [{name, category, notes?, sets: [{reps?, load_kg?, duration_s?, distance_m?}]}]}]
-- Array order becomes position.
create function public.import_workouts(p_app text, p_workouts jsonb) returns integer
language plpgsql security invoker set search_path = '' as $$
declare r jsonb; e jsonb; s jsonb; v_id uuid; v_ex uuid; v_we uuid; ei int; si int; n int := 0;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_workouts is null or jsonb_typeof(p_workouts) <> 'array' then raise exception 'invalid import payload'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':workout-import', 0));
  for r in select * from jsonb_array_elements(p_workouts) loop
    insert into public.workouts (user_id, source, source_app, source_key, activity_type, started_at, ended_at, timezone,
      duration_s, distance_m, energy_kcal, notes)
    values (auth.uid(), 'import', p_app, r->>'source_key', r->>'activity_type', (r->>'started_at')::timestamptz,
      (r->>'ended_at')::timestamptz, r->>'timezone', (r->>'duration_s')::numeric, (r->>'distance_m')::numeric,
      (r->>'energy_kcal')::numeric, r->>'notes')
    on conflict (user_id, source_app, source_key) do nothing
    returning id into v_id;
    continue when v_id is null;
    n := n + 1;
    ei := 0;
    for e in select * from jsonb_array_elements(coalesce(r->'exercises', '[]'::jsonb)) loop
      select x.id into v_ex from public.exercises x where lower(x.name) = lower(btrim(e->>'name'))
        order by x.user_id nulls first limit 1;
      if v_ex is null then
        insert into public.exercises (user_id, name, category) values (auth.uid(), btrim(e->>'name'), e->>'category')
        returning id into v_ex;
      end if;
      insert into public.workout_exercises (workout_id, workout_source, exercise_id, position, notes)
      values (v_id, 'import', v_ex, ei, e->>'notes') returning id into v_we;
      si := 0;
      for s in select * from jsonb_array_elements(coalesce(e->'sets', '[]'::jsonb)) loop
        insert into public.workout_sets (workout_exercise_id, position, reps, load_kg, duration_s, distance_m)
        values (v_we, si, (s->>'reps')::int, (s->>'load_kg')::numeric, (s->>'duration_s')::numeric, (s->>'distance_m')::numeric);
        si := si + 1;
      end loop;
      ei := ei + 1;
    end loop;
  end loop;
  return n;
end $$;
revoke execute on function public.import_workouts(text, jsonb) from public, anon;
grant execute on function public.import_workouts(text, jsonb) to authenticated;

-- Same as 20261103000000_workout_sharing.sql, minus Health rows that duplicate an imported session.
create or replace function public.group_workouts(p_group_id uuid, p_from date, p_to date)
returns table (user_id uuid, week_start date, workout_count integer, total_duration_s numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_group_member(p_group_id) then
    raise exception 'not a member of this group';
  end if;
  return query
  select l.uid, l.wk, count(*)::integer, sum(l.secs)
  from (
    select w.user_id as uid,
      (w.started_at at time zone p.timezone)::date as local_day,
      date_trunc('week', w.started_at at time zone p.timezone)::date as wk,
      coalesce(w.duration_s, extract(epoch from w.ended_at - w.started_at)) as secs
    from public.workouts w
    join public.profiles p on p.id = w.user_id
    join public.metric_shares s on s.user_id = w.user_id and s.group_id = p_group_id and s.metric = 'workouts'
    where not (w.source = 'healthkit' and exists (
      select 1 from public.workouts i where i.user_id = w.user_id and i.source = 'import'
        and i.started_at < w.ended_at and i.ended_at > w.started_at))
  ) l
  where l.local_day between p_from and p_to
  group by l.uid, l.wk
  order by l.wk, l.uid;
end $$;
