import { getAllHealthAccess, getHealthAccess, isHealthAvailable, readDailySteps, requestHealthAccess, resetHealthKitCache } from './healthkit';
import { syncSteps } from './sync';

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

  it('syncSteps reports unavailable without touching Supabase', async () => {
    const metrics = jest.requireMock('@/lib/metrics');
    expect(await syncSteps()).toEqual({ status: 'unavailable' });
    expect(metrics.upsertDailyMetrics).not.toHaveBeenCalled();
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

  it('syncSteps needs permission only when steps were never asked, and never prompts', async () => {
    statusByType.HKCategoryTypeIdentifierSleepAnalysis = 2;
    expect(await syncSteps()).toEqual({ status: 'needs-permission' });
    expect(hk.requestAuthorization).not.toHaveBeenCalled();
  });

  it('syncSteps reports no-data (not denied, not synced) when an asked query is empty', async () => {
    statusByType.HKQuantityTypeIdentifierStepCount = 2;
    expect(await syncSteps()).toEqual({ status: 'no-data' });
    expect(jest.requireMock('@/lib/metrics').upsertDailyMetrics).not.toHaveBeenCalled();
  });

  it('syncSteps surfaces a query error instead of reporting no data', async () => {
    statusByType.HKQuantityTypeIdentifierStepCount = 2;
    hk.queryStatisticsCollectionForQuantity.mockRejectedValueOnce(new Error('query failed'));
    await expect(syncSteps()).rejects.toThrow('query failed');
  });
});
