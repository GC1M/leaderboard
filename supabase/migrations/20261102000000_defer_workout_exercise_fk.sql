-- Deleting an account cascades from profiles to both workouts and exercises. With a plain FK, whether
-- that succeeds depends on which cascade Postgres runs first (FK creation order). Deferring the check to
-- commit makes it order-independent, matching workout_template_exercises.exercise_id.
alter table public.workout_exercises
  alter constraint workout_exercises_exercise_id_fkey deferrable initially deferred;
