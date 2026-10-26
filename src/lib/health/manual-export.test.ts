import { createExportQueue, exportWriters, type ExportEntry } from './export-queue';
import { resetHealthKitCache } from './healthkit';
import { canExport, MANUAL_KINDS, stepsPayload } from './manual-export';

const hk = {
  isHealthDataAvailable: () => true,
  saveQuantitySample: jest.fn(async (..._args: unknown[]) => ({ uuid: 'q-uuid' })),
  saveCategorySample: jest.fn(async (..._args: unknown[]) => ({ uuid: 'c-uuid' })),
  deleteObjects: jest.fn(async () => 1),
};
beforeAll(() => jest.doMock('@kingstinct/react-native-healthkit', () => hk));
afterAll(() => jest.dontMock('@kingstinct/react-native-healthkit'));
beforeEach(() => { jest.clearAllMocks(); resetHealthKitCache(); });

const entry = (kind: string, recordId: string, payload: unknown, version = 5): ExportEntry => ({ kind, recordId, op: 'save', payload, version, status: 'pending', attempts: 0 });
const metadata = (kind: string, id: string, version: number) => ({
  HKMetadataKeySyncIdentifier: `leaderboard:${kind}:${id}`, HKMetadataKeySyncVersion: version, LeaderboardRecordId: `${kind}:${id}`,
});

describe('writers', () => {
  it('saves weight as a kg body mass sample at the observation time', async () => {
    const at = '2026-10-25T08:30:00.000Z';
    await expect(exportWriters[MANUAL_KINDS.weight]!.save(entry('manual-weight', 'w1', { kg: 72.5, at }))).resolves.toBe('q-uuid');
    expect(hk.saveQuantitySample).toHaveBeenCalledWith('HKQuantityTypeIdentifierBodyMass', 'kg', 72.5, new Date(at), new Date(at), metadata('manual-weight', 'w1', 5));
  });

  it('saves sleep as an asleep interval with its real start and end', async () => {
    const p = { start: '2026-10-24T23:10:00.000Z', end: '2026-10-25T06:40:00.000Z' };
    await exportWriters[MANUAL_KINDS.sleep]!.save(entry('manual-sleep', '2026-10-25', p));
    expect(hk.saveCategorySample).toHaveBeenCalledWith('HKCategoryTypeIdentifierSleepAnalysis', 1, new Date(p.start), new Date(p.end), metadata('manual-sleep', '2026-10-25', 5));
  });

  it('saves manual steps as a count sample over the day', async () => {
    const p = stepsPayload('2026-10-20', 8000, new Date(2026, 9, 25));
    await exportWriters[MANUAL_KINDS.steps]!.save(entry('manual-steps', '2026-10-20', p));
    expect(hk.saveQuantitySample).toHaveBeenCalledWith('HKQuantityTypeIdentifierStepCount', 'count', 8000, new Date(2026, 9, 20), new Date(2026, 9, 21), metadata('manual-steps', '2026-10-20', 5));
  });

  it('ends a step sample for today at the current time, not in the future', () => {
    const now = new Date(2026, 9, 25, 14, 0);
    expect(stepsPayload('2026-10-25', 100, now)).toEqual({ count: 100, start: new Date(2026, 9, 25).toISOString(), end: now.toISOString() });
  });

  it('removes only this record by its metadata', async () => {
    await exportWriters[MANUAL_KINDS.weight]!.remove({ ...entry('manual-weight', 'w1', null), op: 'delete' });
    expect(hk.deleteObjects).toHaveBeenCalledWith('HKQuantityTypeIdentifierBodyMass', { metadata: { withMetadataKey: 'LeaderboardRecordId', operatorType: 4, value: 'manual-weight:w1' } });
  });
});

describe('through the queue', () => {
  function queue(access: 'granted' | 'denied', rows = new Map<string, ExportEntry>()) {
    const q = createExportQueue({
      checkAccount: async () => {},
      store: { list: async () => [...rows.values()], put: async (e) => { rows.set(e.recordId, { ...e }); }, remove: async (_k, id) => { rows.delete(id); }, clear: async () => rows.clear() },
      mapping: { get: async () => null, record: async () => {}, remove: async () => {} },
      writers: exportWriters,
      access: () => access,
    });
    return { q, rows };
  }
  const payload = { kg: 70, at: '2026-10-25T08:00:00.000Z' };

  it('an edit re-saves with a higher version so Health replaces the sample', async () => {
    const { q } = queue('granted');
    await q.initialize();
    await q.enqueue(MANUAL_KINDS.weight, 'w1', 'save', payload, 10);
    await q.enqueue(MANUAL_KINDS.weight, 'w1', 'save', { ...payload, kg: 71 }, 11);
    const versions = hk.saveQuantitySample.mock.calls.map((c) => (c[5] as Record<string, number>).HKMetadataKeySyncVersion);
    expect(versions).toEqual([10, 11]);
    expect(hk.saveQuantitySample.mock.calls[1][2]).toBe(71);
  });

  it('a delete op removes the sample and the queue entry, and repeating it is harmless', async () => {
    const { q, rows } = queue('granted');
    await q.initialize();
    await q.enqueue(MANUAL_KINDS.weight, 'w1', 'save', payload, 10);
    await q.enqueue(MANUAL_KINDS.weight, 'w1', 'delete', null, 11);
    expect(hk.deleteObjects).toHaveBeenCalledTimes(1);
    expect(rows.size).toBe(0);
    await q.enqueue(MANUAL_KINDS.weight, 'w1', 'delete', null, 12);
    expect(rows.size).toBe(0);
  });

  it('keeps the entry as failed/permission when write access is denied, and saves on retry once allowed', async () => {
    const denied = queue('denied');
    await denied.q.initialize();
    await denied.q.enqueue(MANUAL_KINDS.weight, 'w1', 'save', payload, 10);
    expect(hk.saveQuantitySample).not.toHaveBeenCalled();
    expect(denied.rows.get('w1')).toMatchObject({ status: 'failed', reason: 'permission', payload });
    const allowed = queue('granted', denied.rows);
    await allowed.q.initialize();
    await allowed.q.process();
    expect(hk.saveQuantitySample).toHaveBeenCalledTimes(1);
    expect(allowed.rows.get('w1')).toMatchObject({ status: 'success' });
  });
});

it('only manual entries are exportable, never imported readings', () => {
  expect(canExport('manual')).toBe(true);
  expect(canExport('healthkit')).toBe(false);
  expect(canExport('health_connect')).toBe(false);
});
