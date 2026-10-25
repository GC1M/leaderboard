import { isHealthAvailable, readDailySteps, requestStepsPermission, resetHealthKitCache } from './healthkit';
import { syncSteps } from './sync';

jest.mock('@/lib/metrics', () => ({ getMyRecentSteps: jest.fn(), upsertDailyMetrics: jest.fn() }));

beforeEach(() => resetHealthKitCache());

describe('availability fallback', () => {
  it('is unavailable when the native module is missing (Expo Go / jest)', async () => {
    // jest-expo runs as iOS, but the native module cannot load, so this exercises the try/catch path.
    expect(isHealthAvailable()).toBe(false);
    expect(await readDailySteps(7)).toEqual([]);
    expect(await requestStepsPermission()).toBe(false);
  });

  it('syncSteps reports unavailable without touching Supabase', async () => {
    const metrics = jest.requireMock('@/lib/metrics');
    expect(await syncSteps()).toEqual({ status: 'unavailable' });
    expect(metrics.upsertDailyMetrics).not.toHaveBeenCalled();
  });
});
