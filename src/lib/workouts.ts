import type { Database } from './database.types';
import { supabase } from './supabase';

type WorkoutRow = Database['public']['Tables']['workouts']['Row'];
type SetRow = Database['public']['Tables']['workout_sets']['Row'];

// source 'healthkit' = imported summary (no exercises or sets); 'manual' = app-authored log; 'import' = detailed log
// from another app's export (source_app says which), edited like a manual one.
export type Workout = Omit<WorkoutRow, 'source'> & { source: 'healthkit' | 'manual' | 'import' };
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

// One atomic RPC call (see save_manual_workout): array order becomes `position`, for exercises and for sets.
function payload(w: ManualWorkoutInput) {
  return {
    activity_type: w.activityType.trim(),
    started_at: w.startedAt.toISOString(),
    ended_at: w.endedAt.toISOString(),
    timezone: w.timezone,
    duration_s: w.durationS ?? null,
    distance_m: w.distanceM ?? null,
    energy_kcal: w.energyKcal ?? null,
    notes: w.notes?.trim() || null,
    exercises: w.exercises.map((e) => ({
      exercise_id: e.exerciseId,
      notes: e.notes?.trim() || null,
      sets: e.sets.map((s) => ({ reps: s.reps ?? null, load_kg: s.loadKg ?? null, duration_s: s.durationS ?? null, distance_m: s.distanceM ?? null })),
    })),
  };
}

async function save(id: string | null, input: ManualWorkoutInput): Promise<string> {
  validate(input);
  await currentUserId();
  const { data, error } = await supabase.rpc('save_manual_workout', { p_id: id as string, p_workout: payload(input) });
  if (error || !data) throw new Error(SAVE_MESSAGE);
  return data;
}

// Apps like Strong also write each session to Apple Health, so the Health importer brings in a summary of a
// workout the file import already has in detail. A Health workout that overlaps an imported one is that copy:
// it's left out here, as group_workouts leaves it out of group totals.
export function hideHealthDuplicates(rows: readonly Workout[]): Workout[] {
  const t = (s: string) => new Date(s).getTime();
  const imports = rows.filter((w) => w.source === 'import');
  return rows.filter((w) => w.source !== 'healthkit' || !imports.some((i) => t(i.started_at) < t(w.ended_at) && t(i.ended_at) > t(w.started_at)));
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
  return hideHealthDuplicates(data as Workout[]);
}

// Everything that started on or after `from`, newest first, for weekly history. Summaries only.
export async function listWorkoutsSince(from: Date): Promise<Workout[]> {
  const user_id = await currentUserId();
  const { data, error } = await supabase
    .from('workouts')
    .select('*')
    .eq('user_id', user_id)
    .gte('started_at', from.toISOString())
    .order('started_at', { ascending: false })
    .limit(1000);
  if (error) throw new Error(LOAD_MESSAGE);
  return hideHealthDuplicates(data as Workout[]);
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

export function createManualWorkout(input: ManualWorkoutInput): Promise<string> {
  return save(null, input);
}

// Replaces the exercises and sets wholesale, atomically. Manual workouts only; imported summaries are never edited here.
export async function updateManualWorkout(id: string, input: ManualWorkoutInput): Promise<void> {
  await save(id, input);
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
