import { createExportQueue, exportWriters, type ExportEntry } from './export-queue';
import { getHealthWriteAccess, resetHealthKitCache } from './healthkit';
import { deletedWaterIds, exportedWater, fetchRecentWaterRows, pendingWaterSaves, removeWaterExport, settleWaterExport, WATER_KIND, WATER_TYPE, waterDeleteVersion, waterSyncGeneration, waterVersion, type WaterRow } from './water-export';

const mockSelect = jest.fn();
const mockIn = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: { from: () => ({ select: (...a: unknown[]) => ({ eq: (...e: unknown[]) => ({ gte: (...g: unknown[]) => mockSelect(...a, ...e, ...g) }), in: (...i: unknown[]) => mockIn(...i) }) }) },
}));

// In-memory HealthKit: a save whose sync identifier exists replaces it only with a higher sync version, as HealthKit does.
type Sample = { type: string; quantity: number; unit: string; metadata: Record<string, unknown> };
let store: Sample[] = [];
let denied = false;
const hk = {
  isHealthDataAvailable: jest.fn(() => true),
  authorizationStatusFor: jest.fn(() => (denied ? 1 : 2)),
  saveQuantitySample: jest.fn(async (type: string, unit: string, quantity: number, _s: Date, _e: Date, metadata: Record<string, unknown>) => {
    const old = store.find((s) => s.metadata.HKMetadataKeySyncIdentifier === metadata.HKMetadataKeySyncIdentifier);
    if (old && (metadata.HKMetadataKeySyncVersion as number) <= (old.metadata.HKMetadataKeySyncVersion as number)) return undefined;
    store = store.filter((s) => s !== old);
    store.push({ type, quantity, unit, metadata });
    return { uuid: `s-${store.length}` };
  }),
  deleteObjects: jest.fn(async (type: string, filter: { metadata: { value: string } }) => {
    store = store.filter((s) => !(s.type === type && s.metadata.LeaderboardRecordId === filter.metadata.value));
  }),
};
beforeAll(() => jest.doMock('@kingstinct/react-native-healthkit', () => hk));
afterAll(() => jest.dontMock('@kingstinct/react-native-healthkit'));
beforeEach(() => { jest.clearAllMocks(); resetHealthKitCache(); store = []; denied = false; });

function setup(opts: { failRecordOnce?: boolean } = {}) {
  const server = new Map<string, number>();
  let fail = opts.failRecordOnce ?? false;
  const queue = createExportQueue({
    checkAccount: async () => {},
    store: { list: async () => [], put: async () => {}, remove: async () => {}, clear: async () => {} },
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
  return { queue, server };
}
const T = '2026-11-06T13:00:00.000Z';
const row = (o: Partial<WaterRow> = {}): WaterRow => ({ id: 'w1', updated_at: T, consumed_at: '2026-11-06T12:00:00.000Z', ml: 250, ...o });
const entry = (recordId: string, version: number, o: Partial<ExportEntry> = {}): ExportEntry => ({ kind: WATER_KIND, recordId, op: 'save', payload: null, version, status: 'success', attempts: 0, ...o });
const queueRows = async (queue: ReturnType<typeof setup>['queue'], rows: WaterRow[]) => {
  for (const s of pendingWaterSaves(rows, queue.getSnapshot().entries)) await queue.enqueue(WATER_KIND, s.id, 'save', s.payload, s.version);
};

describe('what sync queues', () => {
  it('reads only synced manual rows of the last 90 days, with only the export columns', async () => {
    mockSelect.mockResolvedValue({ data: [row()], error: null });
    await expect(fetchRecentWaterRows(new Date(2026, 10, 6, 12))).resolves.toHaveLength(1);
    expect(mockSelect.mock.calls[0]).toEqual(['id,updated_at,consumed_at,ml', 'source', 'manual', 'local_date', '2026-08-09']);
  });
  it('fails when the server cannot be read', async () => {
    mockSelect.mockResolvedValue({ data: null, error: { message: 'x' } });
    await expect(fetchRecentWaterRows()).rejects.toThrow();
  });
  it('queues each row once at its version, and an edit at a higher one', () => {
    const [s] = pendingWaterSaves([row({ ml: '250.5' })], []);
    expect(s).toEqual({ id: 'w1', version: Date.parse(T), payload: { ml: 250.5, at: '2026-11-06T12:00:00.000Z' } });
    expect(pendingWaterSaves([row()], [entry('w1', s.version)])).toEqual([]);
    const [edit] = pendingWaterSaves([row({ updated_at: '2026-11-06T14:00:00.000Z' })], [entry('w1', s.version)]);
    expect(edit.version).toBeGreaterThan(s.version);
  });
  it('never queues an unsynced entry (no id) or one with no usable version', () => {
    expect(pendingWaterSaves([row({ id: '' }), row({ updated_at: '' }), row({ consumed_at: 'nope' })], [])).toEqual([]);
  });
});

describe('writer through the queue', () => {
  it('saves one dietary water sample in mL with the sync identifier and the attempt version', async () => {
    const { queue, server } = setup();
    await queue.initialize();
    await queueRows(queue, [row()]);
    expect(store).toEqual([{ type: WATER_TYPE, quantity: 250, unit: 'mL', metadata: expect.objectContaining({ HKMetadataKeySyncIdentifier: 'leaderboard:water:w1', LeaderboardRecordId: 'water:w1' }) }]);
    const [e] = queue.getSnapshot().entries;
    expect(store[0].metadata.HKMetadataKeySyncVersion).toBe(e.attemptVersion);
    expect(e.attemptVersion).toBeGreaterThanOrEqual(e.version);
    expect(server.get('water:w1')).toBe(Date.parse(T));
    expect(e).toMatchObject({ status: 'success', payload: null });
  });
  it('an edit replaces the sample with the new amount: one sample, not two', async () => {
    const { queue } = setup();
    await queue.initialize();
    await queueRows(queue, [row()]);
    await queueRows(queue, [row({ ml: 500, updated_at: '2026-11-06T14:00:00.000Z' })]);
    expect(store.map((s) => s.quantity)).toEqual([500]);
  });
  it('a retry after the mapping write failed does not duplicate', async () => {
    const { queue, server } = setup({ failRecordOnce: true });
    await queue.initialize();
    await queueRows(queue, [row()]);
    expect(queue.getSnapshot().entries[0].status).toBe('failed');
    await queue.process();
    expect(store).toHaveLength(1);
    expect(server.has('water:w1')).toBe(true);
    expect(queue.getSnapshot().entries[0].status).toBe('success');
  });
  it('a delete removes only our sample for that entry', async () => {
    const { queue, server } = setup();
    await queue.initialize();
    await queueRows(queue, [row(), row({ id: 'w2' })]);
    store.push({ type: WATER_TYPE, quantity: 300, unit: 'mL', metadata: {} }); // another app's water
    await queue.enqueue(WATER_KIND, 'w1', 'delete', null, waterDeleteVersion(queue.getSnapshot().entries, 'w1')!);
    expect(store.map((s) => s.metadata.LeaderboardRecordId)).toEqual(['water:w2', undefined]);
    expect(server.has('water:w1')).toBe(false);
  });
  it('without write permission the entry stays queued as a permission failure, then exports once allowed', async () => {
    denied = true;
    const { queue } = setup();
    await queue.initialize();
    await queueRows(queue, [row()]);
    expect(store).toEqual([]);
    expect(queue.getSnapshot().entries).toEqual([expect.objectContaining({ recordId: 'w1', status: 'failed', reason: 'permission', payload: expect.objectContaining({ ml: 250 }) })]);
    denied = false;
    await queue.process();
    expect(store).toHaveLength(1);
  });
});

describe('entries the server no longer has', () => {
  const v = Date.now();
  it('asks the server by id about recent exports missing from the rows, and reports the ones it lacks', async () => {
    mockIn.mockResolvedValue({ data: [{ id: 'old' }], error: null });
    await expect(deletedWaterIds([{ id: 'w1' }], [entry('w1', v), entry('gone', v), entry('old', v), entry('stale', v - 91 * 86400000), entry('d', v, { op: 'delete' }), { ...entry('x', v), kind: 'food' }])).resolves.toEqual(['gone']);
    expect(mockIn).toHaveBeenCalledWith('id', ['gone', 'old']);
  });
  it('deletes nothing when the server cannot be asked', async () => {
    mockIn.mockResolvedValue({ data: null, error: { message: 'x' } });
    await expect(deletedWaterIds([], [entry('gone', v)])).rejects.toThrow();
  });
  it('a delete version beats the saved one even when this clock is behind; null when never exported here', () => {
    expect(waterDeleteVersion([entry('w1', 5000)], 'w1', 10)).toBe(5001);
    expect(waterDeleteVersion([], 'w1')).toBeNull();
    expect(waterVersion('nope')).toBeNull();
  });
});

describe('settling water in Health (keep or remove)', () => {
  const controls = (initial: ExportEntry[], deletes: 'finish' | 'wait' = 'finish') => {
    let entries = initial;
    return {
      getEntries: () => entries,
      enqueue: jest.fn(async (kind: string, recordId: string, op: 'save' | 'delete', payload: unknown, version?: number) => {
        entries = entries.filter((e) => e.recordId !== recordId);
        if (deletes === 'wait') entries = [...entries, { kind, recordId, op, payload, version: version!, status: 'pending', attempts: 0 }];
      }),
      forget: jest.fn(async (kind: string, match: (e: ExportEntry) => boolean = () => true) => { entries = entries.filter((e) => !(e.kind === kind && match(e))); }),
    };
  };
  const all = [entry('sent', 1), entry('waiting', 1, { status: 'pending', payload: { ml: 1 } }), entry('del', 1, { op: 'delete', status: 'pending' }), { ...entry('f', 1), kind: 'food' }];

  it('counts what reached Health, including a save that may have been written', () => {
    expect(exportedWater([...all, entry('half', 1, { status: 'pending', attemptVersion: 2 })]).map((e) => e.recordId)).toEqual(['sent', 'half']);
  });
  it('keep forgets every water save, writes nothing, and leaves a queued delete and other kinds', async () => {
    const c = controls(all);
    await settleWaterExport(c, false);
    expect(c.enqueue).not.toHaveBeenCalled();
    expect(c.getEntries().map((e) => e.recordId)).toEqual(['del', 'f']);
  });
  it('remove queues a delete for every save that reached Health and forgets one never attempted', async () => {
    const c = controls(all.filter((e) => e.recordId !== 'del'));
    await settleWaterExport(c, true);
    expect(c.enqueue.mock.calls.map((x) => [x[1], x[2]])).toEqual([['sent', 'delete']]);
    expect(c.getEntries().map((e) => e.recordId)).toEqual(['f']);
  });
  it('remove says so when a delete has not finished, and bumps the sync generation before and after', async () => {
    const before = waterSyncGeneration();
    await expect(settleWaterExport(controls([entry('sent', 1)], 'wait'), true)).rejects.toThrow(/Couldn't remove some water/);
    expect(waterSyncGeneration()).toBe(before + 2);
  });
});

test('removing an entry whose save is written while forget waits for the flight queues a delete instead of dropping it', async () => {
  let entries: ExportEntry[] = [entry('w1', 1, { status: 'pending', payload: { ml: 1 } })];
  const enqueue = jest.fn(async (kind: string, recordId: string, op: 'save' | 'delete', payload: unknown, version?: number) => {
    entries = [...entries.filter((e) => e.recordId !== recordId), { kind, recordId, op, payload, version: version!, status: 'pending', attempts: 0 }];
  });
  // forget awaits the write in flight, which stamps and writes w1, then applies its match.
  const forget = jest.fn(async (kind: string, match: (e: ExportEntry) => boolean = () => true) => {
    entries = entries.map((e) => ({ ...e, status: 'success', attemptVersion: 2 }));
    entries = entries.filter((e) => !(e.kind === kind && match(e)));
  });
  await removeWaterExport({ getEntries: () => entries, enqueue, forget }, 'w1');
  expect(enqueue.mock.calls.map((c) => [c[1], c[2]])).toEqual([['w1', 'delete']]);
});
