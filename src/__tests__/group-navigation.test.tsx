import { act } from 'react';
import { AccessibilityInfo, Keyboard } from 'react-native';
import { createRoot } from 'test-renderer';

import GroupInfo from '@/app/(tabs)/groups/[id]/info';
import JoinGroup from '@/app/(tabs)/groups/join';
import JoinByLink from '@/app/join/[code]';

const mockRouter = { replace: jest.fn(), canDismiss: jest.fn(), dismissAll: jest.fn(), canGoBack: jest.fn() };
let mockParams: { id?: string; code?: string } = {};
let mockSession: { user: { id: string } } | null = { user: { id: 'me' } };
const mockRead = jest.fn();
const mockJoin = jest.fn();
const mockDelete = jest.fn();
const mockAlert = jest.fn();
const mockMembers = jest.fn();
const mockRename = jest.fn();
const mockShare = jest.fn();
jest.mock('expo-router', () => ({
  useSegments: () => [],
  useLocalSearchParams: () => mockParams,
  useRouter: () => mockRouter,
  Redirect: (props: unknown) => {
    const { Text } = jest.requireActual('react-native');
    return <Text>{JSON.stringify(props)}</Text>;
  },
}));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ session: mockSession, loading: false }) }));
jest.mock('@/lib/alert', () => ({ alert: (...args: unknown[]) => mockAlert(...args) }));
jest.mock('@/lib/supabase', () => ({ supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mockRead }) }) }) } }));
jest.mock('@/lib/groups', () => ({
  ...jest.requireActual('@/lib/groups'),
  joinGroup: (...args: unknown[]) => mockJoin(...args),
  listMembers: () => mockMembers(),
  getMyShares: () => Promise.resolve(['steps']),
  deleteGroup: (...args: unknown[]) => mockDelete(...args),
  renameGroup: (...args: unknown[]) => mockRename(...args),
  setShare: (...args: unknown[]) => mockShare(...args),
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

beforeEach(() => {
  jest.clearAllMocks();
  mockSession = { user: { id: 'me' } };
  mockParams = { id: '12345678-1234-1234-1234-123456789abc' };
  mockRouter.canDismiss.mockReturnValue(false);
  mockMembers.mockResolvedValue([{ userId: 'me', name: 'Me', role: 'owner' }]);
  mockRead.mockResolvedValue({ data: { name: 'Family', invite_code: 'ABCD2345', owner_id: 'me' }, error: null });
  mockDelete.mockResolvedValue(undefined);
});

async function render(element: React.ReactElement) {
  const r = createRoot();
  await act(async () => r.render(element));
  return r;
}

test('a signed-out invite retains its code on the sign-in route and never joins automatically', async () => {
  mockSession = null;
  mockParams = { code: 'abcd-2345' };
  const r = await render(<JoinByLink />);
  expect(JSON.stringify(r.container)).toContain('/sign-in');
  expect(JSON.stringify(r.container)).toContain('ABCD2345');
  expect(mockJoin).not.toHaveBeenCalled();
  mockSession = { user: { id: 'me' } };
  await act(async () => r.render(<JoinByLink />));
  expect(JSON.stringify(r.container)).toContain('Join with code ABCD 2345?');
  expect(mockJoin).not.toHaveBeenCalled();
});

test('an inaccessible group redirects with a notice rather than leaking its existence', async () => {
  mockRead.mockResolvedValue({ data: null, error: null });
  await render(<GroupInfo />);
  expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/groups', params: { notice: 'unavailable' } });
  expect(mockRouter.dismissAll).not.toHaveBeenCalled();
});

test('a malformed group link never sends a UUID query to the backend', async () => {
  mockParams = { id: 'bad-id' };
  await render(<GroupInfo />);
  expect(mockRead).not.toHaveBeenCalled();
  expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/groups', params: { notice: 'unavailable' } });
});

test('network failures stay on the group screen with retry instead of reporting removal', async () => {
  mockRead.mockRejectedValue(new Error('network offline'));
  const r = await render(<GroupInfo />);
  expect(mockRouter.replace).not.toHaveBeenCalled();
  expect(JSON.stringify(r.container)).toContain("Couldn't load this group");
  expect(JSON.stringify(r.container)).toContain('Try Again');
});

test.each([false, true])('delete from Group Info checks whether a dismissible stack exists (%s)', async (canDismiss) => {
  mockRouter.canDismiss.mockReturnValue(canDismiss);
  const r = await render(<GroupInfo />);
  const container = r.container as any;
  const button = container.queryAll((n: any) => n.props.onClick && JSON.stringify(n).includes('"Delete Group"'))[0];
  await act(async () => button.props.onClick());
  const buttons = mockAlert.mock.calls[0][2];
  await act(async () => buttons.find((b: { text: string }) => b.text === 'Delete Group').onPress());
  expect(mockDelete).toHaveBeenCalledWith(mockParams.id);
  expect(mockRouter.dismissAll).toHaveBeenCalledTimes(canDismiss ? 1 : 0);
  expect(mockRouter.replace).toHaveBeenCalledWith('/groups');
});

test('join shows all 8 invite code characters and clears a stale error on edit', async () => {
  mockJoin.mockRejectedValue(new Error("That code doesn't match a group"));
  const r = await render(<JoinGroup />);
  const c = r.container as any;
  const input = () => c.queryAll((n: any) => n.props.onChangeText)[0];
  await act(async () => input().props.onChangeText('ABCD2346'));
  expect(JSON.stringify(c)).toContain('"6"'); // 8th box
  expect(input().props.maxLength).toBeUndefined(); // a native maxLength would cut a pasted "ABCD-2346" before normalizing
  await act(async () => input().props.onSubmitEditing());
  expect(JSON.stringify(c)).toContain("That code doesn't match a group");
  await act(async () => input().props.onChangeText('ABCD234'));
  expect(JSON.stringify(c)).not.toContain("That code doesn't match a group");
});

test('Done on the group name field saves the rename, dismisses the keyboard and confirms', async () => {
  const dismiss = jest.spyOn(Keyboard, 'dismiss');
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
  mockRename.mockResolvedValue(undefined);
  const r = await render(<GroupInfo />);
  const c = r.container as any;
  const input = () => c.queryAll((n: any) => n.props.onSubmitEditing)[0];
  await act(async () => input().props.onChangeText('Family 2'));
  await act(async () => input().props.onSubmitEditing());
  expect(mockRename).toHaveBeenCalledWith(mockParams.id, 'Family 2');
  expect(dismiss).toHaveBeenCalled();
  expect(announce).toHaveBeenCalledWith('Group name saved');
  expect(JSON.stringify(c)).toContain('"Saved"');
  act(() => r.unmount()); // the 2s "Saved" timer must not outlive the test
});


test('sharing uses labeled switches, blocks repeated writes and restores state on failure', async () => {
  let reject: (e: Error) => void = () => {};
  mockShare.mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
  const r = await render(<GroupInfo />);
  const c = r.container as any;
  const toggle = () => c.queryAll((n: any) => n.props.accessibilityLabel === 'Share sleep with this group' && n.props.onChange)[0];
  const change = toggle().props.onChange;
  await act(async () => { change({ nativeEvent: { value: true } }); change({ nativeEvent: { value: false } }); });
  expect(mockShare).toHaveBeenCalledTimes(1);
  expect(mockShare).toHaveBeenCalledWith(mockParams.id, 'sleep', true);
  expect(JSON.stringify(c)).toContain('Saving sharing choice');
  await act(async () => reject(new Error('Could not save sharing')));
  expect(JSON.stringify(c)).toContain('Could not save sharing');
  expect(toggle().props.value).toBe(false);
  await act(async () => r.unmount());
});
