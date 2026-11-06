import { act } from 'react';
import { AccessibilityInfo, Keyboard } from 'react-native';
import { createRoot } from 'test-renderer';

const mockUpdate = jest.fn();
const mockEnqueue = jest.fn();
const mockDeleteFood = jest.fn();
let mockEntries: unknown[] = [];
const mockAlert = jest.fn();
jest.mock('@/lib/alert', () => ({ alert: (...a: unknown[]) => mockAlert(...a) }));
jest.mock('expo-router', () => ({ useSegments: () => [], useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/lib/health/sync', () => ({ useHealthSync: () => ({ ready: true, deleteImports: jest.fn() }), useHealthExport: () => ({ entries: mockEntries, enqueue: mockEnqueue }) }));
jest.mock('@/lib/supabase', () => ({ supabase: { auth: { signOut: jest.fn() } } }));
jest.mock('@/lib/profile', () => ({
  NAME_MAX: 40,
  deleteAccount: jest.fn(),
  deleteFoodHistory: () => mockDeleteFood(),
  getDisplayName: () => Promise.resolve('Sam'),
  updateDisplayName: (...a: unknown[]) => mockUpdate(...a),
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

jest.setTimeout(30000); // first render cold-loads react-native, slow on CI

test('Save Name dismisses the keyboard and confirms the save', async () => {
  const dismiss = jest.spyOn(Keyboard, 'dismiss');
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
  mockUpdate.mockResolvedValue('Sam B');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Profile = require('@/app/(tabs)/profile/index').default;
  const r = createRoot();
  await act(async () => r.render(<Profile />));
  const c = r.container as any;
  await act(async () => c.queryAll((n: any) => n.props.onChangeText)[0].props.onChangeText('Sam B'));
  const btn = c.queryAll((n: any) => n.props.onClick && JSON.stringify(n).includes('"Save Name"'))[0];
  await act(async () => btn.props.onClick());
  expect(mockUpdate).toHaveBeenCalledWith('Sam B');
  expect(dismiss).toHaveBeenCalled();
  expect(announce).toHaveBeenCalledWith('Name saved');
  expect(JSON.stringify(c)).toContain('"Saved"');
  act(() => r.unmount()); // the 2s "Saved" timer must not outlive the test
});

test('Delete Food History lets the user keep or remove the Health copies', async () => {
  mockEntries = [{ kind: 'food', recordId: 'e1', op: 'save', status: 'success', version: 5 }, { kind: 'workout', recordId: 'w1', op: 'save', status: 'success', version: 5 }];
  mockDeleteFood.mockResolvedValue(undefined);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Profile = require('@/app/(tabs)/profile/index').default;
  const r = createRoot();
  await act(async () => r.render(<Profile />));
  const row = (r.container as any).queryAll((n: any) => n.props.onClick && JSON.stringify(n).includes('Delete Food History'))[0];
  await act(async () => row.props.onClick());
  const buttons = mockAlert.mock.calls.at(-1)[2];
  expect(buttons.map((b: any) => b.text)).toEqual(['Cancel', 'Delete and Remove from Health', 'Delete, Keep in Health']);
  await act(async () => buttons[2].onPress());
  expect(mockDeleteFood).toHaveBeenCalledTimes(1);
  expect(mockEnqueue).not.toHaveBeenCalled();
  await act(async () => buttons[1].onPress());
  expect(mockEnqueue).toHaveBeenCalledTimes(1);
  expect(mockEnqueue).toHaveBeenCalledWith('food', 'e1', 'delete', null, expect.any(Number));
  mockEntries = [];
  await act(async () => r.render(<Profile />));
  await act(async () => (r.container as any).queryAll((n: any) => n.props.onClick && JSON.stringify(n).includes('Delete Food History'))[0].props.onClick());
  expect(mockAlert.mock.calls.at(-1)[2].map((b: any) => b.text)).toEqual(['Cancel', 'Delete Food History']);
  act(() => r.unmount());
});
