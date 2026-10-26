import { isOwnExport } from './export-metadata';
import { loadHealthKit } from './healthkit';
import type { ChangePage, JournalState, StoredSample } from './changes';

// One imported workout, in the shape apply_health_workouts expects. A missing value is null, never 0.
export type WorkoutChange = {
  health_uuid: string; activity_type: string; started_at: string; ended_at: string; timezone: string;
  duration_s: number | null; distance_m: number | null; energy_kcal: number | null;
};
type Quantity = { unit: string; quantity: number };
export type HealthWorkout = {
  uuid: string; startDate: Date; endDate: Date; workoutActivityType: number; metadata?: { [key: string]: unknown } | null;
  duration?: Quantity; totalDistance?: Quantity; totalEnergyBurned?: Quantity;
};

// HKWorkoutActivityType raw values (WorkoutActivityType in the native module). Anything not listed, including types
// added by newer iOS versions, is imported as 'Other': the session still counts, only its label is generic.
const ACTIVITY_NAMES: Record<number, string> = {
  1: 'American Football', 2: 'Archery', 3: 'Australian Football', 4: 'Badminton', 5: 'Baseball', 6: 'Basketball',
  7: 'Bowling', 8: 'Boxing', 9: 'Climbing', 10: 'Cricket', 11: 'Cross Training', 12: 'Curling', 13: 'Cycling',
  14: 'Dance', 15: 'Dance Inspired Training', 16: 'Elliptical', 17: 'Equestrian Sports', 18: 'Fencing', 19: 'Fishing',
  20: 'Functional Strength Training', 21: 'Golf', 22: 'Gymnastics', 23: 'Handball', 24: 'Hiking', 25: 'Hockey',
  26: 'Hunting', 27: 'Lacrosse', 28: 'Martial Arts', 29: 'Mind and Body', 30: 'Mixed Metabolic Cardio Training',
  31: 'Paddle Sports', 32: 'Play', 33: 'Preparation and Recovery', 34: 'Racquetball', 35: 'Rowing', 36: 'Rugby',
  37: 'Running', 38: 'Sailing', 39: 'Skating Sports', 40: 'Snow Sports', 41: 'Soccer', 42: 'Softball', 43: 'Squash',
  44: 'Stair Climbing', 45: 'Surfing Sports', 46: 'Swimming', 47: 'Table Tennis', 48: 'Tennis', 49: 'Track and Field',
  50: 'Traditional Strength Training', 51: 'Volleyball', 52: 'Walking', 53: 'Water Fitness', 54: 'Water Polo',
  55: 'Water Sports', 56: 'Wrestling', 57: 'Yoga', 58: 'Barre', 59: 'Core Training', 60: 'Cross Country Skiing',
  61: 'Downhill Skiing', 62: 'Flexibility', 63: 'High Intensity Interval Training', 64: 'Jump Rope', 65: 'Kickboxing',
  66: 'Pilates', 67: 'Snowboarding', 68: 'Stairs', 69: 'Step Training', 70: 'Wheelchair Walk Pace',
  71: 'Wheelchair Run Pace', 72: 'Tai Chi', 73: 'Mixed Cardio', 74: 'Hand Cycling', 75: 'Disc Sports',
  76: 'Fitness Gaming', 77: 'Cardio Dance', 78: 'Social Dance', 79: 'Pickleball', 80: 'Cooldown', 82: 'Swim Bike Run',
  83: 'Transition', 84: 'Underwater Diving',
};
export const activityName = (type: number) => ACTIVITY_NAMES[type] ?? 'Other';

// Canonical units: seconds, meters, kcal. An unknown unit is treated as missing rather than guessed.
const SECONDS: Record<string, number> = { s: 1, ms: 0.001, min: 60, hr: 3600 };
const METERS: Record<string, number> = { m: 1, km: 1000, mi: 1609.344, ft: 0.3048, yd: 0.9144 };
const KCAL: Record<string, number> = { kcal: 1, Cal: 1, cal: 0.001, kJ: 1 / 4.184, J: 1 / 4184 };
function convert(q: Quantity | null | undefined, table: Record<string, number>): number | null {
  const factor = q ? table[q.unit] : undefined;
  const value = q && factor !== undefined ? q.quantity * factor : NaN;
  return Number.isFinite(value) && value >= 0 ? value : null;
}

// Returns null for a sample that can't be stored (bad dates); the caller skips it instead of failing the page.
export function mapWorkout(w: HealthWorkout, timezone: string): WorkoutChange | null {
  const start = w.startDate.getTime(), end = w.endDate.getTime();
  if (!w.uuid || !Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return {
    health_uuid: w.uuid, activity_type: activityName(w.workoutActivityType),
    started_at: w.startDate.toISOString(), ended_at: w.endDate.toISOString(), timezone,
    duration_s: convert(w.duration, SECONDS) ?? (end - start) / 1000,
    distance_m: convert(w.totalDistance, METERS), energy_kcal: convert(w.totalEnergyBurned, KCAL),
  };
}

// Our own exports are skipped here (not in the anchored query, whose predicate must stay fixed), so a workout this
// app wrote to Health is never imported back as a second copy.
export function workoutPage(
  workouts: readonly HealthWorkout[], deleted: readonly string[], anchor: string, hasMore: boolean, timezone: string,
): ChangePage {
  const rows = workouts.filter((w) => !isOwnExport(w.metadata)).map((w) => mapWorkout(w, timezone))
    .filter((r): r is WorkoutChange => r !== null);
  // The journal only needs ids and times to know what this device imported; details go straight to the server.
  const samples = rows.map((r): StoredSample => ({ id: r.health_uuid, start: r.started_at, end: r.ended_at, value: r.duration_s ?? 0 }));
  return { samples, deleted: [...deleted], anchor, hasMore, workouts: rows };
}

export async function queryWorkoutChanges(state: JournalState, limit: number): Promise<ChangePage> {
  const hk = loadHealthKit();
  if (!hk) throw new Error('Apple Health requires a native iPhone build.');
  const page = await hk.queryWorkoutSamplesWithAnchor({ limit, anchor: state.anchor, filter: { date: { startDate: new Date(state.from) } } });
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return workoutPage(page.workouts as unknown as HealthWorkout[], page.deletedSamples.map((s) => s.uuid), page.newAnchor,
    page.workouts.length + page.deletedSamples.length >= limit, timezone);
}
