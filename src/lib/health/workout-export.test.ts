import { isOwnExport } from './export-metadata';
import { createExportQueue, exportWriters, type ExportEntry } from './export-queue';
import { resetHealthKitCache } from './healthkit';
import { activityCode, canExportWorkout, WORKOUT_KIND, workoutPayload } from './workout-export';

const hk = {
  isHealthDataAvailable: jest.fn(() => true),
  saveWorkoutSample: jest.fn(async (..._args: unknown[]) => ({ uuid: 'w-uuid' })),
  deleteObjects: jest.fn(async () => 1),
};
beforeAll(() => jest.doMock('@kingstinct/react-native-healthkit', () => hk));
afterAll(() => jest.dontMock('@kingstinct/react-native-healthkit'));
beforeEach(() => { jest.clearAllMocks(); resetHealthKitCache(); });

const start = new Date('2026-10-26T23:00:00.000Z');
const end = new Date('2026-10-27T00:00:00.000Z');
const base = { activityType: 'Strength', startedAt: start, endedAt: end };
const entry = (payload: unknown, version = 5): ExportEntry => ({ kind: WORKOUT_KIND, recordId: 'w1', op: 'save', payload, version, status: 'pending', attempts: 0 });
const writer = () => exportWriters[WORKOUT_KIND]!;

describe('payload', () => {
  it('carries the activity and real start and end, and nothing else when nothing else was recorded', () => {
    expect(workoutPayload({ ...base, activityType: '  Strength ' })).toEqual({ activity: 'Strength', start: start.toISOString(), end: end.toISOString() });
  });

  it('keeps recorded distance and energy, and treats missing or zero as absent', () => {
    expect(workoutPayload({ ...base, distanceM: 5000, energyKcal: 300 })).toMatchObject({ distanceM: 5000, energyKcal: 300 });
    for (const empty of [null, undefined, 0, NaN]) {
      const p = workoutPayload({ ...base, distanceM: empty, energyKcal: empty });
      expect(p).not.toHaveProperty('distanceM');
      expect(p).not.toHaveProperty('energyKcal');
    }
  });

  it('never carries exercises, sets, reps, load or notes, even if the caller passes the whole saved input', () => {
    const input = { ...base, notes: 'felt strong', exercises: [{ exerciseId: 'e1', sets: [{ reps: 5, loadKg: 100 }] }] };
    expect(Object.keys(workoutPayload(input)).sort()).toEqual(['activity', 'end', 'start']);
    expect(JSON.stringify(workoutPayload(input))).not.toMatch(/felt strong|reps|loadKg|e1/);
  });

  it('rejects an end before the start or an invalid date', () => {
    expect(() => workoutPayload({ ...base, endedAt: new Date(start.getTime() - 1) })).toThrow();
    expect(() => workoutPayload({ ...base, startedAt: new Date('nope') })).toThrow();
  });

  it('only app-created workouts are exportable, never imported Health workouts', () => {
    expect(canExportWorkout('manual')).toBe(true);
    expect(canExportWorkout('import')).toBe(true);
    expect(canExportWorkout('healthkit')).toBe(false);
  });
});

describe('activity type', () => {
  it('maps the importer names and common names; anything else is Other', () => {
    expect(activityCode('Running')).toBe(37);
    expect(activityCode('traditional strength training')).toBe(50);
    expect(activityCode('Strength')).toBe(50);
    expect(activityCode('Mind and Body')).toBe(29);
    expect(activityCode('High-Intensity Interval Training')).toBe(63);
    expect(activityCode('Spartan obstacle race')).toBe(3000);
    expect(activityCode('')).toBe(3000);
  });
});

describe('writer', () => {
  it('is registered under the workout kind', () => {
    expect(writer().writeType).toBe('HKWorkoutTypeIdentifier');
  });

  it('saves the real start and end with our sync metadata, and no associated samples', async () => {
    const p = workoutPayload(base);
    await expect(writer().save(entry(p))).resolves.toBe('w-uuid');
    expect(hk.saveWorkoutSample).toHaveBeenCalledWith(50, [], start, end, undefined, {
      HKMetadataKeySyncIdentifier: 'leaderboard:workout:w1', HKMetadataKeySyncVersion: 5, LeaderboardRecordId: 'workout:w1',
    });
  });

  it('passes distance in meters and energy in kcal only when they were recorded', async () => {
    await writer().save(entry(workoutPayload({ ...base, activityType: 'Running', distanceM: 5000 })));
    expect(hk.saveWorkoutSample.mock.calls[0][4]).toEqual({ distance: 5000, energyBurned: undefined });
    await writer().save(entry(workoutPayload(base)));
    expect(hk.saveWorkoutSample.mock.calls[1][4]).toBeUndefined();
  });

  it('tags the sample so the Health workout importer treats it as our own export', async () => {
    await writer().save(entry(workoutPayload(base)));
    expect(isOwnExport(hk.saveWorkoutSample.mock.calls[0][5] as Record<string, unknown>)).toBe(true);
  });

  it('removes only this workout by its metadata', async () => {
    await writer().remove({ ...entry(null), op: 'delete' });
    expect(hk.deleteObjects).toHaveBeenCalledWith('HKWorkoutTypeIdentifier', { metadata: { withMetadataKey: 'LeaderboardRecordId', operatorType: 4, value: 'workout:w1' } });
  });

  it('fails without a native build, so the queue keeps the entry', async () => {
    hk.isHealthDataAvailable.mockReturnValueOnce(false);
    await expect(writer().save(entry(workoutPayload(base)))).rejects.toThrow('native iPhone build');
    expect(hk.saveWorkoutSample).not.toHaveBeenCalled();
  });
});

describe('through the shared queue and mapping', () => {
  function setup(access: 'granted' | 'denied' = 'granted', rows = new Map<string, ExportEntry>()) {
    const server = new Map<string, { uuid: string | null; version: number }>();
    const deps = {
      checkAccount: async () => {},
      store: { list: async () => [...rows.values()], put: async (e: ExportEntry) => { rows.set(e.recordId, { ...e }); }, remove: async (_k: string, id: string) => { rows.delete(id); }, clear: async () => rows.clear() },
      mapping: {
        get: jest.fn(async (k: string, id: string) => (server.has(`${k}:${id}`) ? { syncVersion: server.get(`${k}:${id}`)!.version } : null)),
        record: jest.fn(async (k: string, id: string, uuid: string | null, version: number) => { server.set(`${k}:${id}`, { uuid, version }); }),
        remove: jest.fn(async (k: string, id: string) => { server.delete(`${k}:${id}`); }),
      },
      writers: exportWriters,
      access: () => access,
    };
    return { q: createExportQueue(deps), rows, server, deps };
  }

  it('records the Health workout uuid in the shared mapping under workout:<id>', async () => {
    const { q, server } = setup();
    await q.initialize();
    await q.enqueue(WORKOUT_KIND, 'w1', 'save', workoutPayload(base), 10);
    expect(server.get('workout:w1')).toEqual({ uuid: 'w-uuid', version: 10 });
  });

  it('an edit re-saves under the same identifier with a higher version', async () => {
    const { q, server } = setup();
    await q.initialize();
    await q.enqueue(WORKOUT_KIND, 'w1', 'save', workoutPayload(base), 10);
    await q.enqueue(WORKOUT_KIND, 'w1', 'save', workoutPayload({ ...base, activityType: 'Running' }), 11);
    const calls = hk.saveWorkoutSample.mock.calls;
    expect(calls.map((c) => [c[0], (c[5] as Record<string, unknown>).HKMetadataKeySyncVersion, (c[5] as Record<string, unknown>).HKMetadataKeySyncIdentifier])).toEqual([
      [50, 10, 'leaderboard:workout:w1'], [37, 11, 'leaderboard:workout:w1'],
    ]);
    expect(server.get('workout:w1')?.version).toBe(11);
  });

  it('a failed write is kept and a retry writes once more with the same identifier and version', async () => {
    const { q, rows } = setup();
    await q.initialize();
    hk.saveWorkoutSample.mockRejectedValueOnce(new Error('HealthKit unavailable'));
    await q.enqueue(WORKOUT_KIND, 'w1', 'save', workoutPayload(base), 10);
    expect(rows.get('w1')).toMatchObject({ status: 'failed', reason: 'error', version: 10 });
    await q.process();
    expect(rows.get('w1')).toMatchObject({ status: 'success', version: 10 });
    expect(hk.saveWorkoutSample).toHaveBeenCalledTimes(2);
    expect(hk.saveWorkoutSample.mock.calls[0][5]).toEqual(hk.saveWorkoutSample.mock.calls[1][5]);
  });

  it('a delete removes the Health workout, its mapping and the queue entry; repeating it is harmless', async () => {
    const { q, rows, server } = setup();
    await q.initialize();
    await q.enqueue(WORKOUT_KIND, 'w1', 'save', workoutPayload(base), 10);
    await q.enqueue(WORKOUT_KIND, 'w1', 'delete', null, 11);
    expect(hk.deleteObjects).toHaveBeenCalledTimes(1);
    expect(server.size).toBe(0);
    expect(rows.size).toBe(0);
    await q.enqueue(WORKOUT_KIND, 'w1', 'delete', null, 12);
    expect(rows.size).toBe(0);
  });

  it('keeps the entry as failed/permission while workout write access is denied, then exports once allowed', async () => {
    const denied = setup('denied');
    await denied.q.initialize();
    await denied.q.enqueue(WORKOUT_KIND, 'w1', 'save', workoutPayload(base), 10);
    expect(hk.saveWorkoutSample).not.toHaveBeenCalled();
    expect(denied.rows.get('w1')).toMatchObject({ status: 'failed', reason: 'permission' });
    const allowed = setup('granted', denied.rows);
    await allowed.q.initialize();
    await allowed.q.process();
    expect(hk.saveWorkoutSample).toHaveBeenCalledTimes(1);
    expect(allowed.rows.get('w1')).toMatchObject({ status: 'success' });
  });

  it('another device that finds this version on the server does not write a second workout', async () => {
    const { q, server } = setup();
    server.set('workout:w1', { uuid: 'other', version: 10 });
    await q.initialize();
    await q.enqueue(WORKOUT_KIND, 'w1', 'save', workoutPayload(base), 10);
    expect(hk.saveWorkoutSample).not.toHaveBeenCalled();
  });
});
