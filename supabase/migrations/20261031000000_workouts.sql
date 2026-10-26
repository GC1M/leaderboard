-- Issue #29: workout sessions, exercises, ordered sets. All access is owner-only; nothing here is shared.
-- source = 'healthkit' rows are imported summaries (no exercises or sets). source = 'manual' rows are
-- app-authored logs and may carry exercises and sets. Every measurement is nullable: an unavailable
-- field stays null, and a recorded zero stays 0. Canonical units: seconds, meters, kilograms, kcal.
create table public.workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles on delete cascade,
  source text not null check (source in ('healthkit', 'manual')),
  activity_type text not null check (char_length(activity_type) between 1 and 60),
  started_at timestamptz not null,
  ended_at timestamptz not null,
  timezone text not null,
  duration_s numeric check (duration_s >= 0),
  distance_m numeric check (distance_m >= 0),
  energy_kcal numeric check (energy_kcal >= 0),
  notes text check (char_length(notes) <= 2000),
  -- Stable Health identity, same device-ownership idea as daily_metrics.health_device_id.
  health_uuid uuid,
  health_device_id uuid,
  updated_at timestamptz not null default now(),
  check (ended_at >= started_at),
  check ((source = 'healthkit') = (health_uuid is not null and health_device_id is not null)),
  check (source = 'healthkit' or (health_uuid is null and health_device_id is null)),
  unique (id, source),
  unique (user_id, health_uuid)
);
create index on public.workouts (user_id, started_at desc);

create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  -- null = starter catalog row, visible to everyone and writable by no one through the API.
  user_id uuid references public.profiles on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  category text not null check (category in ('strength', 'cardio', 'core', 'mobility')),
  updated_at timestamptz not null default now()
);
create unique index exercises_catalog_name on public.exercises (lower(name)) where user_id is null;
create unique index exercises_user_name on public.exercises (user_id, lower(name)) where user_id is not null;

create table public.workout_exercises (
  id uuid primary key default gen_random_uuid(),
  workout_id uuid not null,
  -- Fixed to 'manual' so imported summaries can't have detail rows.
  workout_source text not null default 'manual' check (workout_source = 'manual'),
  exercise_id uuid not null references public.exercises,
  position integer not null check (position >= 0),
  notes text check (char_length(notes) <= 2000),
  foreign key (workout_id, workout_source) references public.workouts (id, source) on delete cascade,
  unique (workout_id, position) deferrable initially deferred
);
create index on public.workout_exercises (exercise_id);

create table public.workout_sets (
  id uuid primary key default gen_random_uuid(),
  workout_exercise_id uuid not null references public.workout_exercises on delete cascade,
  position integer not null check (position >= 0),
  reps integer check (reps >= 0 and reps <= 10000),
  load_kg numeric check (load_kg >= 0),
  duration_s numeric check (duration_s >= 0),
  distance_m numeric check (distance_m >= 0),
  check (num_nonnulls(reps, load_kg, duration_s, distance_m) >= 1),
  unique (workout_exercise_id, position) deferrable initially deferred
);

create trigger workouts_touch before update on public.workouts
  for each row execute function public.touch_updated_at();
create trigger exercises_touch before update on public.exercises
  for each row execute function public.touch_updated_at();

alter table public.workouts enable row level security;
alter table public.exercises enable row level security;
alter table public.workout_exercises enable row level security;
alter table public.workout_sets enable row level security;

create policy workouts_all on public.workouts for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy exercises_select on public.exercises for select to authenticated
  using (user_id is null or user_id = (select auth.uid()));
create policy exercises_write on public.exercises for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- The exercise subquery runs under the caller's RLS, so only catalog or own exercises can be referenced.
create policy workout_exercises_all on public.workout_exercises for all to authenticated
  using (exists (select 1 from public.workouts w where w.id = workout_id and w.user_id = (select auth.uid())))
  with check (
    exists (select 1 from public.workouts w where w.id = workout_id and w.user_id = (select auth.uid()))
    and exists (select 1 from public.exercises e where e.id = exercise_id)
  );

create policy workout_sets_all on public.workout_sets for all to authenticated
  using (exists (
    select 1 from public.workout_exercises we join public.workouts w on w.id = we.workout_id
    where we.id = workout_exercise_id and w.user_id = (select auth.uid())))
  with check (exists (
    select 1 from public.workout_exercises we join public.workouts w on w.id = we.workout_id
    where we.id = workout_exercise_id and w.user_id = (select auth.uid())));

insert into public.exercises (name, category) values
  ('Barbell Back Squat', 'strength'), ('Front Squat', 'strength'), ('Deadlift', 'strength'),
  ('Romanian Deadlift', 'strength'), ('Bench Press', 'strength'), ('Incline Dumbbell Press', 'strength'),
  ('Overhead Press', 'strength'), ('Barbell Row', 'strength'), ('Dumbbell Row', 'strength'),
  ('Pull-Up', 'strength'), ('Lat Pulldown', 'strength'), ('Push-Up', 'strength'),
  ('Dip', 'strength'), ('Lunge', 'strength'), ('Leg Press', 'strength'),
  ('Leg Curl', 'strength'), ('Leg Extension', 'strength'), ('Calf Raise', 'strength'),
  ('Hip Thrust', 'strength'), ('Bicep Curl', 'strength'), ('Tricep Pushdown', 'strength'),
  ('Lateral Raise', 'strength'), ('Face Pull', 'strength'), ('Plank', 'core'),
  ('Crunch', 'core'), ('Hanging Leg Raise', 'core'), ('Running', 'cardio'),
  ('Cycling', 'cardio'), ('Rowing Machine', 'cardio'), ('Jump Rope', 'cardio'),
  ('Walking', 'cardio'), ('Stretching', 'mobility');
