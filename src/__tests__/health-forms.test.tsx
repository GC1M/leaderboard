import { act } from 'react';
import { createRoot } from 'test-renderer';

import Weight from '@/app/weight';

const mockAlert = jest.fn();
const mockDelete = jest.fn();
const mockReading = { id: 'w1', kg: 80, measuredAt: new Date(Date.now() - 3600_000).toISOString(), source: 'manual' };
jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn(), canGoBack: () => true }), useFocusEffect: jest.fn(), useSegments: () => [] }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ session: { user: { id: 'me' } }, loading: false }) }));
jest.mock('@/lib/alert', () => ({ alert: (...args: unknown[]) => mockAlert(...args) }));
jest.mock('@/lib/weight-unit', () => ({ useWeightUnit: () => ['kg', jest.fn()] }));
jest.mock('@/lib/health/sync', () => ({ useHealthExport: () => ({ enqueue: jest.fn() }) }));
jest.mock('@/components/health/ExportOption', () => ({ ExportOption: () => null, useExportChoice: () => ({ on: false }) }));
jest.mock('@/lib/weight', () => ({
  getMyWeightHistory: () => Promise.resolve([mockReading]),
  getMyLatestWeight: () => Promise.resolve(mockReading),
  saveManualWeight: jest.fn(),
  deleteManualWeight: (...args: unknown[]) => mockDelete(...args),
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

async function render() {
  const r = createRoot();
  await act(async () => r.render(<Weight />));
  return r.container as any;
}
const find = (c: any, prop: string, text: string) => c.queryAll((n: any) => n.props[prop] && JSON.stringify(n).includes(text))[0];

beforeEach(() => jest.clearAllMocks());

test('a future time shows its error under When, not under Weight', async () => {
  const c = await render();
  await act(async () => find(c, 'onChangeText', '"Weight (kg)"').props.onChangeText('80'));
  await act(async () => find(c, 'onChangeText', '"When"').props.onChangeText('2999-01-01 08:00'));
  await act(async () => find(c, 'onClick', '"Save Weight"').props.onClick());
  const when = JSON.stringify(c).split('"When"');
  expect(when[0]).not.toContain('Enter a time that has passed');
  expect(when[when.length - 1]).toContain('Enter a time that has passed');
});

test('deleting a reading asks first and only deletes on confirm', async () => {
  const c = await render();
  // One reading: the chart scale has a single label, not the same value at both ends.
  expect(c.queryAll((n: any) => n.props.children === '80.0 kg')).toHaveLength(2); // latest and one scale label
  await act(async () => find(c, 'onClick', '"Delete"').props.onClick());
  expect(mockDelete).not.toHaveBeenCalled();
  expect(mockAlert.mock.calls[0][0]).toBe('Delete this weight reading?');
  await act(async () => mockAlert.mock.calls[0][2].find((b: { text: string }) => b.text === 'Delete').onPress());
  expect(mockDelete).toHaveBeenCalledWith('me', 'w1');
});
