import { act, useEffect } from 'react';
import { createRoot } from 'test-renderer';

import { useWaterExport, WaterExportOption } from './WaterExportOption';

const mockAlert = jest.fn();
const mockEnqueue = jest.fn();
const mockForget = jest.fn();
const mockDiscard = jest.fn();
const mockAllow = jest.fn();
let mockEntries: unknown[] = [];
let mockReady = false;
let mockAccess = 'granted';
const mockFetch = jest.fn();
jest.mock('@/lib/health/water-export', () => ({ ...jest.requireActual('@/lib/health/water-export'), fetchRecentWaterRows: (...a: unknown[]) => mockFetch(...a), deletedWaterIds: async () => [] }));
const mockStore = new Map<string, string>();
jest.mock('@/lib/alert', () => ({ alert: (...a: unknown[]) => mockAlert(...a) }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ session: { user: { id: 'u1' } } }) }));
jest.mock('@/lib/secure-storage', () => ({
  secureStorage: { getItem: async (k: string) => mockStore.get(k) ?? null, setItem: async (k: string, v: string) => void mockStore.set(k, v), removeItem: async () => {} },
}));
jest.mock('@/lib/health/healthkit', () => ({ ...jest.requireActual('@/lib/health/healthkit'), isHealthAvailable: () => true, getHealthWriteAccess: () => mockAccess }));
jest.mock('@/lib/health/sync', () => ({
  useHealthExport: () => ({ ready: mockReady, processing: false, entries: mockEntries, getEntries: () => mockEntries, enqueue: mockEnqueue, forget: mockForget, discard: mockDiscard, retry: jest.fn(), allowWrite: mockAllow }),
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

const seen = {} as { choice: ReturnType<typeof useWaterExport> };
function Option() {
  const choice = useWaterExport();
  useEffect(() => { seen.choice = choice; });
  return <WaterExportOption choice={choice} />;
}
const saved = (recordId: string) => ({ kind: 'water', recordId, op: 'save', status: 'success', version: 5, attempts: 0, payload: null });
const text = (r: ReturnType<typeof createRoot>) => (r.container as any).queryAll((n: any) => n.type === 'Text').map((n: any) => [n.props.children].flat().join('')).join('\n');
const flip = (r: ReturnType<typeof createRoot>, value: boolean) => act(async () => (r.container as any).queryAll((n: any) => n.type === 'RCTSwitch')[0].props.onChange({ nativeEvent: { value } }));
async function mount() {
  const r = createRoot();
  await act(async () => r.render(<Option />));
  await act(async () => { await new Promise((x) => setTimeout(x, 0)); });
  return r;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockReady = false;
  mockAccess = 'granted';
  mockStore.set('health-export-u1-water', '1');
  mockEntries = [saved('e1'), { ...saved('e2'), status: 'pending', payload: { ml: 250 } }];
});

test('turning on asks for water write permission only, and stays off when denied', async () => {
  mockStore.set('health-export-u1-water', '0');
  mockAccess = 'denied';
  const r = await mount();
  await flip(r, true);
  expect(mockAllow).toHaveBeenCalledWith(['HKQuantityTypeIdentifierDietaryWater']);
  expect(seen.choice.on).toBe(false);
  expect(text(r)).toContain('Health did not allow saving water');
  act(() => r.unmount());
});

test('turning off with water in Health asks Keep or Remove; Keep forgets the saves', async () => {
  const r = await mount();
  await flip(r, false);
  const [title, message, buttons] = mockAlert.mock.calls[0];
  expect(title).toBe('Turn off saving water to Health?');
  expect(message).toContain('1 entry was saved');
  expect(buttons.map((b: any) => b.text)).toEqual(['Cancel', 'Turn Off and Remove from Health', 'Turn Off, Keep in Health']);
  await act(async () => buttons[2].onPress());
  expect(mockForget).toHaveBeenCalledWith('water', expect.any(Function));
  expect(mockEnqueue).not.toHaveBeenCalled();
  expect(mockStore.get('health-export-u1-water')).toBe('0');
  act(() => r.unmount());
});

test('Remove queues a Health delete for each water save', async () => {
  const r = await mount();
  await flip(r, false);
  await act(async () => mockAlert.mock.calls[0][2][1].onPress());
  expect(mockEnqueue.mock.calls.map((c) => [c[0], c[1], c[2]])).toEqual([['water', 'e1', 'delete'], ['water', 'e2', 'delete']]);
  act(() => r.unmount());
});

test('a permission failure says the entries are kept and waiting, and Retry asks for permission', async () => {
  mockEntries = [{ ...saved('e1'), status: 'failed', reason: 'permission', payload: { ml: 250 } }];
  const r = await mount();
  expect(text(r)).toContain('Your entries are kept here and waiting');
  await act(async () => (r.container as any).queryAll((n: any) => n.props.accessibilityLabel === 'Retry Saving to Health' && n.props.onClick)[0].props.onClick());
  expect(mockAllow).toHaveBeenCalledWith(['HKQuantityTypeIdentifierDietaryWater']);
  act(() => r.unmount());
});

describe('sync', () => {
  const row = { id: 'r1', updated_at: '2026-11-06T12:00:00.000Z', consumed_at: '2026-11-06T12:00:00.000Z', ml: 250 };
  beforeEach(() => { mockReady = true; mockEntries = []; });
  it('queues the synced rows when on, and deleted() queues a delete only for one exported here', async () => {
    mockFetch.mockResolvedValue([row]);
    const r = await mount();
    expect(mockEnqueue).toHaveBeenCalledWith('water', 'r1', 'save', { ml: 250, at: row.consumed_at }, Date.parse(row.updated_at));
    mockEnqueue.mockClear();
    await act(async () => seen.choice.deleted('r1'));
    expect(mockEnqueue).not.toHaveBeenCalled();
    act(() => r.unmount());
  });
  it('queues nothing when water was deleted or settled while it was reading', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { bumpWaterSyncGeneration } = require('@/lib/health/water-export');
    mockFetch.mockImplementation(async () => { bumpWaterSyncGeneration(); return [row]; });
    const r = await mount();
    expect(mockFetch).toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
    act(() => r.unmount());
  });
});
