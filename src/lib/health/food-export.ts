import { APP_RECORD_KEY, exportMetadata } from './export-metadata';
import { registerExportWriter, type ExportEntry, type ExportWriter } from './export-queue';
import { getHealthWriteAccess, type HealthWriteType, loadHealthKit, removeExportedSample } from './healthkit';

// Food entries logged in this app that the user chose to also save to Apple Health (#48). recordId is the
// `food_entries.id`, which never changes when an amount is edited, so the mapping stays stable. Each entry is one
// food correlation holding one quantity sample per KNOWN nutrient. Ingredients, recipes and photos stay in the app.
export const FOOD_KIND = 'food';
const CORRELATION = 'HKCorrelationTypeIdentifierFood' as const;
const FOOD_NAME_KEY = 'HKFoodType'; // raw key of HKMetadataKeyFoodType

// Stored units are kcal, g and mg (see the food_entries migration), the same units HealthKit gets, so no conversion
// is needed: sodium is mass, saved in mg exactly as stored (never g), and energy is kcal (never kJ).
export const FOOD_NUTRIENTS = [
  ['energy_kcal', 'HKQuantityTypeIdentifierDietaryEnergyConsumed', 'kcal'],
  ['protein_g', 'HKQuantityTypeIdentifierDietaryProtein', 'g'],
  ['carbs_g', 'HKQuantityTypeIdentifierDietaryCarbohydrates', 'g'],
  ['fat_g', 'HKQuantityTypeIdentifierDietaryFatTotal', 'g'],
  ['fiber_g', 'HKQuantityTypeIdentifierDietaryFiber', 'g'],
  ['sugars_g', 'HKQuantityTypeIdentifierDietarySugar', 'g'],
  ['sat_fat_g', 'HKQuantityTypeIdentifierDietaryFatSaturated', 'g'],
  ['sodium_mg', 'HKQuantityTypeIdentifierDietarySodium', 'mg'],
] as const;
export const FOOD_WRITE_TYPES: readonly HealthWriteType[] = FOOD_NUTRIENTS.map((n) => n[1]);
type FoodKey = (typeof FOOD_NUTRIENTS)[number][0];

// Only nutrients that are known. A missing or invalid value is absent, never 0; a recorded 0 is kept.
export type FoodPayload = { name: string; at: string; nutrients: Partial<Record<FoodKey, number>> };
type FoodFields = { name: string; consumedAt: string; nutrients: Record<FoodKey, number | null | undefined> };

// Synced entries only: one still waiting to reach the server (new, or with an edit queued) is not exported yet.
export const canExportFood = (e: { id: string | null; pending: unknown }) => e.id !== null && !e.pending;

export function foodPayload(f: FoodFields): FoodPayload {
  if (!Number.isFinite(new Date(f.consumedAt).getTime())) throw new Error('A food entry needs a valid time.');
  const nutrients: FoodPayload['nutrients'] = {};
  for (const [k] of FOOD_NUTRIENTS) {
    const v = f.nutrients[k];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) nutrients[k] = v;
  }
  return { name: f.name.trim(), at: new Date(f.consumedAt).toISOString(), nutrients };
}

const need = () => {
  const hk = loadHealthKit();
  if (!hk) throw new Error('Apple Health requires a native iPhone build.');
  return hk;
};
const granted = (type: HealthWriteType) => getHealthWriteAccess(type) === 'granted';

// Deletes this entry's correlation and members. HealthKit only lets an app delete its own samples.
// ponytail: the correlation type itself cannot be authorized, so its delete is best effort; the members are what Health shows.
async function removeFood(e: ExportEntry) {
  await removeExportedSample(CORRELATION, e.kind, e.recordId).catch(() => {});
  for (const type of FOOD_WRITE_TYPES) if (granted(type)) await removeExportedSample(type, e.kind, e.recordId);
}

export const foodWriter: ExportWriter = {
  writeType: FOOD_NUTRIENTS[0][1],
  writeTypes: FOOD_WRITE_TYPES,
  async save(e: ExportEntry) {
    const p = e.payload as FoodPayload;
    const at = new Date(p.at);
    // Only the nutrients the user allowed. Members carry only the record key: the correlation holds the sync identifier.
    const members = FOOD_NUTRIENTS.flatMap(([k, quantityType, unit]) => {
      const quantity = p.nutrients[k];
      return quantity !== undefined && granted(quantityType) ? [{ quantityType, quantity, unit, startDate: at, endDate: at, metadata: { [APP_RECORD_KEY]: `${e.kind}:${e.recordId}` } }] : [];
    });
    // A retry or an edit first removes what an earlier save wrote, so correlation members are never doubled.
    await removeFood(e);
    if (members.length === 0) return null;
    const sample = await need().saveCorrelationSample(CORRELATION, members as never, at, at, { ...exportMetadata(e.kind, e.recordId, e.version), [FOOD_NAME_KEY]: p.name } as never);
    return sample?.uuid ?? null;
  },
  remove: removeFood,
};

// Registered at import so a queued entry retries after restart without opening the screen that made it.
registerExportWriter(FOOD_KIND, foodWriter);
