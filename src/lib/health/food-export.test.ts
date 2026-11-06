import { isOwnExport } from './export-metadata';
import { createExportQueue, exportWriters, type ExportEntry } from './export-queue';
import { canExportFood, FOOD_KIND, FOOD_NUTRIENTS, foodPayload } from './food-export';
import { getHealthWriteAccess, resetHealthKitCache } from './healthkit';

// In-memory stand-in for HealthKit: correlations and member quantity samples live in one list, deletes match the
// record-key metadata filter, and write access is per type.
type Sample = { type: string; quantity?: number; unit?: string; metadata: Record<string, unknown> };
type Member = { quantityType: string; quantity: number; unit: string; metadata: Record<string, unknown> };
let store: Sample[] = [];
let denied = new Set<string>();
const hk = {
  isHealthDataAvailable: jest.fn(() => true),
  authorizationStatusFor: jest.fn((t: string) => (denied.has(t) ? 1 : 2)),
  saveCorrelationSample: jest.fn(async (type: string, members: Member[], _s: Date, _e: Date, metadata: Record<string, unknown>) => {
    store.push({ type, metadata });
    for (const m of members) store.push({ type: m.quantityType, quantity: m.quantity, unit: m.unit, metadata: m.metadata });
    return { uuid: `c-${store.length}` };
  }),
  deleteObjects: jest.fn(async (type: string, filter: { metadata: { value: string } }) => {
    const before = store.length;
    store = store.filter((s) => !(s.type === type && s.metadata.LeaderboardRecordId === filter.metadata.value));
    return before - store.length;
  }),
};
beforeAll(() => jest.doMock('@kingstinct/react-native-healthkit', () => hk));
afterAll(() => jest.dontMock('@kingstinct/react-native-healthkit'));
beforeEach(() => { jest.clearAllMocks(); resetHealthKitCache(); store = []; denied = new Set(); });

const ALL = { energy_kcal: 250, protein_g: 12.5, carbs_g: 30, fat_g: 8, fiber_g: 3, sugars_g: 0, sat_fat_g: 2, sodium_mg: 410 };
const NONE = { energy_kcal: null, protein_g: null, carbs_g: null, fat_g: null, fiber_g: null, sugars_g: null, sat_fat_g: null, sodium_mg: null };
const row = { name: ' Oatmeal ', consumedAt: '2026-11-06T13:00:00.000Z', nutrients: ALL };
const members = () => store.filter((s) => s.type !== 'HKCorrelationTypeIdentifierFood');
const correlations = () => store.filter((s) => s.type === 'HKCorrelationTypeIdentifierFood');

function setup() {
  const rows = new Map<string, ExportEntry>();
  const server = new Map<string, number>();
  const queue = createExportQueue({
    checkAccount: async () => {},
    store: {
      list: async () => [...rows.values()],
      put: async (e) => { rows.set(`${e.kind}:${e.recordId}`, { ...e }); },
      remove: async (k, id) => { rows.delete(`${k}:${id}`); },
      clear: async () => rows.clear(),
    },
    mapping: {
      get: async (k, id) => (server.has(`${k}:${id}`) ? { syncVersion: server.get(`${k}:${id}`)! } : null),
      record: async (k, id, _u, v) => { server.set(`${k}:${id}`, v); },
      remove: async (k, id) => { server.delete(`${k}:${id}`); },
    },
    writers: exportWriters,
    access: getHealthWriteAccess,
  });
  return { queue, rows, server };
}

describe('payload', () => {
  it('keeps known nutrients, including a recorded zero, and drops unknown or invalid ones', () => {
    const p = foodPayload({ ...row, nutrients: { ...ALL, protein_g: null, fiber_g: undefined, fat_g: NaN, sodium_mg: -1 } });
    expect(p.nutrients).toEqual({ energy_kcal: 250, carbs_g: 30, sugars_g: 0, sat_fat_g: 2 });
    expect(p.name).toBe('Oatmeal');
  });
  it('rejects an invalid time', () => {
    expect(() => foodPayload({ ...row, consumedAt: 'nope' })).toThrow();
  });
  it('only synced entries are exportable, so pending or unsynced ones are never queued', () => {
    expect(canExportFood({ id: 'e1', pending: null })).toBe(true);
    expect(canExportFood({ id: 'e1', pending: 'edit' })).toBe(false);
    expect(canExportFood({ id: null, pending: 'log' })).toBe(false);
  });
});

describe('writer through the queue', () => {
  it('writes one correlation with a food name and one member per known nutrient, in HealthKit units', async () => {
    const { queue } = setup();
    await queue.initialize();
    await queue.enqueue(FOOD_KIND, 'e1', 'save', foodPayload(row), 1);
    expect(correlations()).toHaveLength(1);
    expect(hk.saveCorrelationSample.mock.calls[0][4]).toMatchObject({ HKFoodType: 'Oatmeal', HKMetadataKeySyncIdentifier: 'leaderboard:food:e1', HKMetadataKeySyncVersion: 1, LeaderboardRecordId: 'food:e1' });
    const units = Object.fromEntries(members().map((m) => [m.type, [m.quantity, m.unit]]));
    expect(units).toEqual({
      HKQuantityTypeIdentifierDietaryEnergyConsumed: [250, 'kcal'],
      HKQuantityTypeIdentifierDietaryProtein: [12.5, 'g'],
      HKQuantityTypeIdentifierDietaryCarbohydrates: [30, 'g'],
      HKQuantityTypeIdentifierDietaryFatTotal: [8, 'g'],
      HKQuantityTypeIdentifierDietaryFiber: [3, 'g'],
      HKQuantityTypeIdentifierDietarySugar: [0, 'g'],
      HKQuantityTypeIdentifierDietaryFatSaturated: [2, 'g'],
      HKQuantityTypeIdentifierDietarySodium: [410, 'mg'],
    });
    expect(members().every((m) => isOwnExport(m.metadata))).toBe(true);
    expect(FOOD_NUTRIENTS).toHaveLength(8);
  });

  it('does not write unknown nutrients, not even as zero', async () => {
    const { queue } = setup();
    await queue.initialize();
    await queue.enqueue(FOOD_KIND, 'e1', 'save', foodPayload({ ...row, nutrients: { ...ALL, fiber_g: null, sodium_mg: null, energy_kcal: null } }), 1);
    const types = members().map((m) => m.type);
    expect(types).toHaveLength(5);
    expect(types).not.toContain('HKQuantityTypeIdentifierDietaryFiber');
    expect(types).not.toContain('HKQuantityTypeIdentifierDietarySodium');
    expect(types).not.toContain('HKQuantityTypeIdentifierDietaryEnergyConsumed');
  });

  it('writes nothing when every nutrient is unknown', async () => {
    const { queue, rows } = setup();
    await queue.initialize();
    await queue.enqueue(FOOD_KIND, 'e1', 'save', foodPayload({ ...row, nutrients: NONE }), 1);
    expect(store).toHaveLength(0);
    expect(rows.get('food:e1')).toMatchObject({ status: 'success', sampleUuid: null });
  });

  it('a retry of the same save does not double the members', async () => {
    const { queue } = setup();
    await queue.initialize();
    await queue.enqueue(FOOD_KIND, 'e1', 'save', foodPayload(row), 1);
    // A save that reached Health but whose mapping write was lost is written again at the same version.
    await exportWriters[FOOD_KIND]!.save({ kind: FOOD_KIND, recordId: 'e1', op: 'save', payload: foodPayload(row), version: 1, status: 'pending', attempts: 0 });
    expect(correlations()).toHaveLength(1);
    expect(members()).toHaveLength(8);
  });

  it('an amount edit replaces the old samples with the new values', async () => {
    const { queue, server } = setup();
    await queue.initialize();
    await queue.enqueue(FOOD_KIND, 'e1', 'save', foodPayload(row), 1);
    await queue.enqueue(FOOD_KIND, 'e1', 'save', foodPayload({ ...row, nutrients: { ...ALL, energy_kcal: 500, sodium_mg: null } }), 2);
    expect(correlations()).toHaveLength(1);
    expect(members()).toHaveLength(7);
    expect(members().find((m) => m.type.endsWith('EnergyConsumed'))?.quantity).toBe(500);
    expect(server.get('food:e1')).toBe(2);
  });

  it('a diary delete removes only that entry\'s correlation and members and clears the mapping', async () => {
    const { queue, server, rows } = setup();
    await queue.initialize();
    await queue.enqueue(FOOD_KIND, 'e1', 'save', foodPayload(row), 1);
    await queue.enqueue(FOOD_KIND, 'e2', 'save', foodPayload(row), 1);
    await queue.enqueue(FOOD_KIND, 'e1', 'delete', null, 2);
    expect(correlations()).toHaveLength(1);
    expect(members()).toHaveLength(8);
    expect(server.has('food:e1')).toBe(false);
    expect(rows.has('food:e1')).toBe(false);
  });

  it('with some types denied, only the allowed nutrients are written and the entry still exports', async () => {
    denied = new Set(['HKQuantityTypeIdentifierDietaryProtein', 'HKQuantityTypeIdentifierDietarySodium']);
    const { queue, rows } = setup();
    await queue.initialize();
    await queue.enqueue(FOOD_KIND, 'e1', 'save', foodPayload(row), 1);
    expect(members()).toHaveLength(6);
    expect(members().map((m) => m.type)).not.toContain('HKQuantityTypeIdentifierDietaryProtein');
    expect(rows.get('food:e1')?.status).toBe('success');
  });

  it('with every type denied nothing is written and the entry stays queued; a grant exports it', async () => {
    denied = new Set(FOOD_NUTRIENTS.map((n) => n[1]));
    const { queue, rows } = setup();
    await queue.initialize();
    await queue.enqueue(FOOD_KIND, 'e1', 'save', foodPayload(row), 1);
    expect(hk.saveCorrelationSample).not.toHaveBeenCalled();
    expect(rows.get('food:e1')).toMatchObject({ status: 'failed', reason: 'permission' });
    denied = new Set();
    await queue.process();
    expect(members()).toHaveLength(8);
  });
});
