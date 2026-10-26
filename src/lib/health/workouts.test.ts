import { deriveChanges, reconcileHealth, type HealthJournal, type JournalState } from './changes';
import { APP_RECORD_KEY } from './export-metadata';
import { activityName, mapWorkout, workoutPage, type HealthWorkout } from './workouts';
import { createHealthCoordinator, type CoordinatorDependencies } from './coordinator';
import { uploadHealthChanges } from './upload';
import { supabase } from '@/lib/supabase';

jest.mock('./healthkit', () => ({ HEALTH_TYPES: {}, loadHealthKit: jest.fn() }));
jest.mock('./owner', () => ({ assertHealthOwner: jest.fn(async () => {}) }));
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: jest.fn(async () => ({ error: null })) } }));

const hw = (uuid: string, extra: Partial<HealthWorkout> = {}): HealthWorkout => ({
  uuid, startDate: new Date('2026-10-25T10:00:00Z'), endDate: new Date('2026-10-25T10:30:00Z'), workoutActivityType: 37,
  duration: { unit: 'min', quantity: 30 }, totalDistance: { unit: 'km', quantity: 5 }, totalEnergyBurned: { unit: 'kcal', quantity: 300 }, ...extra,
});
const memory = (initial: JournalState | null = null) => {
  let state = initial;
  const journal: HealthJournal = { read: async () => (state ? JSON.parse(JSON.stringify(state)) : null), write: async (_m, s) => { state = JSON.parse(JSON.stringify(s)); } };
  return { journal, state: () => state };
};

test('maps activity type, canonical units and timestamps', () => {
  expect(mapWorkout(hw('a'), 'UTC')).toEqual({
    health_uuid: 'a', activity_type: 'Running', started_at: '2026-10-25T10:00:00.000Z', ended_at: '2026-10-25T10:30:00.000Z',
    timezone: 'UTC', duration_s: 1800, distance_m: 5000, energy_kcal: 300,
  });
  expect(mapWorkout(hw('b', { totalEnergyBurned: { unit: 'kJ', quantity: 4.184 } }), 'UTC')?.energy_kcal).toBeCloseTo(1);
  expect(activityName(50)).toBe('Traditional Strength Training');
});

test('missing distance and energy stay null, a recorded zero stays zero, unknown types import as Other', () => {
  const m = mapWorkout(hw('a', { totalDistance: undefined, totalEnergyBurned: { unit: 'kcal', quantity: 0 }, workoutActivityType: 9999 }), 'UTC');
  expect(m).toMatchObject({ distance_m: null, energy_kcal: 0, activity_type: 'Other' });
  // An unknown unit is missing, never guessed.
  expect(mapWorkout(hw('a', { totalDistance: { unit: 'parsec', quantity: 1 } }), 'UTC')?.distance_m).toBeNull();
});

test('duration falls back to the session length; invalid dates are skipped without failing the page', () => {
  expect(mapWorkout(hw('a', { duration: undefined }), 'UTC')?.duration_s).toBe(1800);
  const bad = hw('bad', { endDate: new Date('2026-10-25T09:00:00Z') });
  expect(workoutPage([bad, hw('ok')], [], 'next', false, 'UTC').workouts?.map((w) => w.health_uuid)).toEqual(['ok']);
});

test('our own exports are never imported back; overlapping sessions from other sources are both kept', () => {
  const own = hw('own', { metadata: { [APP_RECORD_KEY]: 'workout:1' } });
  const page = workoutPage([own, hw('watch'), hw('phone')], [], 'next', false, 'UTC');
  expect(page.workouts?.map((w) => w.health_uuid)).toEqual(['watch', 'phone']);
  expect(page.samples.map((s) => s.id)).toEqual(['watch', 'phone']);
});

test('a full native page keeps paging even when own exports were filtered out', () => {
  const own = hw('own', { metadata: { [APP_RECORD_KEY]: 'workout:1' } });
  expect(workoutPage([own], [], 'next', true, 'UTC').hasMore).toBe(true);
});

test('tombstones delete only workouts this journal imported; an empty page never deletes', async () => {
  const known = { id: 'a', start: '2026-10-25T10:00:00.000Z', end: '2026-10-25T10:30:00.000Z', value: 1800 };
  const page = (deleted: string[]) => ({ samples: [], deleted, anchor: 'n', hasMore: false });
  const c = await deriveChanges('workouts', [known], [], page(['a', 'unknown']));
  expect(c.removeWorkouts).toEqual(['a']);
  expect((await deriveChanges('workouts', [known], [known], page([]))).removeWorkouts).toBeUndefined();
});

test('import is journaled, uploaded once per page, and a retry replays the same payload', async () => {
  const mem = memory();
  const query = jest.fn().mockResolvedValue(workoutPage([hw('a')], [], 'a1', false, 'UTC'));
  const upload = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
  const options = { journal: mem.journal, checkOwner: async () => {}, upload, query };
  await expect(reconcileHealth('workouts', options)).rejects.toThrow('offline');
  expect(mem.state()?.pending?.changes.workouts).toHaveLength(1);
  const result = await reconcileHealth('workouts', options);
  expect(query).toHaveBeenCalledTimes(1);
  expect(upload.mock.calls[1][1]).toEqual(upload.mock.calls[0][1]);
  expect(result).toEqual({ hasMore: false, written: 1, knownSamples: 1 });
  expect(mem.state()?.anchor).toBe('a1');
});

test('a deleted workout is uploaded as a tombstone and advances the anchor', async () => {
  const mem = memory({ from: '2026-07-01T00:00:00.000Z', anchor: 'a1', samples: [{ id: 'a', start: '2026-10-25T10:00:00.000Z', end: '2026-10-25T10:30:00.000Z', value: 1800, dates: ['2026-10-25'] }] });
  const upload = jest.fn().mockResolvedValue(undefined);
  const query = jest.fn().mockResolvedValue(workoutPage([], ['a'], 'a2', false, 'UTC'));
  await reconcileHealth('workouts', { journal: mem.journal, checkOwner: async () => {}, upload, query });
  expect(upload.mock.calls[0][1].removeWorkouts).toEqual(['a']);
  expect(mem.state()).toMatchObject({ anchor: 'a2', samples: [] });
});

test('upload uses the workouts function with owner and device, and skips empty changes', async () => {
  const base = { daily: [], removeDaily: [], weight: [], removeWeight: [] };
  await uploadHealthChanges('u', 'd', 'workouts', base);
  expect(supabase.rpc).not.toHaveBeenCalled();
  await uploadHealthChanges('u', 'd', 'workouts', { ...base, removeWorkouts: ['a'] });
  expect(supabase.rpc).toHaveBeenCalledWith('apply_health_workouts', { p_owner: 'u', p_device: 'd', p_workouts: [], p_remove: ['a'] });
});

test('denied workout access leaves the other metrics importing', async () => {
  const deps: CoordinatorDependencies = {
    checkAccount: async () => {}, load: async () => ({ connected: true, lastSuccess: {} }), save: async () => {}, requestAccess: async () => {},
    access: async (m) => (m === 'workouts' ? 'not-asked' : 'asked'),
    reconcile: jest.fn(async () => ({ hasMore: false, written: 1, knownSamples: 1 })), recheck: async () => {}, deleteImports: async () => {},
  };
  const c = createHealthCoordinator(deps);
  await c.initialize(); await c.sync();
  expect(c.getSnapshot().metrics.workouts.status).toBe('needs-permission');
  expect(c.getSnapshot().metrics.steps.status).toBe('synced');
  (deps.reconcile as jest.Mock).mockImplementation(async (m) => { if (m === 'workouts') throw new Error('boom'); return { hasMore: false, written: 0, knownSamples: 1 }; });
  (deps as { access: unknown }).access = async () => 'asked';
  await c.sync();
  expect(c.getSnapshot().metrics.workouts).toMatchObject({ status: 'error', error: 'boom' });
  expect(c.getSnapshot().metrics.weight.status).toBe('unchanged');
});
