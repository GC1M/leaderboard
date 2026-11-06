import type { SampleForSaving } from '@kingstinct/react-native-healthkit';

import { secureStorage } from '@/lib/secure-storage';
import { supabase } from '@/lib/supabase';

import { localDateKey, startOfLocalDay } from './dates';
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

export function foodPayload(f: FoodFields): FoodPayload {
  if (!Number.isFinite(new Date(f.consumedAt).getTime())) throw new Error('A food entry needs a valid time.');
  const nutrients: FoodPayload['nutrients'] = {};
  for (const [k] of FOOD_NUTRIENTS) {
    const v = f.nutrients[k];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) nutrients[k] = v;
  }
  return { name: f.name.trim(), at: new Date(f.consumedAt).toISOString(), nutrients };
}

export const EXPORT_DAYS = 90; // how far back synced entries are exported

// The export version of a row. updated_at moves on every edit; the count of allowed nutrient types is the low digit, so
// allowing more types later is a higher version and re-saves the entry. (Revoking lowers it: nothing is re-saved.)
export const foodVersion = (updatedAt: string | null | undefined, allowed: number) => {
  const ms = updatedAt ? Date.parse(updatedAt) : NaN;
  return Number.isFinite(ms) ? ms * 16 + allowed : null;
};
export const allowedFoodTypes = () => FOOD_WRITE_TYPES.filter((t) => getHealthWriteAccess(t) === 'granted').length;

// A delete must beat every earlier version of that entry, whatever this device's clock says.
export const foodDeleteVersion = (known: readonly ExportEntry[], id: string, now = Date.now()) => {
  const prev = known.find((e) => e.kind === FOOD_KIND && e.recordId === id);
  return prev ? Math.max(now, prev.version + 1) : null;
};

const COLUMNS = ['id', 'updated_at', 'food_name', 'consumed_at', ...FOOD_NUTRIENTS.map((n) => n[0])].join(',');
export type FoodRow = { id: string; updated_at: string; food_name: string; consumed_at: string } & Record<FoodKey, number | string | null>;

// Synced entries of the last EXPORT_DAYS days: what the server has, so an entry still waiting to sync is never in it.
export async function fetchRecentFoodRows(now = new Date()): Promise<FoodRow[]> {
  const { data, error } = await supabase.from('food_entries').select(COLUMNS).gte('local_date', localDateKey(startOfLocalDay(now, EXPORT_DAYS - 1)));
  if (error) throw new Error("Couldn't load your food to save to Apple Health.");
  return data as unknown as FoodRow[];
}

// The rows not already queued at their version: the whole idempotency of the backfill.
export function pendingFoodSaves(rows: readonly FoodRow[], known: readonly ExportEntry[], allowed: number) {
  return rows.flatMap((r) => {
    const version = foodVersion(r.updated_at, allowed);
    if (version === null || known.some((e) => e.kind === FOOD_KIND && e.recordId === r.id && e.op === 'save' && e.version >= version)) return [];
    const nutrients = Object.fromEntries(FOOD_NUTRIENTS.map(([k]) => [k, r[k] === null ? null : Number(r[k])])) as Record<FoodKey, number | null>;
    return [{ id: r.id, version, payload: foodPayload({ name: r.food_name, consumedAt: r.consumed_at, nutrients }) }];
  });
}

// Which nutrient types each entry was written with (this device only). A type allowed then and revoked now means the
// old sample cannot be replaced or removed from here, so the write fails as a permission problem instead of duplicating it.
const WRITTEN_KEY = 'food-export-written';
const readWritten = async (): Promise<Record<string, string[]>> => {
  try { return JSON.parse((await secureStorage.getItem(WRITTEN_KEY)) ?? '{}'); } catch { return {}; }
};
const setWritten = async (id: string, types: string[] | null) => {
  const all = await readWritten();
  if (types) all[id] = types; else delete all[id];
  try { await secureStorage.setItem(WRITTEN_KEY, JSON.stringify(all)); } catch { /* the check is skipped next time */ }
};

const need = () => {
  const hk = loadHealthKit();
  if (!hk) throw new Error('Apple Health requires a native iPhone build.');
  return hk;
};
const granted = (type: HealthWriteType) => getHealthWriteAccess(type) === 'granted';

// Deletes this entry's correlation and members. HealthKit only lets an app delete its own samples.
// ponytail: the correlation type itself cannot be authorized, so its delete is best effort; the members are what Health shows.
async function removeFood(e: ExportEntry) {
  if (((await readWritten())[e.recordId] ?? []).some((t) => !granted(t as HealthWriteType))) {
    throw Object.assign(new Error('Allow saving every nutrient this food was saved with, or remove it in the Health app.'), { reason: 'permission' });
  }
  await removeExportedSample(CORRELATION, e.kind, e.recordId).catch(() => {});
  for (const type of FOOD_WRITE_TYPES) if (granted(type)) await removeExportedSample(type, e.kind, e.recordId);
}

export const foodWriter: ExportWriter = {
  writeType: FOOD_NUTRIENTS[0][1],
  writeTypes: FOOD_WRITE_TYPES,
  attemptVersions: true,
  async save(e: ExportEntry) {
    const p = e.payload as FoodPayload;
    const at = new Date(p.at);
    // Only the nutrients the user allowed. Members carry only the record key: the correlation holds the sync identifier.
    const members: SampleForSaving[] = FOOD_NUTRIENTS.flatMap(([k, quantityType, unit]) => {
      const quantity = p.nutrients[k];
      return quantity !== undefined && granted(quantityType) ? [{ quantityType, quantity, unit, startDate: at, endDate: at, metadata: { [APP_RECORD_KEY]: `${e.kind}:${e.recordId}` } }] : [];
    });
    // A retry or an edit first removes what an earlier save wrote, so correlation members are never doubled.
    await removeFood(e);
    await setWritten(e.recordId, []);
    if (members.length === 0) return null;
    // The sync version is the queue's attempt version, above every earlier attempt: HealthKit ignores a save that is not.
    const sample = await need().saveCorrelationSample(CORRELATION, members, at, at, { ...exportMetadata(e.kind, e.recordId, e.attemptVersion ?? e.version), [FOOD_NAME_KEY]: p.name });
    await setWritten(e.recordId, members.map((m) => ('quantityType' in m ? m.quantityType : '')));
    return sample?.uuid ?? null;
  },
  async remove(e: ExportEntry) {
    await removeFood(e);
    await setWritten(e.recordId, null);
  },
};

// Registered at import so a queued entry retries after restart without opening the screen that made it.
registerExportWriter(FOOD_KIND, foodWriter);
