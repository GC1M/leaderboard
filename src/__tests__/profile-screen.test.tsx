import { act } from 'react';
import { AccessibilityInfo, Keyboard } from 'react-native';
import { createRoot } from 'test-renderer';

const mockUpdate = jest.fn();
jest.mock('expo-router', () => ({ useSegments: () => [], useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/lib/health/sync', () => ({ useHealthSync: () => ({ ready: true, deleteImports: jest.fn() }) }));
jest.mock('@/lib/supabase', () => ({ supabase: { auth: { signOut: jest.fn() } } }));
jest.mock('@/lib/profile', () => ({
  NAME_MAX: 40,
  deleteAccount: jest.fn(),
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
