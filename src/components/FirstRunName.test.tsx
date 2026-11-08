import { act } from 'react';
import { createRoot } from 'test-renderer';
import { FirstRunName } from './FirstRunName';

let mockUser: { id: string; user_metadata: Record<string, unknown> } | undefined;
const mockGetName = jest.fn();
const mockUpdate = jest.fn();
const mockSkip = jest.fn();
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('expo-router', () => ({ useRouter: () => ({}), useSegments: () => [] }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ session: mockUser ? { user: mockUser } : null }) }));
jest.mock('@/lib/profile', () => ({
  ...jest.requireActual('@/lib/profile'),
  getDisplayName: () => mockGetName(),
  updateDisplayName: (n: string) => mockUpdate(n),
  skipNamePrompt: () => mockSkip(),
}));

const uid = '3f2a9c1e-0000-4000-8000-000000000000';
const visible = (root: ReturnType<typeof createRoot>) => JSON.stringify(root.container).includes('What should friends call you?');
const find = (root: ReturnType<typeof createRoot>, label: string): any => (root.container as any).queryAll((n: any) => n.props?.accessibilityLabel === label)[0];
const press = (root: ReturnType<typeof createRoot>, label: string) => act(async () => find(root, label).props.onClick({ nativeEvent: {} }));
async function render() {
  const root = createRoot();
  await act(async () => root.render(<FirstRunName />));
  return root;
}
beforeEach(() => { jest.clearAllMocks(); mockUser = { id: uid, user_metadata: {} }; });

test('asks for a name only while the account has the automatic name', async () => {
  mockGetName.mockResolvedValue('Player 3F2A');
  let root = await render();
  expect(visible(root)).toBe(true);
  await act(async () => root.unmount());

  mockGetName.mockResolvedValue('Shivam');
  root = await render();
  expect(visible(root)).toBe(false);
  await act(async () => root.unmount());
});

test('does not ask after the user chose Not Now, or when the name cannot load', async () => {
  mockUser = { id: uid, user_metadata: { name_prompt_skipped: true } };
  mockGetName.mockResolvedValue('Player 3F2A');
  let root = await render();
  expect(visible(root)).toBe(false);
  expect(mockGetName).not.toHaveBeenCalled();
  await act(async () => root.unmount());

  mockUser = { id: uid, user_metadata: {} };
  mockGetName.mockRejectedValue(new Error('offline'));
  root = await render();
  expect(visible(root)).toBe(false);
  await act(async () => root.unmount());
});

test('Continue saves the trimmed name and Not Now remembers the skip', async () => {
  mockGetName.mockResolvedValue('Player 3F2A');
  mockUpdate.mockResolvedValue('Alex');
  mockSkip.mockResolvedValue(undefined);
  const root = await render();
  await press(root, 'Continue');
  expect(mockUpdate).not.toHaveBeenCalled();
  expect(JSON.stringify(root.container)).toContain('Enter a name, or choose Not Now.');

  await act(async () => find(root, 'Your name').props.onChangeText('  Alex '));
  await press(root, 'Continue');
  expect(mockUpdate).toHaveBeenCalledWith('  Alex ');
  expect(visible(root)).toBe(false);
  await act(async () => root.unmount());

  const again = await render();
  await press(again, 'Not Now');
  expect(mockSkip).toHaveBeenCalled();
  expect(visible(again)).toBe(false);
  await act(async () => again.unmount());
});
