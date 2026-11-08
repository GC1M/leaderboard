// QA (#58): useWaterExport().sync against Delete Water History / turning the switch off while a save is being written.
import { act, useEffect } from 'react';
import { createRoot } from 'test-renderer';

import { useWaterExport, WaterExportOption } from '@/components/water/WaterExportOption';
import { settleWaterExport } from '@/lib/health/water-export';

const mockEnqueue = jest.fn();
const mockDiscard = jest.fn(async () => {});
// Drops what it matches, like the real queue.
const mockForget = jest.fn(async (kind: string, match: (e: any) => boolean = () => true) => { mockEntries = mockEntries.filter((e: any) => !(e.kind === kind && match(e))); });
let mockEntries: unknown[] = [];
const mockFetch = jest.fn();
const mockStore = new Map<string, string>();
jest.mock('@/lib/health/water-export', () => ({ ...jest.requireActual('@/lib/health/water-export'), fetchRecentWaterRows: (...a: unknown[]) => mockFetch(...a), deletedWaterIds: async () => [] }));
jest.mock('@/lib/alert', () => ({ alert: jest.fn() }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ session: { user: { id: 'u1' } } }) }));
jest.mock('@/lib/secure-storage', () => ({
  secureStorage: { getItem: async (k: string) => mockStore.get(k) ?? null, setItem: async (k: string, v: string) => void mockStore.set(k, v), removeItem: async () => {} },
}));
jest.mock('@/lib/health/healthkit', () => ({ isHealthAvailable: () => true, getHealthWriteAccess: () => 'granted' }));
jest.mock('@/lib/health/sync', () => ({
  useHealthExport: () => ({ ready: true, processing: false, entries: mockEntries, getEntries: () => mockEntries, enqueue: mockEnqueue, forget: mockForget, discard: mockDiscard, retry: jest.fn(), allowWrite: jest.fn() }),
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

const seen = {} as { choice: ReturnType<typeof useWaterExport> };
function Option() {
  const choice = useWaterExport();
  useEffect(() => { seen.choice = choice; });
  return <WaterExportOption choice={choice} />;
}
const row = (id: string) => ({ id, updated_at: '2026-11-06T13:00:00.000Z', consumed_at: '2026-11-06T12:00:00.000Z', ml: 250 });
const flush = () => act(async () => { await new Promise((x) => setTimeout(x, 0)); });

beforeEach(() => {
  jest.clearAllMocks();
  mockEntries = [];
  mockStore.set('health-export-u1-water', '1');
  mockFetch.mockResolvedValue([row('w1'), row('w2')]);
});

// enqueue resolves only when the queue has written the entry to Health (it returns process()), so the sync loop
// is parked on each HealthKit write. The generation is checked once, before the loop.
test('Delete Water History (Remove) starting while the first save is writing: the sync queues no more stale rows', async () => {
  mockEnqueue.mockImplementationOnce(async () => {
    // The user taps Delete Water History > Delete and Remove from Health now (profile deleteWater(true)).
    await settleWaterExport({ getEntries: () => [], enqueue: jest.fn(), forget: jest.fn() }, true);
  });
  const r = createRoot();
  await act(async () => r.render(<Option />));
  await flush();
  expect(mockEnqueue.mock.calls.map((c) => [c[1], c[2]])).toEqual([['w1', 'save']]);
  act(() => r.unmount());
});

test('turning the switch off while the first save is writing: the sync queues no more saves after the discard', async () => {
  let finishFirst!: () => void;
  mockEnqueue.mockImplementationOnce(() => new Promise<void>((res) => { finishFirst = res; }));
  const r = createRoot();
  await act(async () => r.render(<Option />));
  await flush();
  expect(mockEnqueue).toHaveBeenCalledTimes(1);
  // Nothing has reached Health yet (n === 0), so the switch turns off directly: discard('water'), no settle, no generation bump.
  const sw = (r.container as any).queryAll((n: any) => n.type === 'RCTSwitch')[0];
  await act(async () => sw.props.onChange({ nativeEvent: { value: false } }));
  expect(mockDiscard).toHaveBeenCalledWith('water');
  expect(mockStore.get('health-export-u1-water')).toBe('0');
  await act(async () => finishFirst());
  await flush();
  // w2 is queued for Apple Health after the user turned the export off.
  expect(mockEnqueue.mock.calls.map((c) => c[1])).toEqual(['w1']);
  act(() => r.unmount());
});

test('a save queued while Delete Water History starts is taken back out of Health', async () => {
  mockEnqueue.mockImplementationOnce(async (kind: string, recordId: string) => {
    // The settle runs in the gap before the queue stores the save, so it never sees it.
    await settleWaterExport({ getEntries: () => [], enqueue: jest.fn(), forget: jest.fn() }, true);
    mockEntries = [{ kind, recordId, op: 'save', payload: {}, version: 1, status: 'pending', attempts: 0 }];
  });
  const r = createRoot();
  await act(async () => r.render(<Option />));
  await flush();
  expect(mockEnqueue).toHaveBeenCalledTimes(1);
  expect(mockForget).toHaveBeenCalledWith('water', expect.any(Function));
  act(() => r.unmount());
});

test('a sync started while the switch is turning off queues nothing', async () => {
  mockFetch.mockResolvedValue([]);
  const r = createRoot();
  await act(async () => r.render(<Option />));
  await flush();
  mockFetch.mockResolvedValue([row('w1')]);
  // A water log reloads the screen during the discard, before `on` turns false.
  mockDiscard.mockImplementationOnce(async () => { await seen.choice.sync(); });
  const sw = (r.container as any).queryAll((n: any) => n.type === 'RCTSwitch')[0];
  await act(async () => sw.props.onChange({ nativeEvent: { value: false } }));
  await flush();
  expect(mockEnqueue).not.toHaveBeenCalled();
  act(() => r.unmount());
});
