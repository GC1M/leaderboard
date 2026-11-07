import { weekStartKey } from './health/dates';
import { dateFromKey, formatSleep, type WeightUnit } from './health/format';
import { displayWeight } from './health/weight';
import { type DistanceUnit, fromMeters } from './workout-form';
import type { Workout } from './workouts';

// Pure helpers for the personal workout views: weekly history, totals, source labels and set text.
// Everything is local-time (the device's week, Monday to Sunday) and null means "not recorded", never 0.

export const WEEK_RANGES = [4, 8, 12] as const;
export type WeekRange = (typeof WEEK_RANGES)[number];

export type WeekTotals = {
  weekStart: string; // Monday, YYYY-MM-DD
  count: number;
  durationS: number;
  // Sums over the workouts that recorded the field, null when none did. A recorded 0 is a value.
  distanceM: number | null;
  distanceCount: number;
  energyKcal: number | null;
  energyCount: number;
  imported: number; // from Apple Health
  manual: number;
  fromApps: number; // imported from another app's export
};

const SOURCE_LABELS = { healthkit: 'Apple Health', manual: 'Manual' } as const;
const APP_LABELS: Record<string, string> = { strong: 'Strong', hevy: 'Hevy', fitbod: 'Fitbod', jefit: 'JEFIT' };
export const sourceLabel = (w: Pick<Workout, 'source' | 'source_app'>) =>
  w.source === 'import' ? (APP_LABELS[w.source_app ?? ''] ?? 'Imported') : SOURCE_LABELS[w.source];

// Recorded duration, else end minus start (both are always present).
export function workoutSeconds(w: Pick<Workout, 'duration_s' | 'started_at' | 'ended_at'>): number {
  return w.duration_s != null ? Number(w.duration_s) : (new Date(w.ended_at).getTime() - new Date(w.started_at).getTime()) / 1000;
}

const emptyWeek = (weekStart: string): WeekTotals => ({
  weekStart, count: 0, durationS: 0, distanceM: null, distanceCount: 0, energyKcal: null, energyCount: 0, imported: 0, manual: 0, fromApps: 0,
});

// One entry per week, oldest first, ending with the week of `now`. Weeks without workouts are kept (count 0) so
// the screen can draw them as empty; workouts outside the window are ignored.
export function weeklyTotals(workouts: readonly Workout[], weeks: number, now: Date = new Date()): WeekTotals[] {
  const out = Array.from({ length: weeks }, (_, i) => emptyWeek(weekStartKey(now, weeks - 1 - i)));
  const byWeek = new Map(out.map((t) => [t.weekStart, t]));
  for (const w of workouts) {
    const t = byWeek.get(weekStartKey(new Date(w.started_at)));
    if (!t) continue;
    t.count++;
    t.durationS += workoutSeconds(w);
    if (w.distance_m != null) {
      t.distanceM = (t.distanceM ?? 0) + Number(w.distance_m);
      t.distanceCount++;
    }
    if (w.energy_kcal != null) {
      t.energyKcal = (t.energyKcal ?? 0) + Number(w.energy_kcal);
      t.energyCount++;
    }
    if (w.source === 'manual') t.manual++;
    else if (w.source === 'import') t.fromApps++;
    else t.imported++;
  }
  return out;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

// "3 workouts", "2h 10m", then distance and energy only where some workout recorded them, saying how many did.
export function totalsParts(t: WeekTotals, unit: DistanceUnit): string[] {
  if (!t.count) return [];
  const of = (n: number) => (n < t.count ? ` (${n} of ${t.count})` : '');
  const parts = [plural(t.count, 'workout'), formatSleep(t.durationS / 60)];
  if (t.distanceM !== null) parts.push(`${fromMeters(t.distanceM, unit)} ${unit}${of(t.distanceCount)}`);
  if (t.energyKcal !== null) parts.push(`${Math.round(t.energyKcal)} kcal${of(t.energyCount)}`);
  return parts;
}

export function weekLabel(weekStart: string, now: Date = new Date()): string {
  if (weekStart === weekStartKey(now)) return 'This week';
  if (weekStart === weekStartKey(now, 1)) return 'Last week';
  const d = dateFromKey(weekStart);
  return `Week of ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }) })}`;
}

// One sentence for the bar chart: weeks without workouts are not zeros, they are weeks with nothing recorded.
export function weeksSummary(totals: readonly WeekTotals[], now: Date = new Date()): string {
  const active = totals.filter((t) => t.count > 0);
  if (!active.length) return `Last ${totals.length} weeks: no workouts recorded`;
  const sum = active.reduce((a, t) => a + t.count, 0);
  const most = active.reduce((a, t) => (t.count > a.count ? t : a));
  const without = totals.length - active.length;
  return `Last ${totals.length} weeks: ${plural(sum, 'workout')} over ${plural(active.length, 'week')} with workouts${without ? `, ${without} without` : ''}. Most ${plural(most.count, 'workout')}, ${weekLabel(most.weekStart, now).toLowerCase()}`;
}

export type SetFields = { reps: number | null; load_kg: number | null; duration_s: number | null; distance_m: number | null };

// Seconds as "45s", "10m", "1h 5m", "1m 30s". Sets can be short, so unlike formatSleep this keeps the seconds.
export function formatSetDuration(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const rest = s % 60;
  return `${formatSleep(Math.floor(s / 60))}${rest ? ` ${rest}s` : ''}`;
}

// Only what was recorded: "5 × 100 kg", "12 reps", "2.5 km, 20m". Null when the set holds nothing (it shouldn't).
export function setText(s: SetFields, weightUnit: WeightUnit, distanceUnit: DistanceUnit): string | null {
  const load = s.load_kg != null ? `${Number(displayWeight(Number(s.load_kg), weightUnit).toFixed(1))} ${weightUnit}` : null;
  const lead = s.reps != null && load ? `${s.reps} × ${load}` : s.reps != null ? plural(s.reps, 'rep') : load;
  const parts = [
    lead,
    s.distance_m != null ? `${fromMeters(Number(s.distance_m), distanceUnit)} ${distanceUnit}` : null,
    s.duration_s != null ? formatSetDuration(Number(s.duration_s)) : null,
  ].filter((p): p is string => p !== null);
  return parts.length ? parts.join(', ') : null;
}

// Local midnight of the Monday of the oldest week shown, for the history query.
export const historyStart = (weeks: number, now: Date = new Date()): Date => dateFromKey(weekStartKey(now, weeks - 1));
