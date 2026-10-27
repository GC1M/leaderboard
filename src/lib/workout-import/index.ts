import { supabase } from '../supabase';
import { groupWorkouts, type ImportFormat, type ParsedWorkout, type Skipped, type Units } from './shared';
import { fitbod } from './fitbod';
import { hevy } from './hevy';
import { jefit } from './jefit';
import { strong } from './strong';

export type { ImportApp, ParsedWorkout, Units } from './shared';

// Workout history from other apps' CSV exports. Everything is parsed on the device; the preview shows what was
// found before anything is saved, and import_workouts stores it atomically per batch.

export const FORMATS: readonly ImportFormat[] = [strong, hevy, fitbod, jefit];

export type ImportPreview = {
  format: ImportFormat;
  workouts: ParsedWorkout[];
  sets: number;
  first: Date;
  last: Date;
  skipped: Skipped[];
  unitsInFile: boolean;
};

export const UNKNOWN_FILE = `This file isn't a workout export Leaderboard can read. Export a CSV from ${FORMATS.map((f) => f.label).join(', ')} and try again.`;

// Throws with a message for the screen when the file isn't a known export or holds no usable workouts.
export function previewImport(text: string, units: Units): ImportPreview {
  const format = FORMATS.find((f) => f.detect(text));
  if (!format) throw new Error(UNKNOWN_FILE);
  const { rows, skipped } = format.read(text, units);
  const workouts = groupWorkouts(rows).sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
  if (!workouts.length) throw new Error(`No workouts found in this ${format.label} export.`);
  return {
    format, workouts, skipped, unitsInFile: format.statesUnits(text),
    sets: rows.length, first: workouts[0].startedAt, last: workouts[workouts.length - 1].startedAt,
  };
}

// Exercise names in the file that match nothing the user can pick (catalog or their own), case-insensitively.
// The import creates these as custom exercises.
export function newExercises(workouts: readonly ParsedWorkout[], known: readonly string[]): string[] {
  const have = new Set(known.map((n) => n.toLowerCase()));
  const out = new Map<string, string>();
  for (const w of workouts) for (const e of w.exercises) if (!have.has(e.name.toLowerCase())) out.set(e.name.toLowerCase(), e.name);
  return [...out.values()].sort((a, b) => a.localeCompare(b));
}

const BATCH = 50;

// Batches keep each request small. Each batch is atomic and idempotent (a workout already imported is skipped),
// so a failure midway can be retried with the same file without duplicates.
export async function importWorkouts(preview: ImportPreview, timezone: string): Promise<{ added: number; existing: number }> {
  let added = 0;
  for (let i = 0; i < preview.workouts.length; i += BATCH) {
    const batch = preview.workouts.slice(i, i + BATCH).map((w) => ({
      source_key: w.key, activity_type: w.name, started_at: w.startedAt.toISOString(), ended_at: w.endedAt.toISOString(),
      timezone, duration_s: w.durationS, notes: w.notes,
      exercises: w.exercises.map((e) => ({
        name: e.name, category: e.category, notes: e.notes,
        sets: e.sets.map((s) => ({ reps: s.reps ?? null, load_kg: s.loadKg ?? null, duration_s: s.durationS ?? null, distance_m: s.distanceM ?? null })),
      })),
    }));
    const { data, error } = await supabase.rpc('import_workouts', { p_app: preview.format.app, p_workouts: batch });
    if (error || typeof data !== 'number') {
      throw new Error(`${added ? `Imported ${added} workouts, then the import stopped. ` : "Couldn't import your workouts. "}Check your connection and try again; workouts already imported won't be added twice.`);
    }
    added += data;
  }
  return { added, existing: preview.workouts.length - added };
}
