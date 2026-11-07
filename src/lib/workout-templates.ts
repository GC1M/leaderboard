import type { Database } from './database.types';
import { supabase } from './supabase';
import { TEMPLATE_NAME_MAX } from './workout-template-form';
import type { ExerciseEntry } from './workouts';

type TemplateRow = Database['public']['Tables']['workout_templates']['Row'];
type SetRow = Database['public']['Tables']['workout_template_sets']['Row'];

export type WorkoutTemplate = TemplateRow;
// Planned values in canonical units (kilograms, meters, seconds), like a workout. null means not planned.
export type TemplateInput = { name: string; activityType: string; durationS?: number | null; notes?: string | null; exercises: ExerciseEntry[] };
export type TemplateDetail = WorkoutTemplate & {
  exercises: { id: string; exerciseId: string; name: string; notes: string | null; sets: SetRow[] }[];
};

const SAVE_MESSAGE = "Couldn't save your template. Check your connection and try again.";
const LOAD_MESSAGE = "Couldn't load your templates. Pull down to try again.";

async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error('Sign in to save your templates.');
  return data.user.id;
}

function validate(t: TemplateInput) {
  const name = t.name.trim();
  if (name.length < 1 || name.length > TEMPLATE_NAME_MAX) throw new Error(`Template names must be 1 to ${TEMPLATE_NAME_MAX} characters.`);
  for (const e of t.exercises)
    for (const s of e.sets)
      if ([s.reps, s.loadKg, s.durationS, s.distanceM].every((v) => v == null)) throw new Error('Each set needs a rep count, load, time, or distance.');
}

// One atomic RPC call (see save_workout_template): array order becomes `position`, for exercises and for sets.
function payload(t: TemplateInput) {
  return {
    name: t.name.trim(),
    activity_type: t.activityType.trim(),
    duration_s: t.durationS ?? null,
    notes: t.notes?.trim() || null,
    exercises: t.exercises.map((e) => ({
      exercise_id: e.exerciseId,
      notes: e.notes?.trim() || null,
      sets: e.sets.map((s) => ({ reps: s.reps ?? null, load_kg: s.loadKg ?? null, duration_s: s.durationS ?? null, distance_m: s.distanceM ?? null })),
    })),
  };
}

async function save(id: string | null, input: TemplateInput): Promise<string> {
  validate(input);
  await currentUserId();
  const { data, error } = await supabase.rpc('save_workout_template', { p_id: id as string, p_template: payload(input) });
  if (error || !data) throw new Error(SAVE_MESSAGE);
  return data;
}

// Most recently changed first. Summaries only; use getTemplate for exercises and sets.
export async function listTemplates(): Promise<WorkoutTemplate[]> {
  const user_id = await currentUserId();
  const { data, error } = await supabase.from('workout_templates').select('*').eq('user_id', user_id).order('updated_at', { ascending: false });
  if (error) throw new Error(LOAD_MESSAGE);
  return data;
}

export async function getTemplate(id: string): Promise<TemplateDetail | null> {
  const { data, error } = await supabase
    .from('workout_templates')
    .select('*, workout_template_exercises(id, exercise_id, position, notes, exercises(name), workout_template_sets(*))')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(LOAD_MESSAGE);
  if (!data) return null;
  const { workout_template_exercises, ...template } = data;
  return {
    ...template,
    exercises: [...workout_template_exercises]
      .sort((a, b) => a.position - b.position)
      .map((e) => ({
        id: e.id,
        exerciseId: e.exercise_id,
        name: e.exercises?.name ?? '',
        notes: e.notes,
        sets: [...e.workout_template_sets].sort((a, b) => a.position - b.position),
      })),
  };
}

export function createTemplate(input: TemplateInput): Promise<string> {
  return save(null, input);
}

// Replaces the exercises and sets wholesale, atomically. Workouts already made from the template are untouched.
export async function updateTemplate(id: string, input: TemplateInput): Promise<void> {
  await save(id, input);
}

// Saves a copy named "<name> copy" and returns its id. The copy is independent of the original.
export async function duplicateTemplate(id: string): Promise<string> {
  const t = await getTemplate(id);
  if (!t) throw new Error("That template doesn't exist anymore.");
  const suffix = ' copy';
  return save(null, {
    name: `${t.name.slice(0, TEMPLATE_NAME_MAX - suffix.length)}${suffix}`,
    activityType: t.activity_type,
    durationS: t.duration_s,
    notes: t.notes,
    exercises: t.exercises.map((e) => ({
      exerciseId: e.exerciseId,
      notes: e.notes,
      sets: e.sets.map((s) => ({ reps: s.reps, loadKg: s.load_kg, durationS: s.duration_s, distanceM: s.distance_m })),
    })),
  });
}

// Exercises and sets go with it (cascade). Past workouts keep their own copy of everything.
export async function deleteTemplate(id: string): Promise<void> {
  const { error } = await supabase.from('workout_templates').delete().eq('id', id);
  if (error) throw new Error("Couldn't delete that template. Check your connection and try again.");
}
