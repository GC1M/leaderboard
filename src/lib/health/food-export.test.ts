import { isOwnExport } from './export-metadata';
import { createExportQueue, exportWriters, type ExportEntry } from './export-queue';
import { EXPORT_DAYS, fetchRecentFoodRows, FOOD_KIND, FOOD_NUTRIENTS, foodDeleteVersion, foodPayload, foodVersion, pendingFoodSaves, type FoodRow } from './food-export';
import { getHealthWriteAccess, resetHealthKitCache } from './healthkit';

const mockSelect = jest.fn();
jest.mock('@/lib/supabase', () => ({ supabase: { from: () => ({ select: (...a: unknown[]) => ({ gte: (...g: unknown[]) => mockSelect(...a, ...g) }) }) } }));
const mockStorage = new Map<string, string>();
jest.mock('@/lib/secure-storage', () => ({
  secureStorage: {
    getItem: async (k: string) => mockStorage.get(k) ?? null,
    setItem: async (k: string, v: string) => void mockStorage.set(k, v),
    removeItem: async (k: string) => void mockStorage.delete(k),
  },
}));

// In-memory stand-in for HealthKit. Correlations and member quantity samples share one list. deleteObjects matches the
// record-key metadata filter, and can be made to fail for correlations (best effort in the app). A correlation save whose
// sync identifier already exists is ignored unless its sync version is higher, as HealthKit does. Write access is per type.
type Sample = { type: string; quantity?: number; unit?: string; metadata: Record<string, unknown> };
type Member = { quantityType: string; quantity: number; unit: string; metadata: Record<string, unknown> };
const CORR = 'HKCorrelationTypeIdentifierFood';
let store: Sample[] = [];
let denied = new Set<string>();
let correlationDeleteFails = false;
const hk = {
  isHealthDataAvailable: jest.fn(() => true),
  authorizationStatusFor: jest.fn((t: string) => (denied.has(t) ? 1 : 2)),
  saveCorrelationSample: jest.fn(async (type: string, members: Member[], _s: Date, _e: Date, metadata: Record<string, unknown>) => {
    const old = store.find((s) => s.type === CORR && s.metadata.HKMetadataKeySyncIdentifier === metadata.HKMetadataKeySyncIdentifier);
    if (old && (metadata.HKMetadataKeySyncVersion as number) <= (old.metadata.HKMetadataKeySyncVersion as number)) return undefined;
    if (old) store = store.filter((s) => s !== old);
    store.push({ type, metadata });
    for (const m of members) store.push({ type: m.quantityType, quantity: m.quantity, unit: m.unit, metadata: m.metadata });
    return { uuid: `c-${store.length}` };
  }),
  deleteObjects: jest.fn(async (type: string, filter: { metadata: { value: string } }) => {
    if (type === CORR && correlationDeleteFails) throw new Error('not authorized');
    const before = store.length;
    store = store.filter((s) => !(s.type === type && s.metadata.LeaderboardRecordId === filter.metadata.value));
    return before - store.length;
  }),
};
beforeAll(() => jest.doMock('@kingstinct/react-native-healthkit', () => hk));
afterAll(() => jest.dontMock('@kingstinct/react-native-healthkit'));
beforeEach(() => { jest.clearAllMocks(); resetHealthKitCache(); store = []; denied = new Set(); correlationDeleteFails = false; mockStorage.clear(); });

const ALL = { energy_kcal: 250, protein_g: 12.5, carbs_g: 30, fat_g: 8, fiber_g: 3, sugars_g: 0, sat_fat_g: 2, sodium_mg: 410 };
const NONE = { energy_kcal: null, protein_g: null, carbs_g: null, fat_g: null, fiber_g: null, sugars_g: null, sat_fat_g: null, sodium_mg: null };
const row = { name: ' Oatmeal ', consumedAt: '2026-11-06T13:00:00.000Z', nutrients: ALL };
const members = () => store.filter((s) => s.type !== CORR);
const correlations = () => store.filter((s) => s.type === CORR);
const PROTEIN = 'HKQuantityTypeIdentifierDietaryProtein';

function setup(opts: { failRecordOnce?: boolean } = {}) {
  const rows = new Map<string, ExportEntry>();
  const server = new Map<string, number>();
  let fail = opts.failRecordOnce ?? false;
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
      record: async (k, id, _u, v) => {
        if (fail) { fail = false; throw new Error('offline'); }
        server.set(`${k}:${id}`, v);
      },
      remove: async (k, id) => { server.delete(`${k}:${id}`); },
    },
    writers: exportWriters,
    access: getHealthWriteAccess,
  });
  return { queue, rows, server };
}
const save = (queue: ReturnType<typeof setup>['queue'], id: string, p: ReturnType<typeof foodPayload>, v: number) => queue.enqueue(FOOD_KIND, id, 'save', p, v);

describe('payload', () => {
  it('keeps known nutrients, including a recorded zero, and drops unknown or invalid ones', () => {
    const p = foodPayload({ ...row, nutrients: { ...ALL, protein_g: null, fiber_g: undefined, fat_g: NaN, sodium_mg: -1 } });
    expect(p.nutrients).toEqual({ energy_kcal: 250, carbs_g: 30, sugars_g: 0, sat_fat_g: 2 });
    expect(p.name).toBe('Oatmeal');
  });
  it('rejects an invalid time', () => {
    expect(() => foodPayload({ ...row, consumedAt: 'nope' })).toThrow();
  });
});

describe('what the diary effect queues', () => {
  const server = (o: Partial<FoodRow> = {}): FoodRow => ({ id: 'e1', updated_at: '2026-11-06T13:00:00.000Z', food_name: 'Rice', consumed_at: '2026-11-06T12:00:00.000Z', ...ALL, ...o });

  it('reads only synced rows of the last 90 days, with only the export columns', async () => {
    mockSelect.mockResolvedValue({ data: [server()], error: null });
    const now = new Date(2026, 10, 6, 12);
    await expect(fetchRecentFoodRows(now)).resolves.toHaveLength(1);
    const [columns, col, since] = mockSelect.mock.calls[0];
    expect(col).toBe('local_date');
    expect(since).toBe('2026-08-09');
    expect(EXPORT_DAYS).toBe(90);
    expect(columns).toBe('id,updated_at,food_name,consumed_at,energy_kcal,protein_g,carbs_g,fat_g,fiber_g,sugars_g,sat_fat_g,sodium_mg');
    expect(columns).not.toMatch(/notes|user_id|client_id|food_brand/);
  });

  it('fails when the server cannot be read', async () => {
    mockSelect.mockResolvedValue({ data: null, error: { message: 'x' } });
    await expect(fetchRecentFoodRows()).rejects.toThrow();
  });

  it('queues every row not yet queued at its version, and nothing the second time (idempotent)', () => {
    const rows = [server(), server({ id: 'e2' })];
    const first = pendingFoodSaves(rows, [], 8);
    expect(first.map((s) => s.id)).toEqual(['e1', 'e2']);
    const queued = first.map((s): ExportEntry => ({ kind: FOOD_KIND, recordId: s.id, op: 'save', payload: null, version: s.version, status: 'success', attempts: 0 }));
    expect(pendingFoodSaves(rows, queued, 8)).toEqual([]);
  });

  it('queues a newer row version after an edit, with unknown nutrients absent and strings converted', () => {
    const queued: ExportEntry[] = [{ kind: FOOD_KIND, recordId: 'e1', op: 'save', payload: null, version: foodVersion('2026-11-06T13:00:00.000Z', 8)!, status: 'success', attempts: 0 }];
    const [s] = pendingFoodSaves([server({ updated_at: '2026-11-06T14:00:00.000Z', fiber_g: null, protein_g: '7.5' })], queued, 8);
    expect(s.payload.nutrients.protein_g).toBe(7.5);
    expect(s.payload.nutrients).not.toHaveProperty('fiber_g');
  });

  it('queues a row again, at a higher version, when more nutrient types are allowed', () => {
    const [before] = pendingFoodSaves([server()], [], 3);
    const queued: ExportEntry[] = [{ kind: FOOD_KIND, recordId: 'e1', op: 'save', payload: null, version: before.version, status: 'success', attempts: 0 }];
    const [after] = pendingFoodSaves([server()], queued, 8);
    expect(after.version).toBeGreaterThan(before.version);
    expect(pendingFoodSaves([server()], queued, 2)).toEqual([]);
  });

  it('skips a row with no usable updated_at', () => {
    expect(pendingFoodSaves([server({ updated_at: 'bad' })], [], 8)).toEqual([]);
  });
});

describe('delete version', () => {
  const known = (version: number): ExportEntry[] => [{ kind: FOOD_KIND, recordId: 'e1', op: 'save', payload: null, version, status: 'success', attempts: 0 }];
  it('is above the saved version even when this clock is far behind', () => {
    const saved = foodVersion('2026-11-06T13:00:00.000Z', 8)!;
    expect(foodDeleteVersion(known(saved), 'e1', 1000)).toBe(saved + 1);
  });
  it('uses the clock when it is ahead, and is null for an entry never exported here', () => {
    expect(foodDeleteVersion(known(5), 'e1', 1000)).toBe(1000);
    expect(foodDeleteVersion(known(5), 'other', 1000)).toBeNull();
  });
  it('a skewed-clock delete removes the samples and is not treated as stale by the queue', async () => {
    const { queue, rows, server } = setup();
    await queue.initialize();
    const v = foodVersion('2026-11-06T13:00:00.000Z', 8)!;
    await save(queue, 'e1', foodPayload(row), v);
    await queue.enqueue(FOOD_KIND, 'e1', 'delete', null, foodDeleteVersion([...rows.values()], 'e1', 1000)!);
    expect(store).toHaveLength(0);
    expect(server.has('food:e1')).toBe(false);
  });
});

describe('writer through the queue', () => {
  it('writes one correlation with a food name and one member per known nutrient, in HealthKit units', async () => {
    const { queue } = setup();
    await queue.initialize();
    await save(queue, 'e1', foodPayload(row), 1);
    expect(correlations()).toHaveLength(1);
    expect(hk.saveCorrelationSample.mock.calls[0][4]).toMatchObject({ HKFoodType: 'Oatmeal', HKMetadataKeySyncIdentifier: 'leaderboard:food:e1', LeaderboardRecordId: 'food:e1' });
    const units = Object.fromEntries(members().map((m) => [m.type, [m.quantity, m.unit]]));
    expect(units).toEqual({
      HKQuantityTypeIdentifierDietaryEnergyConsumed: [250, 'kcal'],
      [PROTEIN]: [12.5, 'g'],
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
    await save(queue, 'e1', foodPayload({ ...row, nutrients: { ...ALL, fiber_g: null, sodium_mg: null, energy_kcal: null } }), 1);
    const types = members().map((m) => m.type);
    expect(types).toHaveLength(5);
    expect(types).not.toContain('HKQuantityTypeIdentifierDietaryFiber');
    expect(types).not.toContain('HKQuantityTypeIdentifierDietarySodium');
    expect(types).not.toContain('HKQuantityTypeIdentifierDietaryEnergyConsumed');
  });

  it('writes nothing when every nutrient is unknown', async () => {
    const { queue, rows } = setup();
    await queue.initialize();
    await save(queue, 'e1', foodPayload({ ...row, nutrients: NONE }), 1);
    expect(store).toHaveLength(0);
    expect(rows.get('food:e1')).toMatchObject({ status: 'success', sampleUuid: null });
  });

  it('an amount edit replaces the old samples with the new values', async () => {
    const { queue, server } = setup();
    await queue.initialize();
    await save(queue, 'e1', foodPayload(row), 1);
    await save(queue, 'e1', foodPayload({ ...row, nutrients: { ...ALL, energy_kcal: 500, sodium_mg: null } }), 2);
    expect(correlations()).toHaveLength(1);
    expect(members()).toHaveLength(7);
    expect(members().find((m) => m.type.endsWith('EnergyConsumed'))?.quantity).toBe(500);
    expect(server.get('food:e1')).toBe(2);
  });

  it('a diary delete removes only that entry\'s correlation and members and clears the mapping', async () => {
    const { queue, server, rows } = setup();
    await queue.initialize();
    await save(queue, 'e1', foodPayload(row), 1);
    await save(queue, 'e2', foodPayload(row), 1);
    await queue.enqueue(FOOD_KIND, 'e1', 'delete', null, 2);
    expect(correlations()).toHaveLength(1);
    expect(members()).toHaveLength(8);
    expect(server.has('food:e1')).toBe(false);
    expect(rows.has('food:e1')).toBe(false);
  });

  it('a crash after the Health write retries with a higher sync version and really replaces, even when the correlation delete fails', async () => {
    correlationDeleteFails = true;
    const { queue, rows } = setup({ failRecordOnce: true });
    await queue.initialize();
    await save(queue, 'e1', foodPayload(row), 1);
    expect(rows.get('food:e1')?.status).toBe('failed');
    const first = hk.saveCorrelationSample.mock.calls[0][4].HKMetadataKeySyncVersion as number;
    expect(rows.get('food:e1')?.attemptVersion).toBe(first);
    await queue.process();
    const second = hk.saveCorrelationSample.mock.calls[1][4].HKMetadataKeySyncVersion as number;
    expect(second).toBeGreaterThan(first);
    expect(rows.get('food:e1')?.attemptVersion).toBe(second);
    expect(rows.get('food:e1')?.status).toBe('success');
    expect(correlations()).toHaveLength(1);
    expect(correlations()[0].metadata.HKMetadataKeySyncVersion).toBe(second);
    expect(members()).toHaveLength(8);
  });

  it('an edit never goes below an earlier attempt\'s sync version, even if the queue version is lower', async () => {
    correlationDeleteFails = true;
    const { queue, rows } = setup();
    await queue.initialize();
    await save(queue, 'e1', foodPayload(row), 5_000_000_000_000_000);
    const high = rows.get('food:e1')!.attemptVersion!;
    await save(queue, 'e1', foodPayload({ ...row, nutrients: { ...ALL, energy_kcal: 99 } }), 5_000_000_000_000_001);
    expect(rows.get('food:e1')!.attemptVersion!).toBeGreaterThan(high);
    expect(members().find((m) => m.type.endsWith('EnergyConsumed'))?.quantity).toBe(99);
    expect(correlations()).toHaveLength(1);
  });
});

describe('permissions', () => {
  it('with some types denied, only the allowed nutrients are written and the entry still exports', async () => {
    denied = new Set([PROTEIN, 'HKQuantityTypeIdentifierDietarySodium']);
    const { queue, rows } = setup();
    await queue.initialize();
    await save(queue, 'e1', foodPayload(row), 1);
    expect(members()).toHaveLength(6);
    expect(members().map((m) => m.type)).not.toContain(PROTEIN);
    expect(rows.get('food:e1')?.status).toBe('success');
  });

  it('with every type denied nothing is written and the entry stays queued; a grant exports it', async () => {
    denied = new Set(FOOD_NUTRIENTS.map((n) => n[1]));
    const { queue, rows } = setup();
    await queue.initialize();
    await save(queue, 'e1', foodPayload(row), 1);
    expect(hk.saveCorrelationSample).not.toHaveBeenCalled();
    expect(rows.get('food:e1')).toMatchObject({ status: 'failed', reason: 'permission' });
    denied = new Set();
    await queue.process();
    expect(members()).toHaveLength(8);
  });

  it('a type revoked after export fails an edit as a permission problem and leaves one untouched copy', async () => {
    const { queue, rows } = setup();
    await queue.initialize();
    await save(queue, 'e1', foodPayload(row), 1);
    denied = new Set([PROTEIN]);
    await save(queue, 'e1', foodPayload({ ...row, nutrients: { ...ALL, energy_kcal: 999 } }), 2);
    expect(rows.get('food:e1')).toMatchObject({ status: 'failed', reason: 'permission' });
    expect(correlations()).toHaveLength(1);
    expect(members()).toHaveLength(8);
    expect(members().find((m) => m.type.endsWith('EnergyConsumed'))?.quantity).toBe(250);
    denied = new Set();
    await queue.process();
    expect(rows.get('food:e1')?.status).toBe('success');
    expect(members().find((m) => m.type.endsWith('EnergyConsumed'))?.quantity).toBe(999);
    expect(members()).toHaveLength(8);
  });

  it('a type revoked after export fails a delete as a permission problem instead of leaving a half-removed entry', async () => {
    const { queue, rows, server } = setup();
    await queue.initialize();
    await save(queue, 'e1', foodPayload(row), 1);
    denied = new Set([PROTEIN]);
    await queue.enqueue(FOOD_KIND, 'e1', 'delete', null, 2);
    expect(rows.get('food:e1')).toMatchObject({ op: 'delete', status: 'failed', reason: 'permission' });
    expect(members()).toHaveLength(8);
    expect(server.has('food:e1')).toBe(true);
    denied = new Set();
    await queue.process();
    expect(store).toHaveLength(0);
  });

  it('allowing a type later re-saves the entry with that nutrient, replacing the old copy', async () => {
    denied = new Set([PROTEIN]);
    const { queue } = setup();
    await queue.initialize();
    const rowVersion = '2026-11-06T13:00:00.000Z';
    const v1 = foodVersion(rowVersion, 7)!;
    await save(queue, 'e1', foodPayload(row), v1);
    expect(members()).toHaveLength(7);
    denied = new Set();
    const v2 = foodVersion(rowVersion, 8)!;
    expect(v2).toBeGreaterThan(v1);
    await save(queue, 'e1', foodPayload(row), v2);
    expect(members()).toHaveLength(8);
    expect(correlations()).toHaveLength(1);
  });
});
