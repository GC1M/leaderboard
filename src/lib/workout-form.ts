import { localDateKey } from './health/dates';
import { formatSleep, type WeightUnit } from './health/format';
import { displayWeight } from './health/weight';
import type { Exercise, ExerciseCategory, ManualWorkoutInput, SetInput, Workout, WorkoutDetail } from './workouts';

// The editor works in text and display units; this module turns that into canonical kg, m and s.
// Everything here is pure so it can be tested without a screen.

export type DistanceUnit = 'km' | 'mi';
export type SetField = 'reps' | 'load' | 'duration' | 'distance';
export type SetForm = Record<SetField, string>; // load in the form's weight unit, duration in minutes, distance in its distance unit
export type ExerciseForm = { exerciseId: string; name: string; category: ExerciseCategory; sets: SetForm[] };
export type WorkoutForm = {
  activityType: string;
  date: string; // YYYY-MM-DD, local
  time: string; // HH:MM, local 24h
  durationMin: string;
  notes: string;
  weightUnit: WeightUnit;
  distanceUnit: DistanceUnit;
  exercises: ExerciseForm[];
};
export type Draft = { editingId: string | null; form: WorkoutForm };

const M_PER_MI = 1609.344;
const pad = (n: number) => String(n).padStart(2, '0');
const tidy = (n: number) => String(Number(n.toFixed(2)));
const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

// No stored preference for distance: miles where the device region is the US or UK.
export function defaultDistanceUnit(locale: string | undefined): DistanceUnit {
  return locale?.split(/[-_]/).some((p) => p === 'US' || p === 'GB') ? 'mi' : 'km';
}

export const toKg = (v: number, u: WeightUnit) => (u === 'lb' ? v / displayWeight(1, 'lb') : v);
export const toMeters = (v: number, u: DistanceUnit) => (u === 'mi' ? v * M_PER_MI : v * 1000);
const fromKg = (kg: number, u: WeightUnit) => tidy(displayWeight(kg, u));
const fromMeters = (m: number, u: DistanceUnit) => tidy(u === 'mi' ? m / M_PER_MI : m / 1000);

const FIELDS: Record<ExerciseCategory, SetField[]> = {
  strength: ['reps', 'load'],
  core: ['reps', 'duration'],
  cardio: ['duration', 'distance'],
  mobility: ['duration'],
};
export const fieldsFor = (c: ExerciseCategory): SetField[] => FIELDS[c];

export const emptySet = (): SetForm => ({ reps: '', load: '', duration: '', distance: '' });

export function emptyForm(now: Date, weightUnit: WeightUnit, distanceUnit: DistanceUnit): WorkoutForm {
  return { activityType: '', date: localDateKey(now), time: hhmm(now), durationMin: '', notes: '', weightUnit, distanceUnit, exercises: [] };
}

// Re-express typed values in new units so flipping a toggle never changes what was meant.
export function convertUnits(f: WorkoutForm, weightUnit: WeightUnit, distanceUnit: DistanceUnit): WorkoutForm {
  const conv = (s: string, to: (v: number) => number) => (/^\d*\.?\d+$/.test(s.trim()) ? tidy(to(Number(s))) : s);
  return {
    ...f,
    weightUnit,
    distanceUnit,
    exercises: f.exercises.map((e) => ({
      ...e,
      sets: e.sets.map((s) => ({
        ...s,
        load: conv(s.load, (v) => displayWeight(toKg(v, f.weightUnit), weightUnit)),
        distance: conv(s.distance, (v) => toMeters(v, f.distanceUnit) / (distanceUnit === 'mi' ? M_PER_MI : 1000)),
      })),
    })),
  };
}

export function formFromDetail(d: WorkoutDetail, weightUnit: WeightUnit, distanceUnit: DistanceUnit, categories: ReadonlyMap<string, ExerciseCategory>): WorkoutForm {
  const start = new Date(d.started_at);
  const seconds = d.duration_s ?? (new Date(d.ended_at).getTime() - start.getTime()) / 1000;
  const opt = (v: number | null, f: (n: number) => string) => (v == null ? '' : f(Number(v)));
  return {
    activityType: d.activity_type,
    date: localDateKey(start),
    time: hhmm(start),
    durationMin: tidy(seconds / 60),
    notes: d.notes ?? '',
    weightUnit,
    distanceUnit,
    exercises: d.exercises.map((e) => {
      const sets = e.sets.map((s) => ({
        reps: opt(s.reps, String),
        load: opt(s.load_kg, (n) => fromKg(n, weightUnit)),
        duration: opt(s.duration_s, (n) => tidy(n / 60)),
        distance: opt(s.distance_m, (n) => fromMeters(n, distanceUnit)),
      }));
      // Catalog unavailable: guess from what was recorded. The editor also shows any field that holds a value.
      const guess: ExerciseCategory = sets.some((s) => s.distance) ? 'cardio' : sets.some((s) => s.duration) && !sets.some((s) => s.reps || s.load) ? 'mobility' : 'strength';
      return { exerciseId: e.exerciseId, name: e.name, category: categories.get(e.exerciseId) ?? guess, sets };
    }),
  };
}

// Blank is "not recorded" (null). Zero is a real zero. Anything else must be a plain non-negative number.
function num(raw: string, what: string, whole = false): number | null {
  const s = raw.trim().replace(',', '.');
  if (s === '') return null;
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) throw new Error(`${what} must be a number.`);
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error(`${what} must be a number.`);
  if (n < 0) throw new Error(`${what} can't be negative.`);
  if (whole && !Number.isInteger(n)) throw new Error(`${what} must be a whole number.`);
  return n;
}

function parseStart(date: string, time: string): Date {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  const t = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!d) throw new Error('Enter the date as YYYY-MM-DD.');
  if (!t) throw new Error('Enter the start time as HH:MM, for example 18:30.');
  const [y, mo, da, h, mi] = [d[1], d[2], d[3], t[1], t[2]].map(Number);
  const at = new Date(y, mo - 1, da, h, mi);
  if (at.getFullYear() !== y || at.getMonth() !== mo - 1 || at.getDate() !== da || at.getHours() !== h || at.getMinutes() !== mi) throw new Error('That date or time does not exist.');
  return at;
}

export type Built = { ok: true; input: ManualWorkoutInput } | { ok: false; message: string };

// Validates and converts to canonical units. The end time is start plus duration, so an end before the
// start shows up as a negative duration and is rejected. Never produces calories: manual entry has none.
export function buildWorkout(f: WorkoutForm): Built {
  try {
    const activityType = f.activityType.trim();
    if (!activityType) throw new Error('Enter an activity type, for example Strength or Running.');
    if (activityType.length > 60) throw new Error('The activity type must be 60 characters or fewer.');
    if (f.notes.length > 2000) throw new Error('Notes must be 2,000 characters or fewer.');
    const startedAt = parseStart(f.date, f.time);
    const minutes = num(f.durationMin, 'Duration');
    if (minutes === null) throw new Error('Enter how long the workout lasted.');
    if (minutes === 0) throw new Error('The duration must be more than zero.');
    const exercises = f.exercises.map((e) => {
      if (!e.sets.length) throw new Error(`Add at least one set to ${e.name}, or remove it.`);
      return {
        exerciseId: e.exerciseId,
        sets: e.sets.map((s, i): SetInput => {
          const at = `${e.name} set ${i + 1}`;
          const reps = num(s.reps, `${at} reps`, true);
          if (reps !== null && reps > 10000) throw new Error(`${at} reps must be 10,000 or fewer.`);
          const load = num(s.load, `${at} load`);
          const mins = num(s.duration, `${at} time`);
          const dist = num(s.distance, `${at} distance`);
          if (reps === null && load === null && mins === null && dist === null) throw new Error(`${at} needs reps, load, time, or distance.`);
          return {
            reps,
            loadKg: load === null ? null : toKg(load, f.weightUnit),
            durationS: mins === null ? null : mins * 60,
            distanceM: dist === null ? null : toMeters(dist, f.distanceUnit),
          };
        }),
      };
    });
    return {
      ok: true,
      input: {
        activityType,
        startedAt,
        endedAt: new Date(startedAt.getTime() + minutes * 60000),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        durationS: minutes * 60,
        notes: f.notes,
        exercises,
      },
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Check your entries and try again.' };
  }
}

// Case-insensitive substring match on name, names that start with the query first.
export function filterExercises(all: readonly Exercise[], query: string): Exercise[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...all];
  const starts = (e: Exercise) => e.name.toLowerCase().startsWith(q);
  const hits = all.filter((e) => e.name.toLowerCase().includes(q));
  return [...hits.filter(starts), ...hits.filter((e) => !starts(e))];
}

export const serializeDraft = (d: Draft) => JSON.stringify({ v: 1, ...d });

const isStr = (v: unknown): v is string => typeof v === 'string';
const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

// Anything unexpected (older version, corrupt value) is no draft rather than a crash.
export function parseDraft(raw: string | null): Draft | null {
  try {
    const d: unknown = raw ? JSON.parse(raw) : null;
    if (!isRec(d) || d.v !== 1 || !(d.editingId === null || isStr(d.editingId)) || !isRec(d.form)) return null;
    const f = d.form;
    const ok =
      [f.activityType, f.date, f.time, f.durationMin, f.notes].every(isStr) &&
      (f.weightUnit === 'kg' || f.weightUnit === 'lb') &&
      (f.distanceUnit === 'km' || f.distanceUnit === 'mi') &&
      Array.isArray(f.exercises) &&
      f.exercises.every(
        (e) =>
          isRec(e) && isStr(e.exerciseId) && isStr(e.name) && isStr(e.category) && e.category in FIELDS &&
          Array.isArray(e.sets) && e.sets.every((s) => isRec(s) && (['reps', 'load', 'duration', 'distance'] as const).every((k) => isStr(s[k]))),
      );
    return ok ? { editingId: d.editingId as string | null, form: f as unknown as WorkoutForm } : null;
  } catch {
    return null;
  }
}

// One line for a list row: how long, how far. Calories only when Health measured them.
export function workoutSummary(w: Workout, distanceUnit: DistanceUnit): string {
  const seconds = w.duration_s ?? (new Date(w.ended_at).getTime() - new Date(w.started_at).getTime()) / 1000;
  const parts = [formatSleep(seconds / 60)];
  if (w.distance_m != null) parts.push(`${fromMeters(Number(w.distance_m), distanceUnit)} ${distanceUnit}`);
  if (w.source === 'healthkit' && w.energy_kcal != null) parts.push(`${Math.round(Number(w.energy_kcal))} kcal`);
  return parts.join(', ');
}
