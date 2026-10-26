import type { Database } from './database.types';
import { supabase } from './supabase';

type WorkoutRow = Database['public']['Tables']['workouts']['Row'];
type SetRow = Database['public']['Tables']['workout_sets']['Row'];

// source 'healthkit' = imported summary (no exercises or sets); 'manual' = app-authored log.
export type Workout = Omit<WorkoutRow, 'source'> & { source: 'healthkit' | 'manual' };
export type ExerciseCategory = 'strength' | 'cardio' | 'core' | 'mobility';
export type Exercise = { id: string; name: string; category: ExerciseCategory; isCustom: boolean };
// Canonical units: kilograms, meters, seconds. null means not recorded; 0 means a recorded zero.
export type SetInput = { reps?: number | null; loadKg?: number | null; durationS?: number | null; distanceM?: number | null };
export type ExerciseEntry = { exerciseId: string; notes?: string | null; sets: SetInput[] };
export type ManualWorkoutInput = {
  activityType: string;
  startedAt: Date;
  endedAt: Date;
  timezone: string;
  durationS?: number | null;
  distanceM?: number | null;
  energyKcal?: number | null;
  notes?: string | null;
  exercises: ExerciseEntry[];
};
export type WorkoutDetail = Workout & {
  exercises: { id: string; exerciseId: string; name: string; notes: string | null; sets: SetRow[] }[];
};

const SAVE_MESSAGE = "Couldn't save your workout. Check your connection and try again.";
const LOAD_MESSAGE = "Couldn't load your workouts. Pull down to try again.";

async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error('Sign in to save your workouts.');
  return data.user.id;
}

function validate(w: ManualWorkoutInput) {
  if (w.endedAt < w.startedAt) throw new Error('A workout cannot end before it starts.');
  for (const e of w.exercises)
    for (const s of e.sets)
      if ([s.reps, s.loadKg, s.durationS, s.distanceM].every((v) => v == null)) throw new Error('Each set needs a rep count, load, time, or distance.');
}

function workoutColumns(w: ManualWorkoutInput) {
  return {
    activity_type: w.activityType.trim(),
    started_at: w.startedAt.toISOString(),
    ended_at: w.endedAt.toISOString(),
    timezone: w.timezone,
    duration_s: w.durationS ?? null,
    distance_m: w.distanceM ?? null,
    energy_kcal: w.energyKcal ?? null,
    notes: w.notes?.trim() || null,
  };
}

// Array order becomes `position`, for exercises and for sets within each exercise.
async function insertExercises(workoutId: string, exercises: ExerciseEntry[]): Promise<void> {
  if (exercises.length === 0) return;
  const { data, error } = await supabase
    .from('workout_exercises')
    .insert(exercises.map((e, position) => ({ workout_id: workoutId, exercise_id: e.exerciseId, position, notes: e.notes?.trim() || null })))
    .select('id, position');
  if (error) throw new Error(SAVE_MESSAGE);
  const idByPosition = new Map(data.map((r) => [r.position, r.id]));
  const sets = exercises.flatMap((e, ei) =>
    e.sets.map((s, position) => ({
      workout_exercise_id: idByPosition.get(ei)!,
      position,
      reps: s.reps ?? null,
      load_kg: s.loadKg ?? null,
      duration_s: s.durationS ?? null,
      distance_m: s.distanceM ?? null,
    })),
  );
  if (sets.length === 0) return;
  const { error: setsError } = await supabase.from('workout_sets').insert(sets);
  if (setsError) throw new Error(SAVE_MESSAGE);
}

// Newest first. Summaries only; use getWorkout for exercises and sets.
export async function listWorkouts(limit = 50): Promise<Workout[]> {
  const user_id = await currentUserId();
  const { data, error } = await supabase
    .from('workouts')
    .select('*')
    .eq('user_id', user_id)
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(LOAD_MESSAGE);
  return data as Workout[];
}

export async function getWorkout(id: string): Promise<WorkoutDetail | null> {
  const { data, error } = await supabase
    .from('workouts')
    .select('*, workout_exercises(id, exercise_id, position, notes, exercises(name), workout_sets(*))')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(LOAD_MESSAGE);
  if (!data) return null;
  const { workout_exercises, ...workout } = data;
  return {
    ...(workout as Workout),
    exercises: [...workout_exercises]
      .sort((a, b) => a.position - b.position)
      .map((e) => ({
        id: e.id,
        exerciseId: e.exercise_id,
        name: e.exercises?.name ?? '',
        notes: e.notes,
        sets: [...e.workout_sets].sort((a, b) => a.position - b.position),
      })),
  };
}

export async function createManualWorkout(input: ManualWorkoutInput): Promise<string> {
  validate(input);
  const user_id = await currentUserId();
  const { data, error } = await supabase
    .from('workouts')
    .insert({ user_id, source: 'manual', ...workoutColumns(input) })
    .select('id')
    .single();
  if (error) throw new Error(SAVE_MESSAGE);
  try {
    await insertExercises(data.id, input.exercises);
  } catch (e) {
    await supabase.from('workouts').delete().eq('id', data.id); // don't leave a half-saved log
    throw e;
  }
  return data.id;
}

// Replaces the exercises and sets wholesale. Manual workouts only; imported summaries are never edited here.
// ponytail: not atomic (a failed re-insert loses the old detail); move to an RPC if that bites.
export async function updateManualWorkout(id: string, input: ManualWorkoutInput): Promise<void> {
  validate(input);
  const { data, error } = await supabase.from('workouts').update(workoutColumns(input)).eq('id', id).eq('source', 'manual').select('id');
  if (error || data.length === 0) throw new Error(SAVE_MESSAGE);
  const { error: delError } = await supabase.from('workout_exercises').delete().eq('workout_id', id);
  if (delError) throw new Error(SAVE_MESSAGE);
  await insertExercises(id, input.exercises);
}

// Exercises and sets go with it (cascade).
export async function deleteWorkout(id: string): Promise<void> {
  const { error } = await supabase.from('workouts').delete().eq('id', id);
  if (error) throw new Error("Couldn't delete that workout. Check your connection and try again.");
}

// Starter catalog plus the user's own, by name.
export async function listExercises(): Promise<Exercise[]> {
  const { data, error } = await supabase.from('exercises').select('id, user_id, name, category').order('name');
  if (error) throw new Error("Couldn't load exercises. Pull down to try again.");
  return data.map((r) => ({ id: r.id, name: r.name, category: r.category as ExerciseCategory, isCustom: r.user_id !== null }));
}

export async function createCustomExercise(name: string, category: ExerciseCategory): Promise<Exercise> {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 80) throw new Error('Exercise names must be 1 to 80 characters.');
  const user_id = await currentUserId();
  const { data, error } = await supabase.from('exercises').insert({ user_id, name: trimmed, category }).select('id, name, category').single();
  if (error) throw new Error(error.code === '23505' ? 'You already have an exercise with that name.' : "Couldn't save that exercise. Try again.");
  return { id: data.id, name: data.name, category, isCustom: true };
}
