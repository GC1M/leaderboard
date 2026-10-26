-- Issue #32: reusable workout templates. Owner-only and never shared. A template is a plan, not a
-- session: applying one copies its values into a new manual workout (the app does this in the editor),
-- and nothing here links a workout back to the template it came from, so editing or deleting a template
-- can never alter past sessions. Same units as workouts: seconds, meters, kilograms.
create table public.workout_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  activity_type text not null check (char_length(activity_type) between 1 and 60),
  -- Planned total duration; null = leave it for the day.
  duration_s numeric check (duration_s > 0),
  notes text check (char_length(notes) <= 2000),
  updated_at timestamptz not null default now()
);
create index on public.workout_templates (user_id, updated_at desc);

create table public.workout_template_exercises (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.workout_templates on delete cascade,
  exercise_id uuid not null references public.exercises,
  position integer not null check (position >= 0),
  notes text check (char_length(notes) <= 2000),
  unique (template_id, position) deferrable initially deferred
);
create index on public.workout_template_exercises (exercise_id);

-- Planned sets. Every field is a target and optional, but a set needs at least one, as in workout_sets.
create table public.workout_template_sets (
  id uuid primary key default gen_random_uuid(),
  template_exercise_id uuid not null references public.workout_template_exercises on delete cascade,
  position integer not null check (position >= 0),
  reps integer check (reps >= 0 and reps <= 10000),
  load_kg numeric check (load_kg >= 0),
  duration_s numeric check (duration_s >= 0),
  distance_m numeric check (distance_m >= 0),
  check (num_nonnulls(reps, load_kg, duration_s, distance_m) >= 1),
  unique (template_exercise_id, position) deferrable initially deferred
);

create trigger workout_templates_touch before update on public.workout_templates
  for each row execute function public.touch_updated_at();

alter table public.workout_templates enable row level security;
alter table public.workout_template_exercises enable row level security;
alter table public.workout_template_sets enable row level security;
revoke all on public.workout_templates, public.workout_template_exercises, public.workout_template_sets from anon;

create policy workout_templates_all on public.workout_templates for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- The exercise subquery runs under the caller's RLS, so only catalog or own exercises can be referenced.
create policy workout_template_exercises_all on public.workout_template_exercises for all to authenticated
  using (exists (select 1 from public.workout_templates t where t.id = template_id and t.user_id = (select auth.uid())))
  with check (
    exists (select 1 from public.workout_templates t where t.id = template_id and t.user_id = (select auth.uid()))
    and exists (select 1 from public.exercises e where e.id = exercise_id)
  );

create policy workout_template_sets_all on public.workout_template_sets for all to authenticated
  using (exists (
    select 1 from public.workout_template_exercises te join public.workout_templates t on t.id = te.template_id
    where te.id = template_exercise_id and t.user_id = (select auth.uid())))
  with check (exists (
    select 1 from public.workout_template_exercises te join public.workout_templates t on t.id = te.template_id
    where te.id = template_exercise_id and t.user_id = (select auth.uid())));

-- Atomic save of a template with its exercises and sets. Insert when p_id is null, else update and
-- replace the children. security invoker: RLS still decides what the caller may touch. p_template shape:
-- {name, activity_type, duration_s?, notes?,
--  exercises: [{exercise_id, notes?, sets: [{reps?, load_kg?, duration_s?, distance_m?}]}]}
-- Array order becomes position. Account deletion needs nothing extra: delete_my_account removes the
-- auth user, which cascades through profiles to templates and on to their exercises and sets.
create function public.save_workout_template(p_id uuid, p_template jsonb) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare v_id uuid; e jsonb; s jsonb; v_te uuid; ei int; si int;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_id is null then
    insert into public.workout_templates (user_id, name, activity_type, duration_s, notes)
    values (auth.uid(), p_template->>'name', p_template->>'activity_type',
      (p_template->>'duration_s')::numeric, p_template->>'notes')
    returning id into v_id;
  else
    update public.workout_templates set name = p_template->>'name', activity_type = p_template->>'activity_type',
      duration_s = (p_template->>'duration_s')::numeric, notes = p_template->>'notes'
    where id = p_id and user_id = auth.uid()
    returning id into v_id;
    if v_id is null then raise exception 'template not found'; end if;
    delete from public.workout_template_exercises where template_id = v_id;
  end if;
  ei := 0;
  for e in select * from jsonb_array_elements(coalesce(p_template->'exercises', '[]'::jsonb)) loop
    insert into public.workout_template_exercises (template_id, exercise_id, position, notes)
    values (v_id, (e->>'exercise_id')::uuid, ei, e->>'notes') returning id into v_te;
    si := 0;
    for s in select * from jsonb_array_elements(coalesce(e->'sets', '[]'::jsonb)) loop
      insert into public.workout_template_sets (template_exercise_id, position, reps, load_kg, duration_s, distance_m)
      values (v_te, si, (s->>'reps')::int, (s->>'load_kg')::numeric, (s->>'duration_s')::numeric, (s->>'distance_m')::numeric);
      si := si + 1;
    end loop;
    ei := ei + 1;
  end loop;
  return v_id;
end $$;
revoke execute on function public.save_workout_template(uuid, jsonb) from public, anon;
grant execute on function public.save_workout_template(uuid, jsonb) to authenticated;
