import { resetHealthKitCache } from '../health/healthkit';
import { createIosHealthAdapter } from './ios';
import { runHealthAdapterContract } from './contract-suite';

jest.mock('@/lib/metrics', () => ({ getMyRecentSteps: jest.fn(), upsertDailyMetrics: jest.fn() }));

// Read status mirrors the real module: asking once makes it 'unnecessary' (2); write status stays per type.
const askedRead = new Set<string>();
const writeStatus: Record<string, number> = {};
let available = true;
const hk = {
  isHealthDataAvailable: () => available,
  getRequestStatusForAuthorization: jest.fn(async ({ toRead }: { toRead: string[] }) => (askedRead.has(toRead[0]) ? 2 : 1)),
  requestAuthorization: jest.fn(async (req: { toRead?: string[]; toShare?: string[] }) => {
    req.toRead?.forEach((t) => askedRead.add(t));
    req.toShare?.forEach((t) => { writeStatus[t] = 2; });
    return true;
  }),
  authorizationStatusFor: jest.fn((type: string) => writeStatus[type] ?? 0),
  queryStatisticsCollectionForQuantity: jest.fn(async (): Promise<unknown[]> => []),
  queryCategorySamples: jest.fn(async (): Promise<unknown[]> => []),
  queryQuantitySamples: jest.fn(async (): Promise<unknown[]> => []),
};

beforeAll(() => jest.doMock('@kingstinct/react-native-healthkit', () => hk));
afterAll(() => jest.dontMock('@kingstinct/react-native-healthkit'));
beforeEach(() => {
  resetHealthKitCache();
  available = true;
  askedRead.clear();
  for (const k of Object.keys(writeStatus)) delete writeStatus[k];
  jest.clearAllMocks();
});

runHealthAdapterContract('iOS adapter', { make: () => createIosHealthAdapter() });

describe('iOS adapter over the existing Apple Health modules', () => {
  it('requests read and write access separately, with native identifiers kept inside', async () => {
    const a = createIosHealthAdapter();
    await a.requestPermissions('read', ['weight']);
    expect(hk.requestAuthorization).toHaveBeenLastCalledWith({ toRead: ['HKQuantityTypeIdentifierBodyMass'] });
    await a.requestPermissions('write', ['weight']);
    expect(hk.requestAuthorization).toHaveBeenLastCalledWith({ toShare: ['HKQuantityTypeIdentifierBodyMass'] });
    expect(await a.getPermission('weight', 'write')).toBe('granted');
    expect(await a.getPermission('sleep', 'write')).toBe('not-asked');
  });
  it('never claims a read grant and asks before reading', async () => {
    const a = createIosHealthAdapter();
    expect(await a.getPermission('steps', 'read')).toBe('not-asked');
    expect(await a.readSteps({ days: 7 })).toEqual({ status: 'permission-required', access: 'read' });
    await a.requestPermissions('read', ['steps']);
    expect(await a.getPermission('steps', 'read')).toBe('unknown');
    expect(await a.readSteps({ days: 7 })).toEqual({ status: 'ok', data: [] });
  });
  it('maps steps, sleep and weight to the neutral shapes', async () => {
    const a = createIosHealthAdapter();
    await a.requestPermissions('read', ['steps', 'sleep', 'weight']);
    hk.queryStatisticsCollectionForQuantity.mockResolvedValueOnce([{ startDate: new Date(2026, 9, 25), sumQuantity: { quantity: 8123 } }]);
    expect(await a.readSteps({ days: 3, now: new Date(2026, 9, 26, 12) })).toEqual({ status: 'ok', data: [{ date: '2026-10-25', count: 8123 }] });
    hk.queryQuantitySamples.mockResolvedValue([{ uuid: 'abc', startDate: new Date('2026-10-25T08:00:00Z'), quantity: 70, unit: 'kg' }]);
    const weight = await a.readWeight({ days: 3, now: new Date('2026-10-26T12:00:00Z') });
    expect(weight).toEqual({ status: 'ok', data: [{ id: 'ios:abc', measuredAt: '2026-10-25T08:00:00.000Z', kg: 70, provenance: { origin: 'other-app', recording: 'unknown' } }] });
  });
  it('is explicit about what is not wired through the adapter yet', async () => {
    const a = createIosHealthAdapter();
    expect(await a.getCapability('weight', 'write')).toEqual({ status: 'unsupported', reason: 'not-implemented' });
    expect(await a.readChanges('weight', null)).toEqual({ status: 'unsupported', reason: 'not-implemented' });
    expect(a.readWorkouts).toBeUndefined();
  });
  it('is unavailable when HealthKit is not usable (Expo Go, no native build)', async () => {
    available = false;
    const a = createIosHealthAdapter();
    expect(await a.getAvailability()).toEqual({ status: 'unavailable', reason: 'native-build-required' });
    expect(await a.readSteps({ days: 7 })).toEqual({ status: 'unavailable', reason: 'native-build-required' });
    expect(await a.getPermission('steps', 'read')).toBe('unavailable');
  });
});
