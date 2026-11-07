-- #122: decimal measurements must remain finite on direct API writes as well as through the editors.
-- Existing integer reps/positions and steps_sanity_cap already enforce whole-number counts.
alter table public.workouts add constraint workouts_finite_measurements check (
  (duration_s is null or duration_s < 'Infinity'::numeric) and
  (distance_m is null or distance_m < 'Infinity'::numeric) and
  (energy_kcal is null or energy_kcal < 'Infinity'::numeric)
);
alter table public.workout_sets add constraint workout_sets_finite_measurements check (
  (load_kg is null or load_kg < 'Infinity'::numeric) and
  (duration_s is null or duration_s < 'Infinity'::numeric) and
  (distance_m is null or distance_m < 'Infinity'::numeric)
);
alter table public.workout_templates add constraint workout_templates_finite_duration check (
  duration_s is null or duration_s < 'Infinity'::numeric
);
alter table public.workout_template_sets add constraint workout_template_sets_finite_measurements check (
  (load_kg is null or load_kg < 'Infinity'::numeric) and
  (duration_s is null or duration_s < 'Infinity'::numeric) and
  (distance_m is null or distance_m < 'Infinity'::numeric)
);
