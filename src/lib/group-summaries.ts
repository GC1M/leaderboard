import { readingDateLabel } from './health/dates';
import { dateFromKey, formatSleep, formatWeight, type WeightUnit } from './health/format';
import type { SharedMetric } from './groups';
import { roundNutrient } from './food/nutrition';
import { weekLabel } from './workout-history';

// recorded: has a value (0 is a value). no_data: shared, but nothing synced. not_shared: no value and no hint
// whether data exists.
export type Summary = { state: 'not_shared' } | { state: 'no_data' } | { state: 'recorded'; value: number; date: string };

// Workouts are shared as one weekly summary: how many and how long, never what was done.
export type WorkoutSummary =
  | { state: 'not_shared' }
  | { state: 'no_data' }
  | { state: 'recorded'; count: number; durationS: number; weekStart: string };

// Food is shared as daily totals: how much, never what. A null total is a nutrient no entry knew, and incomplete
// means some entries did not know it, so the total is a lower bound. A day without entries is no data, never 0.
type Total = { value: number | null; incomplete: boolean };
export type FoodSummary =
  | { state: 'not_shared' }
  | { state: 'no_data' }
  | { state: 'recorded'; date: string; energy: Total; protein: Total; carbs: Total; fat: Total };

export type MemberSummary = { userId: string; name: string; sleep: Summary; weight: Summary; workouts: WorkoutSummary; food: FoodSummary };

type Slept = { user_id: string; date: string; minutes: number };
type Weighed = { user_id: string; measured_on: string; kg: number };
type Ate = {
  user_id: string; local_date: string;
  energy_kcal: number | null; protein_g: number | null; carbs_g: number | null; fat_g: number | null;
  energy_kcal_incomplete: boolean; protein_g_incomplete: boolean; carbs_g_incomplete: boolean; fat_g_incomplete: boolean;
};
type Worked = { user_id: string; week_start: string; workout_count: number; total_duration_s: number };

function pick(shared: boolean, found: { value: number; date: string } | undefined): Summary {
  if (!shared) return { state: 'not_shared' };
  return found ? { state: 'recorded', ...found } : { state: 'no_data' };
}

function pickWorkouts(shared: boolean, found: Worked | undefined): WorkoutSummary {
  if (!shared) return { state: 'not_shared' };
  return found
    ? { state: 'recorded', count: Number(found.workout_count), durationS: Number(found.total_duration_s), weekStart: found.week_start }
    : { state: 'no_data' };
}

const total = (v: number | null, incomplete: boolean): Total => ({ value: v == null ? null : Number(v), incomplete });

function pickFood(shared: boolean, found: Ate | undefined): FoodSummary {
  if (!shared) return { state: 'not_shared' };
  if (!found) return { state: 'no_data' };
  return {
    state: 'recorded', date: found.local_date,
    energy: total(found.energy_kcal, found.energy_kcal_incomplete), protein: total(found.protein_g, found.protein_g_incomplete),
    carbs: total(found.carbs_g, found.carbs_g_incomplete), fat: total(found.fat_g, found.fat_g_incomplete),
  };
}

// Merges members, who shares what, and the readings the server returned into one row per member.
// The latest sleep date wins; the server already returns only the latest weight per member.
export function buildMemberSummaries(
  members: { userId: string; name: string }[],
  shares: Record<string, SharedMetric[]>,
  sleep: Slept[],
  weights: Weighed[],
  workouts: Worked[] = [],
  food: Ate[] = [],
): MemberSummary[] {
  const lastSleep = new Map<string, { value: number; date: string }>();
  for (const r of sleep) {
    const prev = lastSleep.get(r.user_id);
    if (!prev || r.date > prev.date) lastSleep.set(r.user_id, { value: Number(r.minutes), date: r.date });
  }
  const weight = new Map(weights.map((r) => [r.user_id, { value: Number(r.kg), date: r.measured_on }]));
  // The latest week the member has any workouts in.
  const lastWeek = new Map<string, Worked>();
  for (const r of workouts) {
    const prev = lastWeek.get(r.user_id);
    if (!prev || r.week_start > prev.week_start) lastWeek.set(r.user_id, r);
  }
  // The latest day the member logged any food on.
  const lastFood = new Map<string, Ate>();
  for (const r of food) {
    const prev = lastFood.get(r.user_id);
    if (!prev || r.local_date > prev.local_date) lastFood.set(r.user_id, r);
  }
  return members.map((m) => ({
    userId: m.userId,
    name: m.name,
    sleep: pick(shares[m.userId]?.includes('sleep') ?? false, lastSleep.get(m.userId)),
    weight: pick(shares[m.userId]?.includes('weight') ?? false, weight.get(m.userId)),
    workouts: pickWorkouts(shares[m.userId]?.includes('workouts') ?? false, lastWeek.get(m.userId)),
    food: pickFood(shares[m.userId]?.includes('food') ?? false, lastFood.get(m.userId)),
  }));
}

const text = (s: Summary, fmt: (v: number) => string, now: Date) =>
  s.state === 'not_shared'
    ? 'Not shared'
    : s.state === 'no_data'
      ? 'No data'
      : `${fmt(s.value)}, ${readingDateLabel(dateFromKey(s.date), now)}`;

export const sleepText = (s: Summary, now: Date = new Date()) => text(s, formatSleep, now);
export const weightText = (s: Summary, unit: WeightUnit, now: Date = new Date()) =>
  text(s, (kg) => formatWeight(kg, unit), now);

export function workoutsText(s: WorkoutSummary, now: Date = new Date()) {
  if (s.state === 'not_shared') return 'Not shared';
  if (s.state === 'no_data') return 'No recent workouts';
  return `${s.count} ${s.count === 1 ? 'workout' : 'workouts'}, ${formatSleep(s.durationS / 60)}, ${weekLabel(s.weekStart, now).toLowerCase()}`;
}

// "1,850 kcal, protein 80 g, carbs 200 g, fat 60 g, today". An incomplete total reads "at least"; an unknown one
// is left out; a day logged with nothing known says so. "No food logged" is never "0 kcal".
export function foodText(s: FoodSummary, now: Date = new Date()) {
  if (s.state === 'not_shared') return 'Not shared';
  if (s.state === 'no_data') return 'No food logged this week';
  const part = (label: string, key: 'energy_kcal' | 'protein_g' | 'carbs_g' | 'fat_g', unit: string, t: Total) => {
    const v = roundNutrient(key, t.value);
    return v == null ? null : `${label}${t.incomplete ? 'at least ' : ''}${key === 'energy_kcal' ? v.toLocaleString('en-US') : v} ${unit}`;
  };
  const parts = [
    part('', 'energy_kcal', 'kcal', s.energy), part('protein ', 'protein_g', 'g', s.protein),
    part('carbs ', 'carbs_g', 'g', s.carbs), part('fat ', 'fat_g', 'g', s.fat),
  ].filter((p): p is string => p !== null);
  return `${parts.length ? parts.join(', ') : 'Logged, amounts unknown'}, ${readingDateLabel(dateFromKey(s.date), now).toLowerCase()}`;
}
