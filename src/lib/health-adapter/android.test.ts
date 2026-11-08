import { Platform } from 'react-native';

import { startOfLocalDay } from '../health/dates';
import { OWN_PACKAGE, resetHealthConnectCache } from '../health/health-connect';
import { createAndroidHealthAdapter } from './android';
import { runHealthAdapterContract } from './contract-suite';

jest.mock('@/lib/metrics', () => ({ getMyRecentSteps: jest.fn(), upsertDailyMetrics: jest.fn() }));

// Grants mirror Health Connect: each requested type is its own toggle, and reads report the truth.
const grants = new Set<string>();
const records: Record<string, unknown[]> = {};
let sdk = 3, historyFloor: string | null = null;
const mockHc = {
  getSdkStatus: jest.fn(async () => sdk),
  initialize: jest.fn(async () => true),
  getGrantedPermissions: jest.fn(async () => [...grants].map((k) => ({ accessType: k.split(':')[0], recordType: k.split(':')[1] }))),
  requestPermission: jest.fn(async (perms: { accessType: string; recordType: string }[]) => { perms.forEach((p) => grants.add(`${p.accessType}:${p.recordType}`)); return perms; }),
  readRecords: jest.fn(async (type: string, o: { timeRangeFilter: { startTime: string } }) => {
    if (historyFloor && o.timeRangeFilter.startTime < historyFloor) throw new Error('Reading data older than allowed');
    return { records: records[type] ?? [] };
  }),
  aggregateRecord: jest.fn(async () => ({ COUNT_TOTAL: 0, dataOrigins: [] as string[] })),
};
jest.mock('react-native-health-connect', () => mockHc);

beforeEach(() => {
  jest.replaceProperty(Platform, 'OS', 'android');
  resetHealthConnectCache();
  grants.clear();
  for (const k of Object.keys(records)) delete records[k];
  sdk = 3; historyFloor = null;
  jest.clearAllMocks();
});

runHealthAdapterContract('Android adapter', {
  make: () => createAndroidHealthAdapter(),
  hooks: { makeUnavailable: () => { sdk = 2; resetHealthConnectCache(); return createAndroidHealthAdapter(); } },
});

describe('Android adapter over Health Connect', () => {
  it('reports read grants truthfully, per type', async () => {
    const a = createAndroidHealthAdapter();
    expect(await a.getPermission('sleep', 'read')).toBe('not-asked');
    expect(await a.readSleep({ days: 7 })).toEqual({ status: 'permission-required', access: 'read' });
    grants.add('read:Steps');
    expect(await a.getPermission('steps', 'read')).toBe('granted');
    expect(await a.getPermission('sleep', 'read')).toBe('not-asked');
    expect(await a.getPermission('steps', 'write')).toBe('unavailable');
    expect(await a.getPermission('steps', 'history')).toBe('unknown');
  });
  it('asks for write access per type, separately from reads, and never for steps', async () => {
    const a = createAndroidHealthAdapter();
    expect(await a.getPermission('weight', 'write')).toBe('not-asked');
    await a.requestPermissions('write', ['weight', 'steps']);
    expect(mockHc.requestPermission).toHaveBeenLastCalledWith([{ accessType: 'write', recordType: 'Weight' }]);
    expect(await a.getPermission('weight', 'write')).toBe('granted');
    expect(await a.getPermission('weight', 'read')).toBe('not-asked');
    expect(await a.getPermission('steps', 'write')).toBe('unavailable');
  });
  it('maps SDK status to the shared availability results', async () => {
    sdk = 1;
    expect(await createAndroidHealthAdapter().getAvailability()).toEqual({ status: 'unsupported', reason: 'os-version' });
    sdk = 2; resetHealthConnectCache();
    expect(await createAndroidHealthAdapter().getCapability('steps', 'read')).toEqual({ status: 'unavailable', reason: 'provider-update-required' });
  });
  it('reads daily steps by aggregation and omits days without steps', async () => {
    const a = createAndroidHealthAdapter();
    await a.requestPermissions('read', ['steps']);
    mockHc.aggregateRecord.mockResolvedValueOnce({ COUNT_TOTAL: 4321, dataOrigins: ['com.watch'] });
    expect(await a.readSteps({ days: 3, now: new Date(2026, 9, 26, 12) })).toEqual({ status: 'ok', data: [{ date: '2026-10-26', count: 4321 }] });
    expect(mockHc.aggregateRecord).toHaveBeenCalledTimes(3);
  });
  it('maps weight and workouts with provenance and says when history was cut short', async () => {
    const a = createAndroidHealthAdapter();
    await a.requestPermissions('read', ['weight', 'workouts']);
    records.Weight = [{ metadata: { id: 'w1', dataOrigin: 'com.scale', recordingMethod: 2 }, time: '2026-10-25T08:00:00Z', weight: { inKilograms: 70 } },
      { metadata: { id: 'w2', dataOrigin: OWN_PACKAGE, recordingMethod: 3 }, time: '2026-10-25T09:00:00Z', weight: { inKilograms: 71 } }];
    records.ExerciseSession = [{ metadata: { id: 'e1', dataOrigin: 'com.run' }, startTime: '2026-10-25T07:00:00Z', endTime: '2026-10-25T07:30:00Z', exerciseType: 79 }];
    const now = new Date();
    historyFloor = startOfLocalDay(now, 30).toISOString();
    const weight = await a.readWeight({ days: 90, now });
    expect(weight).toMatchObject({ status: 'ok', truncatedFrom: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    expect(weight.status === 'ok' && weight.data).toEqual([
      { id: 'android:w1', measuredAt: '2026-10-25T08:00:00.000Z', kg: 70, provenance: { origin: 'other-app', recording: 'automatic' } },
      { id: 'android:w2', measuredAt: '2026-10-25T09:00:00.000Z', kg: 71, provenance: { origin: 'this-app', recording: 'manual' } },
    ]);
    expect(await a.readWorkouts!({ days: 7, now })).toEqual({ status: 'ok', data: [
      { id: 'android:e1', start: '2026-10-25T07:00:00.000Z', end: '2026-10-25T07:30:00.000Z', activity: 'Walking', provenance: { origin: 'other-app', recording: 'unknown' } },
    ] });
  });
  it('is explicit that changes and writes are not routed through the adapter', async () => {
    const a = createAndroidHealthAdapter();
    expect(await a.readChanges('weight', null)).toEqual({ status: 'unsupported', reason: 'not-implemented' });
    expect(await a.write({ recordId: 'r', version: 1, payload: { type: 'weight', measuredAt: '2026-10-25T08:00:00Z', kg: 70 } })).toEqual({ status: 'unsupported', reason: 'not-implemented' });
  });
});
