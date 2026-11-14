import { act } from 'react';
import { AccessibilityInfo, Keyboard } from 'react-native';
import { createRoot } from 'test-renderer';

const mockUpdate = jest.fn();
const mockEnqueue = jest.fn();
const mockDeleteFood = jest.fn();
const mockForget = jest.fn();
const mockDeleteAccount = jest.fn();
let mockEntries: unknown[] = [];
const mockAlert = jest.fn();
jest.mock('@/lib/alert', () => ({ alert: (...a: unknown[]) => mockAlert(...a) }));
jest.mock('expo-router', () => ({ useSegments: () => [], useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/lib/health/sync', () => ({ useHealthSync: () => ({ ready: true, deleteImports: jest.fn() }), useHealthExport: () => ({ entries: mockEntries, getEntries: () => mockEntries, enqueue: mockEnqueue, forget: mockForget }) }));
jest.mock('@/lib/supabase', () => ({ supabase: { auth: { signOut: jest.fn() } } }));
jest.mock('@/lib/profile', () => ({
  NAME_MAX: 40,
  deleteAccount: () => mockDeleteAccount(),
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

test('Delete Food History, on the Your Data screen, lets the user keep or remove the Health copies', async () => {
  mockEntries = [{ kind: 'food', recordId: 'e1', op: 'save', status: 'success', version: 5 }, { kind: 'workout', recordId: 'w1', op: 'save', status: 'success', version: 5 }];
  mockDeleteFood.mockResolvedValue(undefined);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Profile = require('@/app/(tabs)/profile/data').default;
  const r = createRoot();
  await act(async () => r.render(<Profile />));
  const row = (r.container as any).queryAll((n: any) => n.props.onClick && JSON.stringify(n).includes('Delete Food History'))[0];
  await act(async () => row.props.onClick());
  const buttons = mockAlert.mock.calls.at(-1)[2];
  expect(buttons.map((b: any) => b.text)).toEqual(['Cancel', 'Delete and Remove from Health', 'Delete, Keep in Health']);
  await act(async () => buttons[2].onPress());
  expect(mockDeleteFood).toHaveBeenCalledTimes(1);
  expect(mockEnqueue).not.toHaveBeenCalled();
  expect(mockForget).toHaveBeenCalledWith('food', expect.any(Function));
  await act(async () => buttons[1].onPress());
  expect(mockEnqueue).toHaveBeenCalledTimes(1);
  expect(mockEnqueue).toHaveBeenCalledWith('food', 'e1', 'delete', null, expect.any(Number));
  mockEntries = [];
  await act(async () => r.render(<Profile />));
  await act(async () => (r.container as any).queryAll((n: any) => n.props.onClick && JSON.stringify(n).includes('Delete Food History'))[0].props.onClick());
  expect(mockAlert.mock.calls.at(-1)[2].map((b: any) => b.text)).toEqual(['Cancel', 'Delete Food History']);
  act(() => r.unmount());
});

test('Delete Account offers to remove exported food from Health first, and stops if that fails', async () => {
  mockEntries = [{ kind: 'food', recordId: 'e1', op: 'save', status: 'success', version: 5 }];
  mockEnqueue.mockReset();
  mockDeleteAccount.mockReset().mockResolvedValue(undefined);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Profile = require('@/app/(tabs)/profile/index').default;
  const r = createRoot();
  await act(async () => r.render(<Profile />));
  const press = async () => {
    await act(async () => (r.container as any).queryAll((n: any) => n.props.onClick && JSON.stringify(n).includes('Delete Account'))[0].props.onClick());
    return mockAlert.mock.calls.at(-1)[2];
  };
  let buttons = await press();
  expect(buttons.map((b: any) => b.text)).toEqual(['Cancel', 'Delete Account and Remove from Health', 'Delete Account, Keep in Health']);
  await act(async () => buttons[2].onPress());
  expect(mockDeleteAccount).toHaveBeenCalledTimes(1);
  expect(mockEnqueue).not.toHaveBeenCalled();
  await act(async () => buttons[1].onPress());
  expect(mockEnqueue).toHaveBeenCalledWith('food', 'e1', 'delete', null, expect.any(Number));
  expect(mockDeleteAccount).toHaveBeenCalledTimes(2);
  // A Health delete that fails keeps the account.
  mockEnqueue.mockImplementationOnce(async () => { mockEntries = [{ kind: 'food', recordId: 'e1', op: 'delete', status: 'failed', version: 6 }]; });
  mockEntries = [{ kind: 'food', recordId: 'e1', op: 'save', status: 'success', version: 5 }];
  buttons = await press();
  await act(async () => buttons[1].onPress());
  expect(mockDeleteAccount).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(r.container)).toContain("Couldn't remove some food");
  mockEntries = [];
  buttons = await press();
  expect(buttons.map((b: any) => b.text)).toEqual(['Cancel', 'Delete Account']);
  act(() => r.unmount());
});
