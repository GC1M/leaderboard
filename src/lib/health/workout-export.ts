import { exportMetadata } from './export-metadata';
import { registerExportWriter, type ExportEntry, type ExportWriter } from './export-queue';
import { loadHealthKit, removeExportedSample } from './healthkit';

// App-created workouts the user chose to also save to Apple Health. recordId is the `workouts.id`, so the sample is
// tagged `LeaderboardRecordId = workout:<id>`; the Health workout importer skips samples with that key.
// Imported (healthkit-source) workouts are never exportable (canExportWorkout).
export const WORKOUT_KIND = 'workout';
export const WORKOUT_WRITE_TYPE = 'HKWorkoutTypeIdentifier' as const; // the only type written: no associated samples, route or heart rate

// Only what Health can show for a summary workout. Exercises, sets, reps, load and notes stay in the app.
export type WorkoutPayload = { activity: string; start: string; end: string; distanceM?: number; energyKcal?: number };
type WorkoutFields = { activityType: string; startedAt: Date; endedAt: Date; distanceM?: number | null; energyKcal?: number | null };

export const canExportWorkout = (source: string) => source === 'manual';

// A value the user never entered stays absent; HealthKit cannot hold a zero total, so zero is absent too.
const positive = (n: number | null | undefined) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : undefined);

export function workoutPayload(w: WorkoutFields): WorkoutPayload {
  const start = w.startedAt.getTime(), end = w.endedAt.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) throw new Error('A workout needs a valid start and end.');
  const distanceM = positive(w.distanceM), energyKcal = positive(w.energyKcal);
  return {
    activity: w.activityType.trim(), start: w.startedAt.toISOString(), end: w.endedAt.toISOString(),
    ...(distanceM !== undefined && { distanceM }), ...(energyKcal !== undefined && { energyKcal }),
  };
}

// HKWorkoutActivityType raw values and the names the importer shows (same table as the import mapping), so an
// activity typed as "Running" exports as running. Anything not recognised is exported as Other (3000).
const OTHER = 3000;
const NAMES: Record<number, string> = {
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
const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
// Free-text activity names people commonly type for the manual logger. Each maps to one unambiguous type.
const ALIASES: Record<string, number> = {
  strength: 50, strengthtraining: 50, weights: 50, weighttraining: 50, weightlifting: 50, lifting: 50,
  run: 37, jog: 37, jogging: 37, walk: 52, bike: 13, biking: 13, swim: 46, hiit: 63,
};
const CODES = new Map<string, number>([...Object.entries(NAMES).map(([code, name]): [string, number] => [key(name), Number(code)]), ...Object.entries(ALIASES)]);

export const activityCode = (text: string): number => CODES.get(key(text)) ?? OTHER;

const need = () => {
  const hk = loadHealthKit();
  if (!hk) throw new Error('Apple Health requires a native iPhone build.');
  return hk;
};

export const workoutWriter: ExportWriter = {
  writeType: WORKOUT_WRITE_TYPE,
  async save(e: ExportEntry) {
    const p = e.payload as WorkoutPayload;
    const totals = p.distanceM || p.energyKcal ? { distance: p.distanceM, energyBurned: p.energyKcal } : undefined;
    type Activity = Parameters<ReturnType<typeof need>['saveWorkoutSample']>[0];
    // No associated quantity samples: nothing here can invent heart rate, energy or a route.
    const sample = await need().saveWorkoutSample(activityCode(p.activity) as Activity, [], new Date(p.start), new Date(p.end), totals, exportMetadata(e.kind, e.recordId, e.version) as never);
    return sample?.uuid ?? null;
  },
  remove: (e) => removeExportedSample(WORKOUT_WRITE_TYPE, e.kind, e.recordId),
};

// Registered at import so a queued entry retries after restart without opening the screen that made it.
registerExportWriter(WORKOUT_KIND, workoutWriter);
