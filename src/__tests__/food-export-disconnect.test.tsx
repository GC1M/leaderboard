import { act } from 'react';
import { createRoot } from 'test-renderer';

import { FoodExportOption, useFoodExport } from '@/components/food/FoodExportOption';

const mockAlert = jest.fn();
const mockEnqueue = jest.fn();
const mockForget = jest.fn();
const mockDiscard = jest.fn();
let mockEntries: unknown[] = [];
const mockStore = new Map<string, string>();
jest.mock('@/lib/alert', () => ({ alert: (...a: unknown[]) => mockAlert(...a) }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ session: { user: { id: 'u1' } } }) }));
jest.mock('@/lib/secure-storage', () => ({
  secureStorage: { getItem: async (k: string) => mockStore.get(k) ?? null, setItem: async (k: string, v: string) => void mockStore.set(k, v), removeItem: async () => {} },
}));
jest.mock('@/lib/health/healthkit', () => ({ isHealthAvailable: () => true, getHealthWriteAccess: () => 'granted' }));
jest.mock('@/lib/health/sync', () => ({
  useHealthExport: () => ({ ready: false, processing: false, entries: mockEntries, getEntries: () => mockEntries, enqueue: mockEnqueue, forget: mockForget, discard: mockDiscard, retry: jest.fn(), allowWrite: jest.fn() }),
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

function Option() {
  return <FoodExportOption choice={useFoodExport()} />;
}
const saved = (recordId: string) => ({ kind: 'food', recordId, op: 'save', status: 'success', version: 5, attempts: 0, payload: null });

async function turnOff() {
  const r = createRoot();
  await act(async () => r.render(<Option />));
  await act(async () => (r.container as any).queryAll((n: any) => n.type === 'RCTSwitch')[0].props.onChange({ nativeEvent: { value: false } }));
  return r;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.set('health-export-u1-food', '1');
  mockEntries = [saved('e1'), { ...saved('e2'), status: 'pending', payload: { name: 'Secret' } }];
});

test('turning the switch off with food in Health asks, and Cancel changes nothing', async () => {
  const r = await turnOff();
  const [title, message, buttons] = mockAlert.mock.calls[0];
  expect(title).toBe('Turn off saving food to Health?');
  expect(message).toContain('1 entry was saved');
  expect(buttons.map((b: any) => b.text)).toEqual(['Cancel', 'Turn Off and Remove from Health', 'Turn Off, Keep in Health']);
  expect(mockForget).not.toHaveBeenCalled();
  expect(mockDiscard).not.toHaveBeenCalled();
  act(() => r.unmount());
});

test('Keep forgets the food saves so re-enabling the switch cannot reconcile them, then turns the switch off', async () => {
  const r = await turnOff();
  await act(async () => mockAlert.mock.calls[0][2][2].onPress());
  expect(mockForget).toHaveBeenCalledWith('food', expect.any(Function));
  expect(mockEnqueue).not.toHaveBeenCalled();
  expect(mockDiscard).toHaveBeenCalledWith('food');
  expect(mockStore.get('health-export-u1-food')).toBe('0');
  act(() => r.unmount());
});

test('Remove queues a Health delete for each food save, then turns the switch off', async () => {
  const r = await turnOff();
  await act(async () => mockAlert.mock.calls[0][2][1].onPress());
  expect(mockEnqueue.mock.calls.map((c) => [c[0], c[1], c[2]])).toEqual([['food', 'e1', 'delete'], ['food', 'e2', 'delete']]);
  expect(mockForget).not.toHaveBeenCalled();
  expect(mockStore.get('health-export-u1-food')).toBe('0');
  act(() => r.unmount());
});

test('with nothing in Health the switch just turns off', async () => {
  mockEntries = [];
  const r = await turnOff();
  expect(mockAlert).not.toHaveBeenCalled();
  expect(mockDiscard).toHaveBeenCalledWith('food');
  act(() => r.unmount());
});
