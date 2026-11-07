import { loadHealthKit } from './healthkit';
import { readDailySleep, summarizeSleep, type SleepSample } from './sleep';
const s = (start: string, end: string, value = 1, uuid = start): SleepSample => ({ uuid, startDate: new Date(start), endDate: new Date(end), value });

test('unions tracker overlap, generic asleep and stages, excluding awake/in-bed', () => {
  const days = summarizeSleep([
    s('2026-10-24T22:00:00Z', '2026-10-25T06:00:00Z', 0),
    s('2026-10-24T23:00:00Z', '2026-10-25T05:00:00Z'),
    s('2026-10-24T23:00:00Z', '2026-10-25T01:00:00Z', 3),
    s('2026-10-25T00:00:00Z', '2026-10-25T03:00:00Z', 4),
    s('2026-10-25T05:00:00Z', '2026-10-25T06:00:00Z', 2),
  ]);
  expect(days).toHaveLength(1);
  expect(days[0].value).toBe(360);
  expect(days[0].windowEnd).toBe('2026-10-25T05:00:00.000Z');
});
test('assigns interrupted overnight sleep to wake-up date and adds a nap', () => {
  const samples = [s('2026-10-24T22:00:00', '2026-10-24T23:50:00'), s('2026-10-25T00:10:00', '2026-10-25T06:00:00'), s('2026-10-25T14:00:00', '2026-10-25T14:30:00')];
  expect(summarizeSleep(samples).map(({ date, value }) => ({ date, value }))).toEqual([{ date: '2026-10-25', value: 490 }]);
});
test('uses actual elapsed time across DST and device-local wake date', () => {
  const d = summarizeSleep([s('2026-11-01T00:00:00-04:00', '2026-11-01T08:00:00-05:00')]);
  expect(d[0].value).toBe(540);
});
test('empty/awake-only input has no invented zero day; invalid asleep data fails', () => {
  expect(summarizeSleep([s('2026-10-25T00:00:00Z','2026-10-25T01:00:00Z', 2)])).toEqual([]);
  expect(() => summarizeSleep([s('bad','bad')])).toThrow('Invalid sleep');
});
test('skips a zero-length asleep sample instead of failing the whole import', () => {
  const days = summarizeSleep([s('2026-11-05T04:00:00Z', '2026-11-05T11:00:00Z', 3), s('2026-11-06T05:00:00Z', '2026-11-06T05:00:00Z')]);
  expect(days.map((d) => d.value)).toEqual([420]);
});
test('correction/deletion recomputes the remaining union deterministically', () => {
  const a=s('2026-10-25T00:00:00Z','2026-10-25T02:00:00Z');
  const b=s('2026-10-25T01:00:00Z','2026-10-25T03:00:00Z');
  expect(summarizeSleep([a,b])[0].value).toBe(180);
  expect(summarizeSleep([b])[0].value).toBe(120);
  expect(summarizeSleep([])).toEqual([]);
});

jest.mock('./healthkit', () => ({ HEALTH_TYPES: { sleep: 'HKCategoryTypeIdentifierSleepAnalysis' }, loadHealthKit: jest.fn() }));
test('reader includes boundary overlap, filters by wake date, and surfaces query errors', async () => {
  const queryCategorySamples = jest.fn().mockResolvedValue([s('2026-10-24T23:00:00', '2026-10-25T07:00:00')]);
  (loadHealthKit as jest.Mock).mockReturnValue({ queryCategorySamples });
  const now = new Date(2026,9,25,12);
  expect((await readDailySleep(1, now))[0].date).toBe('2026-10-25');
  expect(queryCategorySamples.mock.calls[0][1]).toMatchObject({ limit: 0, filter: { date: { endDate: now } } });
  // The app's own sleep exports are not read back as Health data.
  expect(queryCategorySamples.mock.calls[0][1].filter.NOT).toBeDefined();
  queryCategorySamples.mockRejectedValue(new Error('native read failed'));
  await expect(readDailySleep(1,now)).rejects.toThrow('native read failed');
});
