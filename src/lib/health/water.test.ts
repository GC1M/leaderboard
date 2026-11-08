import { deriveChanges, reconcileHealth, type HealthChanges, type HealthJournal, type JournalState } from './changes';
import { APP_RECORD_KEY, EXCLUDE_OWN_EXPORTS } from './export-metadata';
import { loadHealthKit } from './healthkit';
import { HEALTH_METRICS, createHealthCoordinator, initialHealthState, type CoordinatorDependencies } from './coordinator';
import { uploadHealthChanges } from './upload';
import { mapWater, queryWaterChanges, waterPage, type HealthWater } from './water';
import { supabase } from '@/lib/supabase';

jest.mock('./healthkit', () => ({ HEALTH_TYPES: { water: 'HKQuantityTypeIdentifierDietaryWater' }, loadHealthKit: jest.fn() }));
jest.mock('./owner', () => ({ assertHealthOwner: jest.fn(async () => {}) }));
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: jest.fn(async () => ({ error: null })) } }));

const hw = (uuid: string, extra: Partial<HealthWater> = {}): HealthWater => ({
  uuid, startDate: new Date('2026-10-25T10:00:00Z'), quantity: 250, sourceRevision: { source: { name: 'WaterMinder' } }, ...extra,
});
const memory = (initial: JournalState | null = null) => {
  let state = initial;
  const journal: HealthJournal = { read: async () => (state ? JSON.parse(JSON.stringify(state)) : null), write: async (_m, s) => { state = JSON.parse(JSON.stringify(s)); } };
  return { journal, state: () => state };
};
// What the server holds after each upload: one row per Health UUID (apply_health_water upserts and tombstones).
const server = () => {
  const rows = new Map<string, number>();
  const upload = jest.fn(async (_m: string, c: HealthChanges) => {
    c.removeWater?.forEach((id) => rows.delete(id));
    c.water?.forEach((w) => rows.set(w.health_uuid, w.ml));
  });
  return { upload, total: () => [...rows.values()].reduce((a, b) => a + b, 0), rows };
};
const run = (journal: HealthJournal, upload: jest.Mock, query: jest.Mock) => reconcileHealth('water', { journal, checkOwner: async () => {}, upload, query });
const page = (samples: HealthWater[], deleted: string[] = []) => waterPage(samples, deleted, 'next', false, 'America/Chicago');

test('keeps source name and the zone it was drunk in; falls back to the device zone', () => {
  expect(mapWater(hw('a', { metadata: { HKTimeZone: 'Asia/Tokyo' } }), 'America/Chicago')).toEqual({
    health_uuid: 'a', consumed_at: '2026-10-25T10:00:00.000Z', timezone: 'Asia/Tokyo', ml: 250, source_name: 'WaterMinder',
  });
  expect(mapWater(hw('b', { sourceRevision: undefined }), 'America/Chicago')).toMatchObject({ timezone: 'America/Chicago', source_name: null });
});

test('a recorded 0 mL stays zero; invalid samples are skipped without failing the page', () => {
  expect(mapWater(hw('z', { quantity: 0 }), 'UTC')?.ml).toBe(0);
  const rows = page([hw('neg', { quantity: -1 }), hw('nan', { quantity: NaN }), hw('ok')]).water;
  expect(rows?.map((r) => r.health_uuid)).toEqual(['ok']);
});

test('our own exports are never imported back, and their deletions never tombstone', async () => {
  const own = hw('own', { metadata: { [APP_RECORD_KEY]: 'water:1' } });
  const p = page([own, hw('other')]);
  expect(p.water?.map((w) => w.health_uuid)).toEqual(['other']);
  expect((await deriveChanges('water', [], [], page([], ['own']))).removeWater).toEqual([]);
});

test('queries water in mL from the fixed lower bound, without our own exports, and uses the device zone', async () => {
  jest.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({ timeZone: 'America/Chicago' } as Intl.ResolvedDateTimeFormatOptions);
  const query = jest.fn(async () => ({ samples: [hw('a')], deletedSamples: [{ uuid: 'gone' }], newAnchor: 'n2' }));
  (loadHealthKit as jest.Mock).mockReturnValue({ queryQuantitySamplesWithAnchor: query });
  const p = await queryWaterChanges({ from: '2026-08-01T05:00:00.000Z', anchor: 'n1', samples: [] }, 2);
  expect(query).toHaveBeenCalledWith('HKQuantityTypeIdentifierDietaryWater', { limit: 2, anchor: 'n1', unit: 'mL', filter: { date: { startDate: new Date('2026-08-01T05:00:00.000Z') }, ...EXCLUDE_OWN_EXPORTS } });
  expect(p).toMatchObject({ deleted: ['gone'], anchor: 'n2', hasMore: true });
  expect(p.water?.[0].timezone).toBe('America/Chicago');
});

test('repeated import is idempotent, a correction does not double, a deletion tombstones', async () => {
  const mem = memory(), s = server();
  const query = jest.fn().mockResolvedValue(page([hw('a'), hw('b', { quantity: 500 })]));
  await run(mem.journal, s.upload, query);
  expect(s.total()).toBe(750);
  // Health re-delivers the same UUIDs (e.g. after Recheck): same rows, same total.
  await run(mem.journal, s.upload, query);
  expect(s.total()).toBe(750);
  // Correction: Health deletes 'a' and adds 'a2' with the fixed amount.
  query.mockResolvedValue(page([hw('a2', { quantity: 300 })], ['a']));
  const corrected = await run(mem.journal, s.upload, query);
  expect(s.total()).toBe(800);
  expect(corrected.written).toBe(2);
  // Deletion of a known sample tombstones it; an unknown UUID never deletes.
  query.mockResolvedValue(page([], ['b', 'unknown']));
  await run(mem.journal, s.upload, query);
  expect(s.upload.mock.calls.at(-1)?.[1].removeWater).toEqual(['b']);
  expect([...s.rows.keys()]).toEqual(['a2']);
  expect(mem.state()?.samples.map((x) => x.id)).toEqual(['a2']);
  expect(mem.state()?.anchor).toBe('next');
});

test('uploads through apply_health_water and skips empty changes', async () => {
  const base: HealthChanges = { daily: [], removeDaily: [], weight: [], removeWeight: [], water: [], removeWater: [] };
  await uploadHealthChanges('u', 'd', 'water', base);
  expect(supabase.rpc).not.toHaveBeenCalled();
  const w = mapWater(hw('a'), 'UTC')!;
  await uploadHealthChanges('u', 'd', 'water', { ...base, water: [w], removeWater: ['x'] });
  expect(supabase.rpc).toHaveBeenCalledWith('apply_health_water', { p_owner: 'u', p_device: 'd', p_samples: [w], p_remove: ['x'] });
});

test('coordinator includes water, and missing water access leaves the other metrics syncing', async () => {
  expect(HEALTH_METRICS).toContain('water');
  expect(initialHealthState().metrics.water.status).toBe('idle');
  const deps: CoordinatorDependencies = {
    checkAccount: async () => {}, load: async () => ({ connected: true, lastSuccess: {} }), save: async () => {}, requestAccess: async () => {},
    access: async (m) => (m === 'water' ? 'not-asked' : 'asked'),
    reconcile: jest.fn(async () => ({ hasMore: false, written: 1, knownSamples: 1 })), recheck: async () => {}, deleteImports: async () => {},
  };
  const c = createHealthCoordinator(deps);
  await c.initialize(); await c.sync();
  expect(c.getSnapshot().metrics.water.status).toBe('needs-permission');
  expect(c.getSnapshot().metrics.steps.status).toBe('synced');
  expect(deps.reconcile).not.toHaveBeenCalledWith('water', expect.anything());
});
