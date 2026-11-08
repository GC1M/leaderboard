import { Platform } from 'react-native';

import { createExportQueue, exportWriters, type ExportEntry } from './export-queue';
import { FOOD_KIND, foodPayload } from './food-export';
import { OWN_PACKAGE, refreshHealthConnectWriteAccess, resetHealthConnectCache } from './health-connect';
import { registerHealthConnectWriters } from './health-connect-export';
import { getHealthWriteAccess } from './healthkit';
import { WATER_KIND } from './water-export';
import { WORKOUT_KIND, workoutPayload } from './workout-export';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/metrics', () => ({ getMyRecentSteps: jest.fn(), upsertDailyMetrics: jest.fn() }));

// QA (#64). Same Health Connect upsert mock as health-connect-export.test.ts, plus the androidx record validation that
// interval records (ExerciseSession, SleepSession, Nutrition, Hydration) need startTime strictly before endTime.
type Rec = { recordType: string; metadata: { id: string; dataOrigin: string; clientRecordId?: string; clientRecordVersion?: number }; [k: string]: unknown };
let records: Rec[] = [];
const grants = new Set<string>();
let n = 0;
const INTERVAL = new Set(['ExerciseSession', 'SleepSession', 'Nutrition', 'Hydration']);
const mockHc = {
  getSdkStatus: jest.fn(async () => 3),
  initialize: jest.fn(async () => true),
  getGrantedPermissions: jest.fn(async () => [...grants].map((k) => ({ accessType: k.split(':')[0], recordType: k.split(':')[1] }))),
  requestPermission: jest.fn(async (perms: { accessType: string; recordType: string }[]) => { perms.forEach((p) => grants.add(`${p.accessType}:${p.recordType}`)); return perms; }),
  insertRecords: jest.fn(async (input: Rec[]) => {
    const r = input[0];
    if (INTERVAL.has(r.recordType) && !(Date.parse(r.endTime as string) > Date.parse(r.startTime as string))) throw new Error('java.lang.IllegalArgumentException: startTime must be before endTime.');
    if (!grants.has(`write:${r.recordType}`)) throw new Error('SecurityException: missing write permission');
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
};
jest.mock('react-native-health-connect', () => mockHc);

function makeQueue(store = new Map<string, ExportEntry>()) {
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
const noNutrients = { energy_kcal: null, protein_g: null, carbs_g: null, fat_g: null, fiber_g: null, sugars_g: null, sat_fat_g: null, sodium_mg: null };

beforeAll(() => { jest.replaceProperty(Platform, 'OS', 'android'); registerHealthConnectWriters(); });
beforeEach(() => {
  jest.replaceProperty(Platform, 'OS', 'android');
  resetHealthConnectCache();
  records = []; grants.clear(); n = 0;
  jest.clearAllMocks();
});

describe('QA suspected bugs', () => {
  // 1a
  it('1a: an app-logged workout with zero duration (start == end) is saved to Health Connect', async () => {
    grants.add('write:ExerciseSession');
    await refreshHealthConnectWriteAccess();
    const q = makeQueue();
    await q.initialize();
    // createManualWorkout and workoutPayload both accept endedAt == startedAt.
    await q.enqueue(WORKOUT_KIND, 'k0', 'save', workoutPayload({ activityType: 'Run', startedAt: new Date(at), endedAt: new Date(at) }), 1);
    await q.process(); await q.process();
    expect({ status: entry(q, WORKOUT_KIND)?.status, attempts: entry(q, WORKOUT_KIND)?.attempts, saved: records.length })
      .toEqual({ status: 'success', attempts: 0, saved: 1 });
  });

});

describe('QA write permissions', () => {
  it('write grants revoked after water/workout/food entries are queued: marked as permission failures, kept, and saved after re-grant', async () => {
    const store = new Map<string, ExportEntry>();
    grants.add('write:Hydration').add('write:ExerciseSession').add('write:Nutrition');
    await refreshHealthConnectWriteAccess();
    const q = makeQueue(store); // not initialized yet: enqueue stores but does not process (app killed before the run)
    await q.enqueue(WATER_KIND, 'w1', 'save', { ml: 250, at }, 1);
    await q.enqueue(WORKOUT_KIND, 'k1', 'save', workoutPayload({ activityType: 'Walk', startedAt: new Date(at), endedAt: new Date('2026-10-25T08:30:00.000Z') }), 1);
    await q.enqueue(FOOD_KIND, 'f1', 'save', foodPayload({ name: 'Oats', consumedAt: at, nutrients: { ...noNutrients, energy_kcal: 150 } }), 1);
    grants.clear(); // revoked in Health Connect settings
    await refreshHealthConnectWriteAccess(); // what the app does on foreground
    await q.initialize(); await q.process();
    for (const k of [WATER_KIND, WORKOUT_KIND, FOOD_KIND]) expect(entry(q, k)).toMatchObject({ status: 'failed', reason: 'permission' });
    expect([...store.values()].every((e) => e.payload !== null)).toBe(true);
    expect(mockHc.insertRecords).not.toHaveBeenCalled();
    grants.add('write:Hydration').add('write:ExerciseSession').add('write:Nutrition');
    await refreshHealthConnectWriteAccess(); await q.process();
    for (const k of [WATER_KIND, WORKOUT_KIND, FOOD_KIND]) expect(entry(q, k)).toMatchObject({ status: 'success' });
    expect(records.map((r) => r.recordType).sort()).toEqual(['ExerciseSession', 'Hydration', 'Nutrition']);
  });
  it('water: grant revoked while the cached grant still says yes is a permission failure, not an error', async () => {
    grants.add('write:Hydration');
    await refreshHealthConnectWriteAccess();
    const q = makeQueue();
    await q.initialize();
    grants.delete('write:Hydration');
    await q.enqueue(WATER_KIND, 'w1', 'save', { ml: 250, at }, 1);
    expect(entry(q, WATER_KIND)).toMatchObject({ status: 'failed', reason: 'permission', payload: { ml: 250 } });
  });
  it('water delete stuck on a revoked grant is dropped when the user turns water saving off (dropRevokedDeletes)', async () => {
    grants.add('write:Hydration');
    await refreshHealthConnectWriteAccess();
    const q = makeQueue();
    await q.initialize();
    await q.enqueue(WATER_KIND, 'w1', 'save', { ml: 250, at }, 1);
    grants.clear(); await refreshHealthConnectWriteAccess();
    await q.enqueue(WATER_KIND, 'w1', 'delete', null, 2);
    expect(entry(q, WATER_KIND)).toMatchObject({ op: 'delete', status: 'failed', reason: 'permission' });
    await q.discard(WATER_KIND);
    expect(entry(q, WATER_KIND)).toBeUndefined();
  });
});
