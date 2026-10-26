import { getAllHealthAccess, getHealthAccess, isHealthAvailable, readDailySteps, requestHealthAccess, resetHealthKitCache } from './healthkit';

jest.mock('@/lib/metrics', () => ({ getMyRecentSteps: jest.fn(), upsertDailyMetrics: jest.fn() }));

beforeEach(() => resetHealthKitCache());

describe('availability fallback', () => {
  it('is unavailable when the native module is missing (Expo Go / jest)', async () => {
    // jest-expo runs as iOS, but the native module cannot load, so this exercises the try/catch path.
    expect(isHealthAvailable()).toBe(false);
    expect(await readDailySteps(7)).toEqual([]);
    expect(await getHealthAccess('sleep')).toBe('unavailable');
    await expect(requestHealthAccess()).resolves.toBeUndefined();
  });


});

describe('with HealthKit', () => {
  // AuthorizationRequestStatus: 0 unknown, 1 shouldRequest, 2 unnecessary (already asked).
  const statusByType: Record<string, number> = {};
  const hk = {
    isHealthDataAvailable: () => true,
    getRequestStatusForAuthorization: jest.fn(async ({ toRead }: { toRead: string[] }) => statusByType[toRead[0]] ?? 1),
    requestAuthorization: jest.fn(async () => true),
    queryStatisticsCollectionForQuantity: jest.fn(async (): Promise<unknown[]> => []),
  };
  beforeAll(() => jest.doMock('@kingstinct/react-native-healthkit', () => hk));
  afterAll(() => jest.dontMock('@kingstinct/react-native-healthkit'));
  beforeEach(() => {
    for (const k of Object.keys(statusByType)) delete statusByType[k];
    jest.clearAllMocks();
  });

  it('reports each metric independently and never claims a grant', async () => {
    statusByType.HKQuantityTypeIdentifierStepCount = 2;
    statusByType.HKQuantityTypeIdentifierBodyMass = 0;
    expect(await getAllHealthAccess()).toEqual({ steps: 'asked', sleep: 'not-asked', weight: 'not-asked' });
  });

  it('requests read access to all three types in one sheet', async () => {
    await requestHealthAccess();
    expect(hk.requestAuthorization).toHaveBeenCalledWith({
      toRead: ['HKQuantityTypeIdentifierStepCount', 'HKCategoryTypeIdentifierSleepAnalysis', 'HKQuantityTypeIdentifierBodyMass'],
    });
  });

  it('does not prompt when checking an unrequested metric', async () => {
    expect(await getHealthAccess('steps')).toBe('not-asked');
    expect(hk.requestAuthorization).not.toHaveBeenCalled();
  });
  it('returns an empty query without claiming a grant', async () => {
    expect(await readDailySteps(7)).toEqual([]);
  });
  it('surfaces query errors rather than converting them to missing data', async () => {
    hk.queryStatisticsCollectionForQuantity.mockRejectedValueOnce(new Error('query failed'));
    await expect(readDailySteps(7)).rejects.toThrow('query failed');
  });
  it('maps buckets to local days and omits days with no samples instead of reporting zero', async () => {
    hk.queryStatisticsCollectionForQuantity.mockResolvedValueOnce([
      { startDate: new Date(2026, 9, 24), sumQuantity: { quantity: 8123 } },
      { startDate: new Date(2026, 9, 25) },
      { startDate: new Date(2026, 9, 26), sumQuantity: { quantity: 0 } },
    ]);
    expect(await readDailySteps(3, new Date(2026, 9, 26, 12))).toEqual([
      { date: '2026-10-24', value: 8123 },
      { date: '2026-10-26', value: 0 },
    ]);
  });
});
