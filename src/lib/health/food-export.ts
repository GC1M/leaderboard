import type { SampleForSaving } from '@kingstinct/react-native-healthkit';

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

// Bit i of a mask is FOOD_NUTRIENTS[i]: one byte says which nutrient types are allowed, or were written.
const bit = (i: number) => 1 << i;
export const allowedFoodMask = () => FOOD_NUTRIENTS.reduce((m, n, i) => (getHealthWriteAccess(n[1]) === 'granted' ? m | bit(i) : m), 0);

// The export version of a row: updated_at in ms times 256 plus the allowed-type mask (about 4.5e14 today, under 2^53).
// updated_at moves on every edit, and a larger allowed mask is a higher version, so the entry is saved again. A smaller
// or swapped mask at the same updated_at is not higher, so pendingFoodSaves compares against what was written instead.
export const foodVersion = (updatedAt: string | null | undefined, allowedMask: number) => {
  const ms = updatedAt ? Date.parse(updatedAt) : NaN;
  return Number.isFinite(ms) ? ms * 256 + allowedMask : null;
};
const versionMs = (version: number) => Math.floor(version / 256);

// A delete must beat every earlier version of that entry, whatever this device's clock says.
export const foodDeleteVersion = (known: readonly ExportEntry[], id: string, now = Date.now()) => {
  const prev = known.find((e) => e.kind === FOOD_KIND && e.recordId === id);
  return prev ? Math.max(now, prev.version + 1) : null;
};

// What the user chooses for food this app saved to Apple Health when its link to Health ends (turning the export off,
// deleting food history or the account). Entries are read now, not from a render. "Remove": a delete is queued for every
// food save, which also drops its unsaved nutrients, and the queue removes the samples from Health. "Keep": every food
// save is forgotten without any write, so a later sync or re-enabling the switch cannot find the deleted server rows
// and remove them. Deletes already queued are left to finish.
export type FoodExportControls = {
  getEntries(): ExportEntry[];
  enqueue(kind: string, recordId: string, op: 'save' | 'delete', payload: unknown, version?: number): Promise<unknown>;
  forget(kind: string, match?: (e: ExportEntry) => boolean): Promise<unknown>;
};
export const exportedFood = (entries: readonly ExportEntry[]) => entries.filter((e) => e.kind === FOOD_KIND && e.op === 'save' && (e.status === 'success' || !!e.writtenTypes));

// Bumped when food is being settled or deleted. A diary sync that read the rows before such a change must not queue
// anything from them, so it compares the number it saw at the start with the current one.
let syncGeneration = 0;
export const foodSyncGeneration = () => syncGeneration;
export const bumpFoodSyncGeneration = () => { syncGeneration++; };

export async function settleFoodExport(exp: FoodExportControls, removeFromHealth: boolean): Promise<void> {
  bumpFoodSyncGeneration();
  try {
    await settle(exp, removeFromHealth);
  } finally {
    bumpFoodSyncGeneration();
  }
}

async function settle(exp: FoodExportControls, removeFromHealth: boolean): Promise<void> {
  if (!removeFromHealth) return void (await exp.forget(FOOD_KIND, (e) => e.op === 'save'));
  for (const e of exp.getEntries().filter((x) => x.kind === FOOD_KIND && x.op === 'save')) {
    await exp.enqueue(FOOD_KIND, e.recordId, 'delete', null, foodDeleteVersion(exp.getEntries(), e.recordId)!);
  }
  // Any delete still queued (pending or failed) did not finish: say so instead of claiming the food is gone from Health.
  if (exp.getEntries().some((e) => e.kind === FOOD_KIND && e.op === 'delete')) throw new Error("Couldn't remove some food from Apple Health. Allow nutrition in Health and try again, or keep it in Health.");
}

const COLUMNS = ['id', 'updated_at', 'food_name', 'consumed_at', ...FOOD_NUTRIENTS.map((n) => n[0])].join(',');
export type FoodRow = { id: string; updated_at: string; food_name: string; consumed_at: string } & Record<FoodKey, number | string | null>;

// Synced entries of the last EXPORT_DAYS days: what the server has, so an entry still waiting to sync is never in it.
export async function fetchRecentFoodRows(now = new Date()): Promise<FoodRow[]> {
  const { data, error } = await supabase.from('food_entries').select(COLUMNS).gte('local_date', localDateKey(startOfLocalDay(now, EXPORT_DAYS - 1)));
  if (error) throw new Error("Couldn't load your food to save to Apple Health.");
  return data as unknown as FoodRow[];
}

// The rows not already queued at their version: the whole idempotency of the backfill.
export function pendingFoodSaves(rows: readonly FoodRow[], known: readonly ExportEntry[], allowedMask: number) {
  return rows.flatMap((r) => {
    let version = foodVersion(r.updated_at, allowedMask);
    if (version === null) return [];
    const nutrients = Object.fromEntries(FOOD_NUTRIENTS.map(([k]) => [k, r[k] === null ? null : Number(r[k])])) as Record<FoodKey, number | null>;
    const payload = foodPayload({ name: r.food_name, consumedAt: r.consumed_at, nutrients });
    const k = known.find((e) => e.kind === FOOD_KIND && e.recordId === r.id && e.op === 'save');
    if (k && k.version >= version) {
      // Already queued at this version. Still save again if a type that can be written now was not written before, which a
      // swapped grant at the same updated_at needs (its version is not higher). That version goes just above the old one.
      if (k.status !== 'success' || !(allowedMask & payloadMask(payload) & ~(k.writtenTypes ?? 0))) return [];
      version = k.version + 1;
    }
    return [{ id: r.id, version, payload }];
  });
}

// Exported entries whose server row is gone: deleted on another device, or the app stopped before its delete was queued.
// Only entries last exported inside the window are checked, so the check stays small. A row that is merely outside the
// fetched window still exists, so the server is asked about the rest by id (ids only) before anything is deleted.
export async function deletedFoodIds(rows: readonly { id: string }[], known: readonly ExportEntry[], now = Date.now()): Promise<string[]> {
  const have = new Set(rows.map((r) => r.id));
  const since = now - EXPORT_DAYS * 86400000;
  const ids = known.filter((e) => e.kind === FOOD_KIND && e.op === 'save' && versionMs(e.version) >= since && !have.has(e.recordId)).map((e) => e.recordId);
  const gone: string[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const { data, error } = await supabase.from('food_entries').select('id').in('id', chunk);
    if (error) throw new Error("Couldn't check your food against Apple Health.");
    const found = new Set(data.map((r) => r.id));
    gone.push(...chunk.filter((id) => !found.has(id)));
  }
  return gone;
}

// Bit mask of the nutrients a payload has a known value for.
const payloadMask = (p: FoodPayload) => FOOD_NUTRIENTS.reduce((m, n, i) => (p.nutrients[n[0]] !== undefined ? m | bit(i) : m), 0);

const need = () => {
  const hk = loadHealthKit();
  if (!hk) throw new Error('Apple Health requires a native iPhone build.');
  return hk;
};
const granted = (type: HealthWriteType) => getHealthWriteAccess(type) === 'granted';

// Throws when a type this entry was, or may have been, saved with is no longer allowed: its old sample could not be replaced.
function assertNotRevoked(e: ExportEntry) {
  if ((e.writtenTypes ?? 0) & ~allowedFoodMask()) {
    throw Object.assign(new Error('Allow saving every nutrient this food was saved with, or remove it in the Health app.'), { reason: 'permission' });
  }
}

// Deletes this entry's correlation and members. HealthKit only lets an app delete its own samples.
// ponytail: the correlation type itself cannot be authorized, so its delete is best effort; the members are what Health shows.
async function removeFood(e: ExportEntry) {
  assertNotRevoked(e);
  await removeExportedSample(CORRELATION, e.kind, e.recordId).catch(() => {});
  for (const type of FOOD_WRITE_TYPES) if (granted(type)) await removeExportedSample(type, e.kind, e.recordId);
}

export const foodWriter: ExportWriter = {
  writeType: FOOD_NUTRIENTS[0][1],
  writeTypes: FOOD_WRITE_TYPES,
  attemptVersions: true,
  dropRevokedDeletes: true,
  // The one snapshot of what this save writes: known nutrients whose type is allowed now. Checked first, so a failed check records nothing.
  intent: (e) => {
    assertNotRevoked(e);
    return payloadMask(e.payload as FoodPayload) & allowedFoodMask();
  },
  async save(e: ExportEntry, intended = payloadMask(e.payload as FoodPayload) & allowedFoodMask()) {
    const p = e.payload as FoodPayload;
    const at = new Date(p.at);
    // Only the nutrients in the intended mask (known, and allowed when it was taken). Members carry only the record key: the correlation holds the sync identifier.
    const members: SampleForSaving[] = FOOD_NUTRIENTS.flatMap(([k, quantityType, unit], i) => {
      const quantity = p.nutrients[k];
      return quantity !== undefined && intended & bit(i) ? [{ quantityType, quantity, unit, startDate: at, endDate: at, metadata: { [APP_RECORD_KEY]: `${e.kind}:${e.recordId}` } }] : [];
    });
    // A retry or an edit first removes what an earlier save wrote, so correlation members are never doubled.
    await removeFood(e);
    if (members.length === 0) return null;
    // The sync version is the queue's attempt version, above every earlier attempt: HealthKit ignores a save that is not.
    const sample = await need().saveCorrelationSample(CORRELATION, members, at, at, { ...exportMetadata(e.kind, e.recordId, e.attemptVersion ?? e.version), [FOOD_NAME_KEY]: p.name });
    return sample?.uuid ?? null;
  },
  remove: removeFood,
};

// Registered at import so a queued entry retries after restart without opening the screen that made it.
registerExportWriter(FOOD_KIND, foodWriter);
