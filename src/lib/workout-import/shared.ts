import type { WeightUnit } from '../health/format';
import { type DistanceUnit, toKg, toMeters } from '../workout-form';
import type { ExerciseCategory, SetInput } from '../workouts';

// The pieces every app's parser shares: the shape a parser returns, header lookup with units, numbers, dates,
// and grouping set rows into workouts. Canonical units: kg, m, s. A field the file leaves empty stays null.

export type ImportApp = 'strong' | 'hevy' | 'fitbod' | 'jefit';
export type Units = { weight: WeightUnit; distance: DistanceUnit };
export type Marker = 'warm-up' | 'drop' | 'failure';
// `row` is the record number in the file, counting the header as 1, so the preview can say which rows it skipped.
export type Skipped = { row: number; reason: string };
// One set, with the workout and exercise it belongs to repeated on it (as every supported export does).
export type SetRow = {
  row: number;
  workout: { name: string; startedAt: Date; endedAt?: Date | null; durationS?: number | null; notes?: string | null };
  exercise: string;
  exerciseNotes?: string | null;
  setNote?: string | null;
  marker?: Marker | null;
  set: SetInput;
};
export type ParsedExercise = { name: string; category: ExerciseCategory; notes: string | null; sets: SetInput[] };
export type ParsedWorkout = {
  key: string; // stable per workout in that app: start time and name
  name: string;
  startedAt: Date;
  endedAt: Date;
  durationS: number | null;
  notes: string | null;
  exercises: ParsedExercise[];
};
export type ReadResult = { rows: SetRow[]; skipped: Skipped[] };
export type ImportFormat = {
  app: ImportApp;
  label: string;
  detect: (text: string) => boolean;
  // False when the file doesn't say whether weights are kg or lb; the user then picks in the preview.
  statesUnits: (text: string) => boolean;
  read: (text: string, units: Units) => ReadResult;
};

export const NO_VALUES = 'no reps, weight, time or distance';

// Header names compared lowercased, with a trailing unit in parentheses split off: "Weight (kg)", "Weight(kg)".
export function headerIndex(header: readonly string[]) {
  const cols = header.map((h) => {
    const m = h.trim().toLowerCase().match(/^(.*?)\s*(?:\(([^)]*)\))?$/);
    return { name: m?.[1] ?? '', unit: m?.[2]?.trim() ?? '' };
  });
  const find = (...names: string[]) => cols.findIndex((c) => names.includes(c.name));
  return {
    has: (...names: string[]) => names.every((n) => find(n) >= 0),
    get: (row: readonly string[], ...names: string[]) => {
      const i = find(...names);
      return i >= 0 ? (row[i] ?? '').trim() : '';
    },
    unit: (...names: string[]) => cols[find(...names)]?.unit ?? '',
  };
}

// Empty is null. A lone comma is a decimal comma ("62,5"). Anything else that isn't a finite, non-negative number
// is NaN so the caller can skip the row and say why.
export function num(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number(/^\d+,\d+$/.test(t) ? t.replace(',', '.') : t);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

export function kg(v: number | null, unit: string, fallback: WeightUnit): number | null {
  if (v === null) return null;
  const u = unit.toLowerCase();
  return toKg(v, u === 'kg' || u === 'kgs' ? 'kg' : u === 'lb' || u === 'lbs' ? 'lb' : fallback);
}

export function meters(v: number | null, unit: string, fallback: DistanceUnit): number | null {
  if (v === null) return null;
  const u = unit.toLowerCase();
  if (u === 'm' || u === 'meters' || u === 'metres') return v;
  if (u === 'ft' || u === 'feet') return v * 0.3048;
  return toMeters(v, u === 'km' ? 'km' : u === 'mi' || u === 'miles' ? 'mi' : fallback);
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// "2024-10-26 18:05:00", "2024-10-26T18:05", "2024-10-26 6:05:00 pm" (Strong, 12-hour devices, often with a narrow
// no-break space), with or without an offset ("+0000", "Z"), or "26 Oct 2024, 18:05". No offset means the device's
// local time, which is how these apps write it. Null if it can't be read.
export function parseDate(s: string): Date | null {
  const t = s.trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?:\s*([ap])\.?m\.?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i);
  if (m) {
    const [, y, mo, d, hh = '0', mi = '0', sec = '0', ampm, off] = m;
    const h = String(ampm ? (+hh % 12) + (ampm.toLowerCase() === 'p' ? 12 : 0) : +hh);
    if (off) {
      const o = off.toUpperCase() === 'Z' ? 'Z' : `${off.slice(0, 3)}:${off.slice(-2)}`;
      return valid(new Date(`${y}-${mo}-${d}T${h.padStart(2, '0')}:${mi}:${sec.padStart(2, '0')}${o}`));
    }
    return local(+y, +mo, +d, +h, +mi, +sec);
  }
  m = t.match(/^(\d{1,2}) ([a-z]{3})[a-z]* (\d{4}),? (\d{1,2}):(\d{2})(?::(\d{2}))?$/i);
  if (m) {
    const mo = MONTHS.indexOf(m[2].toLowerCase()) + 1;
    return mo ? local(+m[3], mo, +m[1], +m[4], +m[5], +(m[6] ?? 0)) : null;
  }
  return null;
}

function local(y: number, mo: number, d: number, h: number, mi: number, s: number): Date | null {
  const date = new Date(y, mo - 1, d, h, mi, s);
  return date.getMonth() === mo - 1 && date.getDate() === d ? date : null;
}
const valid = (d: Date) => (Number.isFinite(d.getTime()) ? d : null);

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);
const MARKER_LABELS: Record<Marker, string> = { 'warm-up': 'Warm-up', drop: 'Drop set', failure: 'Failure' };

// Rows of one workout share its start time and name; consecutive rows of the same exercise are one exercise
// entry, in file order. Set markers (warm-up, drop, failure) have no column of their own, so they go into the
// exercise notes ("Warm-up: set 1, 2") instead of being dropped.
export function groupWorkouts(rows: readonly SetRow[]): ParsedWorkout[] {
  type Acc = ParsedWorkout & { last: string | null; marks: Map<Marker, number[]>[]; exNotes: Set<string>[] };
  const byKey = new Map<string, Acc>();
  for (const r of rows) {
    const name = clip(r.workout.name.trim(), 60);
    const key = clip(`${r.workout.startedAt.toISOString()}|${name}`, 200);
    let w = byKey.get(key);
    if (!w) {
      const durationS = r.workout.durationS ?? null;
      const end = r.workout.endedAt ?? (durationS !== null ? new Date(r.workout.startedAt.getTime() + durationS * 1000) : r.workout.startedAt);
      w = {
        key, name, startedAt: r.workout.startedAt, endedAt: end < r.workout.startedAt ? r.workout.startedAt : end, durationS,
        notes: r.workout.notes?.trim() ? clip(r.workout.notes.trim(), 2000) : null, exercises: [], last: null, marks: [], exNotes: [],
      };
      byKey.set(key, w);
    }
    const exName = clip(r.exercise.trim(), 80);
    if (w.last?.toLowerCase() !== exName.toLowerCase()) {
      w.exercises.push({ name: exName, category: 'strength', notes: null, sets: [] });
      w.marks.push(new Map());
      w.exNotes.push(new Set());
      w.last = exName;
    }
    const i = w.exercises.length - 1;
    const e = w.exercises[i];
    e.sets.push(r.set);
    if (r.marker) w.marks[i].set(r.marker, [...(w.marks[i].get(r.marker) ?? []), e.sets.length]);
    for (const n of [r.exerciseNotes, r.setNote]) if (n?.trim()) w.exNotes[i].add(n.trim());
  }
  return [...byKey.values()].map(({ last: _l, marks, exNotes, ...w }) => ({
    ...w,
    exercises: w.exercises.map((e, i) => {
      const lines = [...exNotes[i], ...[...marks[i]].map(([m, sets]) => `${MARKER_LABELS[m]}: set ${sets.join(', ')}`)];
      const cardio = e.sets.every((s) => s.reps == null && s.loadKg == null);
      return { ...e, category: cardio ? 'cardio' : 'strength', notes: lines.length ? clip(lines.join('\n'), 2000) : null };
    }),
  }));
}

// Shared row checks: a readable start, an exercise name, and at least one value in the set.
export function checkSet(set: SetInput): string | null {
  const values = [set.reps, set.loadKg, set.durationS, set.distanceM];
  if (values.some((v) => typeof v === 'number' && Number.isNaN(v))) return 'a value that is not a number';
  if (set.reps != null && (!Number.isInteger(set.reps) || set.reps > 10000)) return 'a rep count that is not a whole number';
  if (values.every((v) => v == null)) return NO_VALUES;
  return null;
}
