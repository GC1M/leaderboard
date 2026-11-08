import { Platform } from 'react-native';

import { CHANGE_PAGE_SIZE, reconcileHealth, type HealthJournal, type JournalState } from './changes';
import { createHealthCoordinator, type CoordinatorDependencies } from './coordinator';
import { startOfLocalDay } from './dates';
import { OWN_PACKAGE, queryHealthConnectChanges, resetHealthConnectCache } from './health-connect';
import { getHealthAccess } from './healthkit';
import { readLatestWeight } from './weight';

jest.mock('@/lib/metrics', () => ({ getMyRecentSteps: jest.fn(), upsertDailyMetrics: jest.fn() }));

// QA (#64). Same in-memory Health Connect as health-connect.test.ts, plus a one-shot transient read failure.
type Rec = { metadata: { id: string; dataOrigin: string }; startTime?: string; endTime?: string; time?: string; [k: string]: unknown };
const store: Record<string, Rec[]> = {};
let log: { type: string; record?: Rec; id: string }[] = [];
const grants = new Set<string>();
const expired = new Set<string>();
let sdk = 3, historyFloor: string | null = null, stepTotal = 0, transientFailures = 0;
const at = (r: Rec) => r.startTime ?? r.time!;
const mockHc = {
  getSdkStatus: jest.fn(async () => sdk),
  initialize: jest.fn(async () => true),
  getGrantedPermissions: jest.fn(async () => [...grants].map((k) => ({ accessType: k.split(':')[0], recordType: k.split(':')[1] }))),
  requestPermission: jest.fn(async (perms: { accessType: string; recordType: string }[]) => perms),
  readRecords: jest.fn(async (type: string, o: { timeRangeFilter: { startTime: string; endTime?: string }; pageSize: number; pageToken?: string; ascendingOrder: boolean }) => {
    if (transientFailures > 0) { transientFailures--; throw Object.assign(new Error('android.os.RemoteException: binder transaction failed'), { code: 'UNDERLYING_ERROR' }); }
    if (!grants.has(`read:${type}`)) throw new Error('java.lang.SecurityException: Caller doesn\'t have permission to read');
    if (historyFloor && o.timeRangeFilter.startTime < historyFloor) throw new Error('Reading data older than allowed');
    const rows = (store[type] ?? []).filter((r) => (r.endTime ?? r.time!) >= o.timeRangeFilter.startTime && (!o.timeRangeFilter.endTime || at(r) <= o.timeRangeFilter.endTime))
      .sort((a, b) => (o.ascendingOrder ? 1 : -1) * at(a).localeCompare(at(b)));
    const offset = Number(o.pageToken ?? 0), next = offset + o.pageSize;
    return { records: rows.slice(offset, next), pageToken: next < rows.length ? String(next) : undefined };
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
// Relative to the real clock, because readSince's 29-day floor uses new Date().
const NOW = new Date();
const daysAgo = (d: number, h = 9, m = 0) => { const x = startOfLocalDay(NOW, d); x.setHours(h, m); return x.toISOString(); };
const drink = (id: string, d: number, ml: number, origin?: string, minute = 0): Rec => ({ metadata: meta(id, origin), startTime: daysAgo(d, 9, minute), endTime: daysAgo(d, 9, minute + 1), volume: { inMilliliters: ml } });
const steps = (id: string, d: number, count: number): Rec => ({ metadata: meta(id), startTime: daysAgo(d, 9), endTime: daysAgo(d, 10), count });
function memory(initial: JournalState | null = null) {
  let state = initial;
  const journal: HealthJournal = { read: async () => (state ? JSON.parse(JSON.stringify(state)) : null), write: async (_m, s) => { state = JSON.parse(JSON.stringify(s)); } };
  return { journal, state: () => state! };
}
const sync = (metric: Parameters<typeof reconcileHealth>[0], mem: ReturnType<typeof memory>, upload = jest.fn(async () => {})) =>
  reconcileHealth(metric, { journal: mem.journal, checkOwner: async () => {}, upload, now: NOW });
const uploadedWater = (upload: jest.Mock) => upload.mock.calls.flatMap((c) => ((c as unknown[])[1] as { water?: { health_uuid: string }[] }).water ?? []).map((w) => w.health_uuid);

function coordinator(reconcile: CoordinatorDependencies['reconcile']) {
  return createHealthCoordinator({ checkAccount: async () => {}, load: async () => ({ connected: true, lastSuccess: {} }), save: async () => {},
    requestAccess: async () => {}, access: getHealthAccess, reconcile, recheck: async () => {}, deleteImports: async () => {} });
}

beforeEach(() => {
  jest.replaceProperty(Platform, 'OS', 'android');
  resetHealthConnectCache();
  for (const k of Object.keys(store)) delete store[k];
  log = []; grants.clear(); expired.clear();
  sdk = 3; historyFloor = null; stepTotal = 0; transientFailures = 0;
  jest.clearAllMocks();
});

describe('QA suspected bugs', () => {
  // 1c
  it('1c: a transient read error on the first history read does not truncate the import to 29 days', async () => {
    grants.add('read:Hydration');
    put('Hydration', drink('old', 60, 250));
    put('Hydration', drink('new', 3, 300));
    transientFailures = 1; // one RemoteException, history access is NOT missing
    const mem = memory(), upload = jest.fn(async () => {});
    // The failed read is an error the coordinator retries, never a silent cut to the default window.
    await expect(sync('water', mem, upload)).rejects.toThrow('RemoteException');
    const result = await sync('water', mem, upload);
    expect({ truncatedFrom: result.truncatedFrom, imported: uploadedWater(upload).sort() }).toEqual({ truncatedFrom: undefined, imported: ['new', 'old'] });
  });

  // 1d
  it('1d: granting history access later imports older data on the next normal sync, and drops the truncation note', async () => {
    grants.add('read:Hydration');
    historyFloor = startOfLocalDay(new Date(), 30).toISOString(); // no history access yet
    put('Hydration', drink('old', 60, 250));
    put('Hydration', drink('new', 3, 300));
    const mem = memory(), upload = jest.fn(async () => {});
    const first = await sync('water', mem, upload);
    expect(first.truncatedFrom).toBeDefined();
    expect(uploadedWater(upload)).toEqual(['new']);
    historyFloor = null; // user allows "Access past data" in Health Connect
    const second = await sync('water', mem, upload);
    // The fresh full read re-sends 'new' like "Recheck Health History" does; the server upsert by health_uuid is idempotent.
    expect({ truncatedFrom: second.truncatedFrom, imported: [...new Set(uploadedWater(upload))].sort() }).toEqual({ truncatedFrom: undefined, imported: ['new', 'old'] });
  });

  it('1d: a deletion made while truncated still reaches the server when history access is granted', async () => {
    grants.add('read:Hydration');
    historyFloor = startOfLocalDay(new Date(), 30).toISOString();
    put('Hydration', drink('old', 60, 250)); put('Hydration', drink('new', 3, 300)); put('Hydration', drink('gone', 2, 200));
    const mem = memory(), upload = jest.fn(async () => {});
    await sync('water', mem, upload);
    del('Hydration', 'gone'); // deleted in Health Connect before the next sync
    historyFloor = null;
    await sync('water', mem, upload);
    expect(upload).toHaveBeenLastCalledWith('water', expect.objectContaining({ removeWater: ['gone'] }));
    expect(mem.state().samples.map((x) => x.id)).not.toContain('gone');
  });
  it('weight: the latest-reading scan stops after a bounded number of pages of our own readings', async () => {
    grants.add('read:Weight');
    for (let i = 0; i < 2000; i++) put('Weight', { metadata: meta(`mine-${i}`, OWN_PACKAGE), time: new Date(NOW.getTime() - (i + 1) * 3600000).toISOString(), weight: { inKilograms: 79 } });
    expect(await readLatestWeight(NOW)).toBeNull();
    expect(mockHc.readRecords.mock.calls.length).toBeLessThanOrEqual(10);
  });
  it('1d workaround: "Recheck Health History" (anchor reset like resetHealthAnchors) does import the older data', async () => {
    grants.add('read:Hydration');
    historyFloor = startOfLocalDay(new Date(), 30).toISOString();
    put('Hydration', drink('old', 60, 250)); put('Hydration', drink('new', 3, 300));
    const mem = memory(), upload = jest.fn(async () => {});
    await sync('water', mem, upload);
    historyFloor = null;
    const reset = memory({ ...mem.state(), anchor: undefined });
    const result = await sync('water', reset, upload);
    expect({ truncatedFrom: result.truncatedFrom, imported: uploadedWater(upload).sort() }).toEqual({ truncatedFrom: undefined, imported: ['new', 'new', 'old'] });
  });

  // 1e
  it(`1e: a first history page of ${CHANGE_PAGE_SIZE} own records still advances, so a later foreign record is imported`, async () => {
    grants.add('read:Hydration');
    // >= 500 water entries logged in the app and exported to Health Connect over the last ~85 days (6 a day).
    for (let i = 0; i < CHANGE_PAGE_SIZE; i++) put('Hydration', drink(`mine-${i}`, 85 - Math.floor(i / 6), 250, OWN_PACKAGE, (i % 6) * 5));
    put('Hydration', drink('foreign', 1, 400));
    const mem = memory(), upload = jest.fn(async () => {});
    for (let i = 0; i < 5; i++) await sync('water', mem, upload); // the coordinator re-runs while hasMore ('importing')
    const pageStarts = mockHc.readRecords.mock.calls.map((c) => (c[1] as { pageToken?: string }).pageToken ?? 'page1');
    expect({ anchorSet: !!mem.state().anchor, imported: uploadedWater(upload), firstPageReads: pageStarts.filter((p) => p === 'page1').length })
      .toEqual({ anchorSet: true, imported: ['foreign'], firstPageReads: 1 });
  });
});

describe('QA permissions and availability', () => {
  const reconcileFn = () => jest.fn(async () => ({ hasMore: false, knownSamples: 1, written: 1 }));
  it('all reads denied: every metric (water included) needs permission and nothing is read', async () => {
    const reconcile = reconcileFn(), c = coordinator(reconcile);
    await c.initialize(); await c.sync();
    expect(reconcile).not.toHaveBeenCalled();
    for (const m of ['steps', 'sleep', 'weight', 'workouts', 'water'] as const) expect(c.getSnapshot().metrics[m].status).toBe('needs-permission');
  });
  it('partial grant (water + sleep only) syncs just those', async () => {
    grants.add('read:Hydration').add('read:SleepSession');
    const reconcile = reconcileFn(), c = coordinator(reconcile);
    await c.initialize(); await c.sync();
    expect(reconcile.mock.calls.map((x) => (x as unknown[])[0]).sort()).toEqual(['sleep', 'water']);
    expect(c.getSnapshot().metrics.steps.status).toBe('needs-permission');
  });
  it('Health Connect missing/needs update (sdk 2) or unsupported (sdk 1): every metric unavailable', async () => {
    for (const s of [1, 2]) {
      resetHealthConnectCache(); sdk = s; grants.add('read:Hydration');
      const reconcile = reconcileFn(), c = coordinator(reconcile);
      await c.initialize(); await c.sync();
      expect(reconcile).not.toHaveBeenCalled();
      expect(c.getSnapshot().metrics.water.status).toBe('unavailable');
    }
  });
  it('revoking water between syncs stops only water; re-granting resumes it from the changes token without losing entries', async () => {
    grants.add('read:Hydration').add('read:Steps');
    put('Hydration', drink('h1', 3, 250)); put('Steps', steps('s1', 3, 100)); stepTotal = 100;
    const mem = { water: memory(), steps: memory() } as Record<string, ReturnType<typeof memory>>;
    const upload = jest.fn(async () => {});
    const c = coordinator((m, checkOwner) => reconcileHealth(m, { journal: mem[m]?.journal ?? memory().journal, checkOwner, upload, now: NOW }));
    await c.initialize(); await c.sync();
    expect(c.getSnapshot().metrics.water.status).toBe('synced');
    grants.delete('read:Hydration');
    put('Hydration', drink('h2', 1, 300)); // logged in another app while access was off
    await c.sync();
    expect(c.getSnapshot().metrics.water.status).toBe('needs-permission');
    expect(c.getSnapshot().metrics.steps.status).not.toBe('needs-permission');
    grants.add('read:Hydration');
    await c.sync();
    expect(uploadedWater(upload).sort()).toEqual(['h1', 'h2']);
  });
  it('history access missing: the coordinator snapshot carries the truncation date for water', async () => {
    grants.add('read:Hydration');
    historyFloor = startOfLocalDay(new Date(), 30).toISOString();
    put('Hydration', drink('h1', 3, 250));
    const c = coordinator((m, checkOwner) => reconcileHealth(m, { journal: memory().journal, checkOwner, upload: async () => {}, now: NOW }));
    await c.initialize(); await c.sync();
    expect(c.getSnapshot().metrics.water.truncatedFrom).toBe(startOfLocalDay(new Date(), 29).toISOString());
  });
  it('read access revoked mid-history (page 2) surfaces an error and keeps the page cursor; re-grant continues', async () => {
    grants.add('read:Hydration');
    for (let i = 0; i < 3; i++) put('Hydration', drink(`h${i}`, 10 - i, 100));
    const state: JournalState = { from: startOfLocalDay(NOW, 89).toISOString(), samples: [] };
    const first = await queryHealthConnectChanges('water', state, 2);
    grants.delete('read:Hydration');
    await expect(queryHealthConnectChanges('water', { ...state, anchor: first.anchor }, 2)).rejects.toThrow(/SecurityException/);
    grants.add('read:Hydration');
    const second = await queryHealthConnectChanges('water', { ...state, anchor: first.anchor }, 2);
    expect(second.samples.map((s) => s.id)).toEqual(['h2']);
  });
});

describe('QA adapter behavior', () => {
  it('sleep: awake-in-bed (7) and unknown (0) stages are not sleep; REM, deep, light, sleeping are', async () => {
    grants.add('read:SleepSession');
    put('SleepSession', { metadata: meta('s'), startTime: daysAgo(2, 22), endTime: daysAgo(1, 6), stages: [
      { startTime: daysAgo(2, 22), endTime: daysAgo(2, 23), stage: 7 }, { startTime: daysAgo(2, 23), endTime: daysAgo(1, 1), stage: 2 },
      { startTime: daysAgo(1, 1), endTime: daysAgo(1, 2), stage: 6 }, { startTime: daysAgo(1, 2), endTime: daysAgo(1, 3), stage: 0 },
      { startTime: daysAgo(1, 3), endTime: daysAgo(1, 6), stage: 5 }] });
    const page = await queryHealthConnectChanges('sleep', { from: startOfLocalDay(NOW, 91).toISOString(), samples: [] }, 500);
    const minutes = page.samples.reduce((n, s) => n + (Date.parse(s.end) - Date.parse(s.start)) / 60000, 0);
    expect(minutes).toBe(6 * 60);
  });
  it('sleep: a session deleted through the changes token removes all of its stage intervals and the night', async () => {
    grants.add('read:SleepSession');
    put('SleepSession', { metadata: meta('s'), startTime: daysAgo(2, 23), endTime: daysAgo(1, 6), stages: [
      { startTime: daysAgo(2, 23), endTime: daysAgo(1, 2), stage: 4 }, { startTime: daysAgo(1, 3), endTime: daysAgo(1, 6), stage: 5 }] });
    const mem = memory(), upload = jest.fn(async () => {});
    await sync('sleep', mem, upload);
    expect(mem.state().samples.map((s) => s.id).sort()).toEqual(['s#0', 's#1']);
    del('SleepSession', 's');
    await sync('sleep', mem, upload);
    expect(mem.state().samples).toEqual([]);
    expect((upload.mock.lastCall as unknown[])[1]).toMatchObject({ daily: [], removeDaily: [expect.any(String)] });
  });
  it('water: deletion via changes token for an entry imported before an expired token is not lost after the fresh re-read', async () => {
    grants.add('read:Hydration');
    put('Hydration', drink('h1', 3, 250));
    const mem = memory(), upload = jest.fn(async () => {});
    await sync('water', mem, upload);
    expired.add(JSON.parse(mem.state().anchor!).t);
    del('Hydration', 'h1');
    await sync('water', mem, upload);
    // Expired token: fresh read never infers deletions (documented). The deleted entry stays imported.
    expect(mem.state().samples.map((s) => s.id)).toEqual(['h1']);
  });
  it('water: getChanges upsert of an own record and deletions of own records never produce uploads', async () => {
    grants.add('read:Hydration');
    put('Hydration', drink('h1', 3, 250));
    const mem = memory(), upload = jest.fn(async () => {});
    await sync('water', mem, upload);
    upload.mockClear();
    put('Hydration', drink('mine', 1, 500, OWN_PACKAGE)); del('Hydration', 'mine');
    await sync('water', mem, upload);
    const calls = upload.mock.calls.map((c) => (c as unknown[])[1] as { water?: unknown[]; removeWater?: unknown[] });
    expect(calls.every((c) => !c.water?.length && !c.removeWater?.length)).toBe(true);
  });
  it('weight: the latest reading from another app is found even when this app wrote more than 50 newer readings', async () => {
    grants.add('read:Weight');
    put('Weight', { metadata: meta('scale', 'com.scale'), time: daysAgo(20, 7), weight: { inKilograms: 80 } });
    for (let i = 0; i < 60; i++) put('Weight', { metadata: meta(`mine-${i}`, OWN_PACKAGE), time: daysAgo(19 - Math.floor(i / 4), 8 + (i % 4)), weight: { inKilograms: 79 } });
    expect(await readLatestWeight(NOW)).toEqual({ sampleId: 'scale', measuredAt: daysAgo(20, 7), kg: 80 });
  });
  it('steps: day boundaries follow the device zone (local midnight to local midnight)', async () => {
    grants.add('read:Steps');
    put('Steps', { metadata: meta('late'), startTime: daysAgo(2, 23, 30), endTime: daysAgo(2, 23, 59), count: 10 }); stepTotal = 10;
    await sync('steps', memory());
    const filter = (mockHc.aggregateRecord.mock.calls[0] as unknown as [{ timeRangeFilter: { startTime: string; endTime: string } }])[0].timeRangeFilter;
    expect(filter).toEqual({ operator: 'between', startTime: startOfLocalDay(NOW, 2).toISOString(), endTime: startOfLocalDay(NOW, 1).toISOString() });
  });
});
