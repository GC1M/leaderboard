import { syncIdentifier } from './export-metadata';
import { exportWriters, registerExportWriter, type ExportEntry, type ExportWriter } from './export-queue';
import { FOOD_KIND, FOOD_NUTRIENTS, allowedFoodMask, payloadMask, type FoodPayload } from './food-export';
import { deleteHealthConnectRecord, exerciseType, insertHealthConnectRecord, WRITE_TYPES, type HealthConnectWriteType, type WriteRecord } from './health-connect';
import { MANUAL_KINDS, type SleepPayload, type WeightPayload } from './manual-export';
import { activityCode, WORKOUT_KIND, type WorkoutPayload } from './workout-export';

// Android writers for the export queue (#61), registered over the HealthKit ones. Every record carries
// clientRecordId = the shared export id (leaderboard:<kind>:<recordId>) and clientRecordVersion = the queue version, so a
// retry never duplicates, an edit replaces, and a delete touches only our own record. Imports skip our package, so
// nothing written here comes back.
const id = (e: ExportEntry) => syncIdentifier(e.kind, e.recordId);
const writer = (type: HealthConnectWriteType, record: (e: ExportEntry) => WriteRecord, extra: Partial<ExportWriter> = {}): ExportWriter => ({
  writeType: type,
  save: (e) => insertHealthConnectRecord(type, record(e), id(e), e.version),
  remove: (e) => deleteHealthConnectRecord(type, id(e)),
  ...extra,
});
// Interval records need an end after the start; a food entry is an instant, so it spans one second.
const plusSecond = (at: string) => new Date(Date.parse(at) + 1000).toISOString();
const MASS: Record<string, 'grams' | 'milligrams'> = { g: 'grams', mg: 'milligrams' };
// Our nutrient columns to NutritionRecord fields, in FOOD_NUTRIENTS order.
const NUTRITION_FIELDS = ['energy', 'protein', 'totalCarbohydrate', 'totalFat', 'dietaryFiber', 'sugar', 'saturatedFat', 'sodium'] as const;

function nutrition(e: ExportEntry): WriteRecord {
  const p = e.payload as FoodPayload;
  const fields = Object.fromEntries(FOOD_NUTRIENTS.flatMap(([key, , unit], i) => {
    const value = p.nutrients[key];
    if (value === undefined) return []; // unknown stays absent, never 0
    return [[NUTRITION_FIELDS[i], unit === 'kcal' ? { value, unit: 'kilocalories' } : { value, unit: MASS[unit] }]];
  }));
  return { recordType: 'Nutrition', startTime: p.at, endTime: plusSecond(p.at), name: p.name, mealType: 0, ...fields };
}

export function registerHealthConnectWriters() {
  registerExportWriter(MANUAL_KINDS.weight, writer(WRITE_TYPES.weight, (e) => {
    const p = e.payload as WeightPayload;
    return { recordType: 'Weight', time: p.at, weight: { value: p.kg, unit: 'kilograms' } };
  }));
  registerExportWriter(MANUAL_KINDS.sleep, writer(WRITE_TYPES.sleep, (e) => {
    const p = e.payload as SleepPayload;
    return { recordType: 'SleepSession', startTime: p.start, endTime: p.end }; // no stages: the whole session is sleep
  }));
  // Distance and energy are separate record types behind separate permissions; only the session is written.
  registerExportWriter(WORKOUT_KIND, writer(WRITE_TYPES.workouts, (e) => {
    const p = e.payload as WorkoutPayload;
    return { recordType: 'ExerciseSession', startTime: p.start, endTime: p.end, exerciseType: exerciseType(activityCode(p.activity)), title: p.activity };
  }));
  // One nutrition permission covers every nutrient. attemptVersions makes each attempt's version higher than the last,
  // which the food backfill relies on when the allowed nutrients change at the same updated_at.
  const food = writer(WRITE_TYPES.nutrition, nutrition, { writeTypes: [WRITE_TYPES.nutrition], attemptVersions: true, dropRevokedDeletes: true, intent: () => allowedFoodMask() });
  registerExportWriter(FOOD_KIND, { ...food, async save(e) {
    // Nothing known to save: remove an earlier copy instead of writing an empty record.
    if (!payloadMask(e.payload as FoodPayload)) { await food.remove(e); return null; }
    return insertHealthConnectRecord(WRITE_TYPES.nutrition, nutrition(e), id(e), e.attemptVersion ?? e.version);
  } });
  // Steps are not written to Health Connect (see WRITE_TYPES). Without a writer a queued steps entry fails visibly
  // instead of reaching HealthKit code; the steps switch is not offered on Android.
  exportWriters[MANUAL_KINDS.steps] = undefined;
}
