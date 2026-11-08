import { Platform } from 'react-native';

import { reconcileHealth, type HealthJournal, type JournalState } from './changes';
import { createExportQueue, exportWriters, writeTypesFor, type ExportEntry } from './export-queue';
import { FOOD_KIND, foodPayload } from './food-export';
import { OWN_PACKAGE, refreshHealthConnectWriteAccess, resetHealthConnectCache } from './health-connect';
import { registerHealthConnectWriters } from './health-connect-export';
import { getHealthWriteAccess } from './healthkit';
import { MANUAL_KINDS } from './manual-export';
import { WATER_KIND } from './water-export';
import { WORKOUT_KIND, workoutPayload } from './workout-export';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/metrics', () => ({ getMyRecentSteps: jest.fn(), upsertDailyMetrics: jest.fn() }));

// Health Connect upsert semantics: one record per (app, clientRecordId); a write replaces it only with a higher version.
type Rec = { recordType: string; metadata: { id: string; dataOrigin: string; clientRecordId?: string; clientRecordVersion?: number }; [k: string]: unknown };
let records: Rec[] = [];
const grants = new Set<string>();
let failNext = false, n = 0;
const mockHc = {
  getSdkStatus: jest.fn(async () => 3),
  initialize: jest.fn(async () => true),
  getGrantedPermissions: jest.fn(async () => [...grants].map((k) => ({ accessType: k.split(':')[0], recordType: k.split(':')[1] }))),
  requestPermission: jest.fn(async (perms: { accessType: string; recordType: string }[]) => { perms.forEach((p) => grants.add(`${p.accessType}:${p.recordType}`)); return perms; }),
  insertRecords: jest.fn(async (input: Rec[]) => {
    const r = input[0];
    if (!grants.has(`write:${r.recordType}`)) throw new Error('SecurityException: missing write permission');
    if (failNext) { failNext = false; throw new Error('RemoteException'); }
    const old = records.find((x) => x.metadata.dataOrigin === OWN_PACKAGE && x.metadata.clientRecordId === r.metadata.clientRecordId);
    if (old && old.metadata.clientRecordVersion! >= r.metadata.clientRecordVersion!) return [old.metadata.id];
    const id = old?.metadata.id ?? `hc-${++n}`;
    records = [...records.filter((x) => x !== old), { ...r, metadata: { ...r.metadata, id, dataOrigin: OWN_PACKAGE } }];
    return [id];
  }),
  deleteRecordsByUuids: jest.fn(async (type: string, _ids: string[], clientIds: string[]) => {
    if (!grants.has(`write:${type}`)) throw new Error('SecurityException');
    records = records.filter((x) => !(x.recordType === type && x.metadata.dataOrigin === OWN_PACKAGE && clientIds.includes(x.metadata.clientRecordId!)));
  }),
  getChanges: jest.fn(async () => ({ upsertionChanges: [], deletionChanges: [], nextChangesToken: 't', hasMore: false, changesTokenExpired: false })),
  readRecords: jest.fn(async (type: string, o: { ascendingOrder: boolean }) => ({ records: records.filter((r) => r.recordType === type).map(({ recordType: _t, ...r }) => r).sort(() => (o.ascendingOrder ? 0 : -1)) })),
};
jest.mock('react-native-health-connect', () => mockHc);

function makeQueue() {
  const store = new Map<string, ExportEntry>();
  return createExportQueue({
    checkAccount: async () => {},
    store: { list: async () => [...store.values()], put: async (e) => { store.set(`${e.kind}:${e.recordId}`, e); }, remove: async (k, r) => { store.delete(`${k}:${r}`); }, clear: async () => store.clear() },
    mapping: { get: async () => null, record: async () => {}, remove: async () => {} },
    writers: exportWriters,
    access: getHealthWriteAccess,
  });
}
const entry = (q: ReturnType<typeof makeQueue>, kind: string) => q.getSnapshot().entries.find((e) => e.kind === kind);
const at = '2026-10-25T08:00:00.000Z';

beforeAll(() => {
  jest.replaceProperty(Platform, 'OS', 'android');
  registerHealthConnectWriters();
});
beforeEach(async () => {
  jest.replaceProperty(Platform, 'OS', 'android');
  resetHealthConnectCache();
  records = []; grants.clear(); failNext = false; n = 0;
  jest.clearAllMocks();
});

test('weight saves with the shared export id, retries without duplicating, and an edit replaces it', async () => {
  grants.add('write:Weight');
  await refreshHealthConnectWriteAccess();
  const q = makeQueue();
  await q.initialize();
  failNext = true;
  await q.enqueue(MANUAL_KINDS.weight, 'w1', 'save', { kg: 80, at }, 1);
  expect(entry(q, MANUAL_KINDS.weight)).toMatchObject({ status: 'failed', reason: 'error' });
  await q.process(); // retry
  await q.process(); // already saved: nothing more to write
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({ recordType: 'Weight', time: at, weight: { value: 80, unit: 'kilograms' },
    metadata: { clientRecordId: 'leaderboard:manual-weight:w1', clientRecordVersion: 1, dataOrigin: OWN_PACKAGE } });
  await q.enqueue(MANUAL_KINDS.weight, 'w1', 'save', { kg: 79, at }, 2);
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({ weight: { value: 79 }, metadata: { clientRecordVersion: 2 } });
  expect(entry(q, MANUAL_KINDS.weight)).toMatchObject({ status: 'success', sampleUuid: records[0].metadata.id });
});

test('delete removes only our own record by client record id', async () => {
  grants.add('write:SleepSession');
  await refreshHealthConnectWriteAccess();
  records = [{ recordType: 'SleepSession', metadata: { id: 'other', dataOrigin: 'com.watch', clientRecordId: 'leaderboard:manual-sleep:2026-10-25' }, startTime: at, endTime: at }];
  const q = makeQueue();
  await q.initialize();
  await q.enqueue(MANUAL_KINDS.sleep, '2026-10-25', 'save', { start: '2026-10-24T22:00:00.000Z', end: at }, 1);
  expect(records.map((r) => r.metadata.id)).toEqual(['other', 'hc-1']);
  await q.enqueue(MANUAL_KINDS.sleep, '2026-10-25', 'delete', null, 2);
  expect(records.map((r) => r.metadata.id)).toEqual(['other']);
  expect(entry(q, MANUAL_KINDS.sleep)).toBeUndefined();
  expect(mockHc.deleteRecordsByUuids).toHaveBeenCalledWith('SleepSession', [], ['leaderboard:manual-sleep:2026-10-25']);
});

test('a missing or revoked write grant is a permission state, per type, never silent success', async () => {
  grants.add('write:Weight'); // partial grant: weight yes, sleep no
  await refreshHealthConnectWriteAccess();
  const q = makeQueue();
  await q.initialize();
  await q.enqueue(MANUAL_KINDS.sleep, 'd1', 'save', { start: '2026-10-24T22:00:00.000Z', end: at }, 1);
  await q.enqueue(MANUAL_KINDS.weight, 'w1', 'save', { kg: 80, at }, 1);
  expect(entry(q, MANUAL_KINDS.sleep)).toMatchObject({ status: 'failed', reason: 'permission' });
  expect(entry(q, MANUAL_KINDS.weight)).toMatchObject({ status: 'success' });
  expect(mockHc.insertRecords).toHaveBeenCalledTimes(1);
  grants.delete('write:Weight'); // revoked in Health Connect while the cached grant still says yes
  await q.enqueue(MANUAL_KINDS.weight, 'w1', 'save', { kg: 81, at }, 2);
  expect(entry(q, MANUAL_KINDS.weight)).toMatchObject({ status: 'failed', reason: 'permission' });
  expect(getHealthWriteAccess('Weight')).toBe('not-asked');
});

test('steps have no Android writer, so the switch is not offered and a stray entry fails visibly', async () => {
  expect(writeTypesFor(MANUAL_KINDS.steps)).toEqual([]);
  expect(writeTypesFor(MANUAL_KINDS.weight)).toEqual(['Weight']);
  expect(writeTypesFor(FOOD_KIND)).toEqual(['Nutrition']);
  const q = makeQueue();
  await q.initialize();
  await q.enqueue(MANUAL_KINDS.steps, '2026-10-25', 'save', { count: 10, start: at, end: at }, 1);
  expect(entry(q, MANUAL_KINDS.steps)).toMatchObject({ status: 'failed', reason: 'error' });
});

test('workouts and food map to Health Connect records; unknown nutrients stay absent', async () => {
  grants.add('write:ExerciseSession').add('write:Nutrition');
  await refreshHealthConnectWriteAccess();
  const q = makeQueue();
  await q.initialize();
  await q.enqueue(WORKOUT_KIND, 'k1', 'save', workoutPayload({ activityType: 'Run', startedAt: new Date(at), endedAt: new Date('2026-10-25T08:30:00.000Z'), distanceM: 5000 }), 1);
  await q.enqueue(FOOD_KIND, 'f1', 'save', foodPayload({ name: 'Oats', consumedAt: at, nutrients: { energy_kcal: 150, protein_g: 5, carbs_g: 27, fat_g: 3, fiber_g: null, sugars_g: 1, sat_fat_g: 0.5, sodium_mg: 0 } }), 7);
  expect(records.find((r) => r.recordType === 'ExerciseSession')).toMatchObject({ exerciseType: 56, title: 'Run', startTime: at, endTime: '2026-10-25T08:30:00.000Z' });
  const food = records.find((r) => r.recordType === 'Nutrition')!;
  expect(food).toMatchObject({ name: 'Oats', startTime: at, endTime: '2026-10-25T08:00:01.000Z', mealType: 0, energy: { value: 150, unit: 'kilocalories' },
    protein: { value: 5, unit: 'grams' }, totalCarbohydrate: { value: 27, unit: 'grams' }, sodium: { value: 0, unit: 'milligrams' }, metadata: { clientRecordId: 'leaderboard:food:f1' } });
  expect(food.dietaryFiber).toBeUndefined();
  expect(food.metadata.clientRecordVersion).toBeGreaterThanOrEqual(7); // the queue's attempt version, above every earlier attempt
  expect(entry(q, FOOD_KIND)?.writtenTypes).toBe(255); // one permission covers every nutrient
});

test('water saves as a Hydration record in mL, asks for the Hydration write grant, and an edit replaces it', async () => {
  expect(writeTypesFor(WATER_KIND)).toEqual(['Hydration']);
  grants.add('write:Hydration');
  await refreshHealthConnectWriteAccess();
  const q = makeQueue();
  await q.initialize();
  await q.enqueue(WATER_KIND, 'w1', 'save', { ml: 250, at }, 1);
  await q.enqueue(WATER_KIND, 'w1', 'save', { ml: 300, at }, 2);
  const water = records.filter((r) => r.recordType === 'Hydration');
  expect(water).toHaveLength(1);
  expect(water[0]).toMatchObject({ startTime: at, endTime: '2026-10-25T08:00:01.000Z', volume: { value: 300, unit: 'milliliters' }, metadata: { clientRecordId: 'leaderboard:water:w1' } });
  await q.enqueue(WATER_KIND, 'w1', 'delete', null, 3);
  expect(records.filter((r) => r.recordType === 'Hydration')).toHaveLength(0);
});

test('records this app wrote are never imported back', async () => {
  grants.add('write:Weight').add('read:Weight');
  await refreshHealthConnectWriteAccess();
  const q = makeQueue();
  await q.initialize();
  await q.enqueue(MANUAL_KINDS.weight, 'w1', 'save', { kg: 80, at }, 1);
  records.push({ recordType: 'Weight', metadata: { id: 'scale-1', dataOrigin: 'com.scale' }, time: '2026-10-26T08:00:00.000Z', weight: { inKilograms: 81 } });
  records[0] = { ...records[0], weight: { inKilograms: 80 } };
  let state: JournalState | null = null;
  const journal: HealthJournal = { read: async () => state, write: async (_m, s) => { state = JSON.parse(JSON.stringify(s)); } };
  const upload = jest.fn(async () => {});
  await reconcileHealth('weight', { journal, checkOwner: async () => {}, upload, now: new Date('2026-10-28T12:00:00Z') });
  expect(upload).toHaveBeenLastCalledWith('weight', expect.objectContaining({ weight: [{ measured_at: '2026-10-26T08:00:00.000Z', kg: 81 }] }));
});

test('a version another device exported to its own store never skips the Health Connect write, and is not overwritten', async () => {
  grants.add('write:Nutrition');
  await refreshHealthConnectWriteAccess();
  // The account's shared mapping already has this food at the same version, written from the user's iPhone.
  const mapping = { get: jest.fn(async () => ({ syncVersion: 7 })), record: jest.fn(async () => {}), remove: jest.fn(async () => {}) };
  const store = new Map<string, ExportEntry>();
  const q = createExportQueue({
    checkAccount: async () => {},
    store: { list: async () => [...store.values()], put: async (e) => { store.set(`${e.kind}:${e.recordId}`, e); }, remove: async (k, r) => { store.delete(`${k}:${r}`); }, clear: async () => store.clear() },
    mapping, writers: exportWriters, access: getHealthWriteAccess,
  });
  await q.initialize();
  await q.enqueue(FOOD_KIND, 'f1', 'save', foodPayload({ name: 'Oats', consumedAt: at, nutrients: { energy_kcal: 150, protein_g: null, carbs_g: null, fat_g: null, fiber_g: null, sugars_g: null, sat_fat_g: null, sodium_mg: null } }), 7);
  expect(records.filter((r) => r.recordType === 'Nutrition')).toHaveLength(1);
  await q.enqueue(FOOD_KIND, 'f1', 'delete', null, 8);
  expect(records).toHaveLength(0);
  // Health Connect is on this phone only: its writes must not tell the iPhone (Apple Health) that it is done, or undo that.
  expect(mapping.record).not.toHaveBeenCalled();
  expect(mapping.remove).not.toHaveBeenCalled();
});
