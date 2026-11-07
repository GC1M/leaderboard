import { Platform } from 'react-native';

import { reconcileHealth, type HealthJournal, type JournalState } from './changes';
import { createHealthCoordinator } from './coordinator';
import { startOfLocalDay } from './dates';
import { getHealthConnectAvailability, OWN_PACKAGE, queryHealthConnectChanges, resetHealthConnectCache } from './health-connect';
import { getAllHealthAccess, getHealthAccess, healthUnavailableMessage, requestHealthAccess } from './healthkit';
import { summarizeSleep } from './sleep';
import { readLatestWeight } from './weight';

jest.mock('@/lib/metrics', () => ({ getMyRecentSteps: jest.fn(), upsertDailyMetrics: jest.fn() }));

// In-memory Health Connect: records per type, a change log that changes tokens index into, and permission grants.
type Rec = { metadata: { id: string; dataOrigin: string }; startTime?: string; endTime?: string; time?: string; [k: string]: unknown };
const store: Record<string, Rec[]> = {};
let log: { type: string; record?: Rec; id: string }[] = [];
const grants = new Set<string>();
const expired = new Set<string>();
let sdk = 3, historyFloor: string | null = null, grantOnly: string[] | null = null, stepTotal = 0;
const at = (r: Rec) => r.startTime ?? r.time!;
const mockHc = {
  getSdkStatus: jest.fn(async () => sdk),
  initialize: jest.fn(async () => true),
  getGrantedPermissions: jest.fn(async () => [...grants].map((k) => ({ accessType: k.split(':')[0], recordType: k.split(':')[1] }))),
  requestPermission: jest.fn(async (perms: { accessType: string; recordType: string }[]) => {
    perms.filter((p) => !grantOnly || grantOnly.includes(p.recordType)).forEach((p) => grants.add(`${p.accessType}:${p.recordType}`));
    return perms;
  }),
  readRecords: jest.fn(async (type: string, o: { timeRangeFilter: { startTime: string; endTime?: string }; pageSize: number; pageToken?: string; ascendingOrder: boolean }) => {
    if (historyFloor && o.timeRangeFilter.startTime < historyFloor) throw new Error('Reading data older than allowed');
    const rows = (store[type] ?? []).filter((r) => (r.endTime ?? r.time!) >= o.timeRangeFilter.startTime && (!o.timeRangeFilter.endTime || at(r) <= o.timeRangeFilter.endTime))
      .sort((a, b) => (o.ascendingOrder ? 1 : -1) * at(a).localeCompare(at(b)));
    const offset = Number(o.pageToken ?? 0), next = offset + o.pageSize;
    return { records: rows.slice(offset, next), pageToken: next < rows.length ? String(next) : undefined }; // like the native module: no recordType
  }),
  getChanges: jest.fn(async ({ changesToken, recordTypes }: { changesToken?: string; recordTypes?: string[] }) => {
    const empty = { upsertionChanges: [], deletionChanges: [], hasMore: false, changesTokenExpired: false };
    if (!changesToken) return { ...empty, nextChangesToken: `${recordTypes![0]}@${log.length}` };
    if (expired.has(changesToken)) return { ...empty, nextChangesToken: '', changesTokenExpired: true };
    const [type, from] = changesToken.split('@');
    const entries = log.slice(Number(from)).filter((e) => e.type === type);
    return { ...empty, nextChangesToken: `${type}@${log.length}`,
      upsertionChanges: entries.filter((e) => e.record).map((e) => ({ record: { ...e.record, recordType: type } })),
      deletionChanges: entries.filter((e) => !e.record).map((e) => ({ recordId: e.id })) };
  }),
  aggregateRecord: jest.fn(async () => ({ COUNT_TOTAL: stepTotal, dataOrigins: ['com.watch'] })),
  openHealthConnectSettings: jest.fn(),
};
jest.mock('react-native-health-connect', () => mockHc);

const put = (type: string, r: Rec) => { store[type] = [...(store[type] ?? []).filter((x) => x.metadata.id !== r.metadata.id), r]; log.push({ type, record: r, id: r.metadata.id }); };
const del = (type: string, id: string) => { store[type] = (store[type] ?? []).filter((x) => x.metadata.id !== id); log.push({ type, id }); };
const meta = (id: string, dataOrigin = 'com.watch') => ({ id, dataOrigin });
const local = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).toISOString(); // October 2026, device-local
const steps = (id: string, d: number, count: number, origin?: string): Rec => ({ metadata: meta(id, origin), startTime: local(d, 9), endTime: local(d, 10), count });
function memory(initial: JournalState | null = null) {
  let state = initial;
  const journal: HealthJournal = { read: async () => (state ? JSON.parse(JSON.stringify(state)) : null), write: async (_m, s) => { state = JSON.parse(JSON.stringify(s)); } };
  return { journal, state: () => state! };
}
const NOW = new Date(2026, 9, 28, 12);
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const sync = (metric: Parameters<typeof reconcileHealth>[0], mem: ReturnType<typeof memory>, upload = jest.fn(async () => {})) =>
  reconcileHealth(metric, { journal: mem.journal, checkOwner: async () => {}, upload, now: NOW });

beforeEach(() => {
  jest.replaceProperty(Platform, 'OS', 'android');
  resetHealthConnectCache();
  for (const k of Object.keys(store)) delete store[k];
  log = []; grants.clear(); expired.clear();
  sdk = 3; historyFloor = null; grantOnly = null; stepTotal = 0;
  jest.clearAllMocks();
});

describe('availability', () => {
  it('maps SDK status to unsupported, install/update and available, and never loads on iOS', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    resetHealthConnectCache();
    expect(await getHealthConnectAvailability()).toBe('native-build-required');
    jest.replaceProperty(Platform, 'OS', 'android');
    for (const [status, expected] of [[1, 'unsupported'], [2, 'provider-update-required'], [3, 'available']] as const) {
      resetHealthConnectCache();
      sdk = status;
      expect(await getHealthConnectAvailability()).toBe(expected);
    }
    expect(mockHc.initialize).toHaveBeenCalledTimes(1); // only once the provider is usable
  });
  it('reports every metric unavailable with install guidance until Health Connect is usable', async () => {
    sdk = 2;
    expect(await getHealthAccess('steps')).toBe('unavailable');
    expect(await healthUnavailableMessage()).toMatch(/Install or update Health Connect/);
    await requestHealthAccess();
    expect(mockHc.requestPermission).not.toHaveBeenCalled();
    sdk = 1; resetHealthConnectCache();
    expect(await healthUnavailableMessage()).toMatch(/Android 9/);
  });
});

describe('permissions', () => {
  it('asks for every read type plus history in one sheet and reports partial grants per metric', async () => {
    expect(await getAllHealthAccess()).toEqual({ steps: 'not-asked', sleep: 'not-asked', weight: 'not-asked', workouts: 'not-asked' });
    grantOnly = ['Steps', 'Weight'];
    await requestHealthAccess();
    expect(mockHc.requestPermission.mock.calls[0][0].map((p) => p.recordType)).toEqual(['Steps', 'SleepSession', 'Weight', 'ExerciseSession', 'ReadHealthDataHistory']);
    expect(mockHc.requestPermission.mock.calls[0][0].every((p) => p.accessType === 'read')).toBe(true);
    expect(await getAllHealthAccess()).toEqual({ steps: 'asked', sleep: 'not-asked', weight: 'asked', workouts: 'not-asked' });
  });
  it('re-checks grants before every sync, so a revocation stops that metric only', async () => {
    grants.add('read:Steps').add('read:SleepSession');
    const reconcile = jest.fn(async () => ({ hasMore: false, knownSamples: 1, written: 1 }));
    const c = createHealthCoordinator({ checkAccount: async () => {}, load: async () => ({ connected: true, lastSuccess: {} }), save: async () => {},
      requestAccess: async () => {}, access: getHealthAccess, reconcile, recheck: async () => {}, deleteImports: async () => {} });
    await c.initialize();
    await c.sync();
    expect(reconcile.mock.calls.map((call) => (call as unknown[])[0]).sort()).toEqual(['sleep', 'steps']);
    grants.delete('read:Steps'); // revoked in Health Connect settings while the app was open
    reconcile.mockClear();
    await c.sync();
    expect(reconcile.mock.calls.map((call) => (call as unknown[])[0])).toEqual(['sleep']);
    expect(c.getSnapshot().metrics.steps.status).toBe('needs-permission');
    expect(c.getSnapshot().metrics.weight.status).toBe('needs-permission');
  });
});

describe('change feed', () => {
  const fresh = (): JournalState => ({ from: new Date(2026, 6, 30).toISOString(), samples: [] });
  it('takes the changes token before paging through history, then switches to getChanges', async () => {
    put('Steps', steps('a', 20, 10)); put('Steps', steps('b', 21, 20)); put('Steps', steps('c', 22, 30));
    let state = fresh();
    const first = await queryHealthConnectChanges('steps', state, 2);
    expect(mockHc.getChanges.mock.invocationCallOrder[0]).toBeLessThan(mockHc.readRecords.mock.invocationCallOrder[0]);
    expect(first).toMatchObject({ hasMore: true, deleted: [] });
    expect(first.samples.map((s) => s.id)).toEqual(['a', 'b']);
    put('Steps', steps('d', 23, 40)); // written while the import is still paging
    state = { ...state, anchor: first.anchor };
    const second = await queryHealthConnectChanges('steps', state, 2);
    expect(second.samples.map((s) => s.id)).toEqual(['c', 'd']);
    expect(second.hasMore).toBe(false);
    expect(mockHc.readRecords.mock.calls[1][1]).toMatchObject({ pageToken: '2', timeRangeFilter: { startTime: state.from } });
    del('Steps', 'a');
    const third = await queryHealthConnectChanges('steps', { ...state, anchor: second.anchor }, 2);
    expect(third.deleted).toEqual(['a']);
    expect(third.samples.map((s) => s.id)).toEqual(['d']); // the mid-import write also arrives once through the token taken first
    expect(mockHc.readRecords).toHaveBeenCalledTimes(2);
  });
  it('falls back to a fresh full read when the token expired, without inferring deletions', async () => {
    put('Steps', steps('a', 20, 10));
    expired.add('Steps@old');
    const page = await queryHealthConnectChanges('steps', { ...fresh(), anchor: JSON.stringify({ t: 'Steps@old' }), samples: [{ id: 'gone', start: local(19, 9), end: local(19, 10), value: 5 }] }, 500);
    expect(page.deleted).toEqual([]);
    expect(page.samples.map((s) => s.id)).toEqual(['a']);
    expect(JSON.parse(page.anchor)).toEqual({ t: 'Steps@1' });
  });
  it('ignores edits older than the import window, like the bounded iOS anchored query', async () => {
    const state = { ...fresh(), anchor: JSON.stringify({ t: 'Steps@0' }) };
    put('Steps', { ...steps('old', 1, 5), startTime: new Date(2026, 0, 1, 9).toISOString(), endTime: new Date(2026, 0, 1, 10).toISOString() });
    expect((await queryHealthConnectChanges('steps', state, 500)).samples).toEqual([]);
  });
  it('totals steps per local day with aggregation, never by summing records, and removes a day when its last record goes', async () => {
    put('Steps', steps('phone', 25, 100)); put('Steps', steps('watch', 25, 100)); put('Steps', steps('mine', 25, 999, OWN_PACKAGE));
    stepTotal = 120; // Health Connect de-duplicates the phone and watch overlap
    const mem = memory(), upload = jest.fn(async () => {});
    expect(await sync('steps', mem, upload)).toMatchObject({ hasMore: false, knownSamples: 2 });
    expect(upload).toHaveBeenLastCalledWith('steps', expect.objectContaining({ daily: [{ date: '2026-10-25', value: 120 }] }));
    expect(mem.state().samples.map((s) => s.id).sort()).toEqual(['phone', 'watch']); // our own export is never imported
    del('Steps', 'phone'); del('Steps', 'watch');
    await sync('steps', mem, upload);
    expect(upload).toHaveBeenLastCalledWith('steps', expect.objectContaining({ daily: [], removeDaily: ['2026-10-25'] }));
  });
  it('aggregates local midnight to local midnight, which is 25 hours on the US DST change day', async () => {
    put('Steps', { metadata: meta('x'), startTime: new Date(2026, 10, 1, 9).toISOString(), endTime: new Date(2026, 10, 1, 10).toISOString(), count: 50 });
    stepTotal = 50;
    await reconcileHealth('steps', { journal: memory().journal, checkOwner: async () => {}, upload: async () => {}, now: new Date(2026, 10, 3) });
    // Calendar arithmetic, never 24h steps: in America/Chicago this is 05:00Z to 06:00Z the next day; in UTC it is 24 hours.
    expect(mockHc.aggregateRecord).toHaveBeenCalledWith({ recordType: 'Steps', timeRangeFilter: { operator: 'between', startTime: new Date(2026, 10, 1).toISOString(), endTime: new Date(2026, 10, 2).toISOString() } });
  });
  it('clamps to the default window when history access is missing and says so', async () => {
    historyFloor = startOfLocalDay(new Date(), 30).toISOString(); // 30 days before the first grant, which was today
    const result = await sync('steps', memory());
    expect(result.truncatedFrom).toBe(startOfLocalDay(new Date(), 29).toISOString());
    expect(mockHc.readRecords).toHaveBeenCalledTimes(2);
  });
});

describe('records', () => {
  it('normalizes sleep stages and overlapping sources with the iOS sleep rule', async () => {
    // Watch session with stages (awake in the middle) and a stage-less session from another app overlapping it.
    put('SleepSession', { metadata: meta('s1'), startTime: local(24, 23), endTime: local(25, 6), stages: [
      { startTime: local(24, 23), endTime: local(25, 2), stage: 4 }, { startTime: local(25, 2), endTime: local(25, 2, 30), stage: 1 },
      { startTime: local(25, 2, 30), endTime: local(25, 5), stage: 5 }, { startTime: local(25, 5), endTime: local(25, 6), stage: 3 }] });
    put('SleepSession', { metadata: meta('s2', 'com.tracker'), startTime: local(25, 4), endTime: local(25, 5, 30) });
    const mem = memory(), upload = jest.fn(async () => {});
    await sync('sleep', mem, upload);
    // The same night as HealthKit samples: core, awake, deep, in bed, plus an unspecified-asleep sample.
    const ios = summarizeSleep([[24, 23, 25, 2, 0, 3], [25, 2, 25, 2.5, 0, 2], [25, 2.5, 25, 5, 0, 4], [25, 5, 25, 6, 0, 0], [25, 4, 25, 5.5, 0, 1]].map(([d1, h1, d2, h2, , v], i) => ({
      uuid: String(i), startDate: new Date(2026, 9, d1, Math.floor(h1), (h1 % 1) * 60), endDate: new Date(2026, 9, d2, Math.floor(h2), (h2 % 1) * 60), value: v })));
    const daily = ios.map((d) => ({ date: d.date, value: d.value, window_start: d.windowStart, window_end: d.windowEnd }));
    expect(upload).toHaveBeenLastCalledWith('sleep', expect.objectContaining({ daily }));
    expect(daily[0].value).toBe(6 * 60); // 23:00-02:00 and 02:30-05:30; awake and out of bed never count
    // Editing the session drops its old stage intervals; deleting it removes the night only if nothing else remains.
    put('SleepSession', { metadata: meta('s1'), startTime: local(24, 23), endTime: local(25, 1) });
    await sync('sleep', mem, upload);
    expect(mem.state().samples.map((s) => s.id).sort()).toEqual(['s1#0', 's2#0']);
    del('SleepSession', 's1'); del('SleepSession', 's2');
    await sync('sleep', mem, upload);
    expect(upload).toHaveBeenLastCalledWith('sleep', expect.objectContaining({ daily: [], removeDaily: ['2026-10-25'] }));
  });
  it('reads weight in kg with the latest reading seeded, skipping readings this app wrote', async () => {
    put('Weight', { metadata: meta('w-old', 'com.scale'), time: local(1, 8), weight: { inKilograms: 80 } });
    put('Weight', { metadata: meta('w-new', 'com.scale'), time: local(27, 8), weight: { inKilograms: 79.5 } });
    put('Weight', { metadata: meta('w-mine', OWN_PACKAGE), time: local(28, 8), weight: { inKilograms: 70 } });
    expect(await readLatestWeight(NOW)).toEqual({ sampleId: 'w-new', measuredAt: local(27, 8), kg: 79.5 });
    const upload = jest.fn(async () => {});
    await sync('weight', memory(), upload);
    expect(upload).toHaveBeenLastCalledWith('weight', expect.objectContaining({ weight: [{ measured_at: local(1, 8), kg: 80 }, { measured_at: local(27, 8), kg: 79.5 }] }));
  });
  it('maps exercise sessions to the existing workout shape and activity names', async () => {
    put('ExerciseSession', { metadata: meta('11111111-1111-4111-8111-111111111111'), startTime: local(25, 7), endTime: local(25, 7, 30), exerciseType: 56 });
    put('ExerciseSession', { metadata: meta('22222222-2222-4222-8222-222222222222'), startTime: local(26, 7), endTime: local(26, 8), exerciseType: 6 });
    put('ExerciseSession', { metadata: meta('33333333-3333-4333-8333-333333333333', OWN_PACKAGE), startTime: local(26, 9), endTime: local(26, 10), exerciseType: 79 });
    const upload = jest.fn(async () => {});
    await sync('workouts', memory(), upload);
    expect(upload).toHaveBeenLastCalledWith('workouts', expect.objectContaining({ workouts: [
      { health_uuid: '11111111-1111-4111-8111-111111111111', activity_type: 'Running', started_at: local(25, 7), ended_at: local(25, 7, 30), timezone: TZ, duration_s: 1800, distance_m: null, energy_kcal: null },
      { health_uuid: '22222222-2222-4222-8222-222222222222', activity_type: 'Other', started_at: local(26, 7), ended_at: local(26, 8), timezone: TZ, duration_s: 3600, distance_m: null, energy_kcal: null },
    ] }));
  });
});
