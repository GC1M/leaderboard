import { act } from 'react';
import { createRoot } from 'test-renderer';

import Chat from '@/app/(tabs)/groups/chat';
import Social from '@/app/(tabs)/groups/index';
import CompetitionDetail from '@/app/(tabs)/groups/[id]/competitions/[competitionId]';

const GID = '12345678-1234-1234-1234-123456789abc';
const BOB = '22222222-2222-2222-2222-222222222222';
const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true, setParams: jest.fn() };
let mockParams: Record<string, string> = {};
const mockAlert = jest.fn();
const mockSocial = {
  listFriends: jest.fn(), acceptFriendRequest: jest.fn(), removeFriend: jest.fn(),
  listMessages: jest.fn(), sendMessage: jest.fn(), threadTitle: jest.fn(), watchThread: jest.fn(),
};
const mockCompetitions = { getCompetition: jest.fn(), getParticipation: jest.fn() };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  useFocusEffect: (cb: () => void) => require('react').useEffect(cb, [cb]),
  useSegments: () => [],
}));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ session: { user: { id: 'me' } } }) }));
jest.mock('@/lib/alert', () => ({ alert: (...a: unknown[]) => mockAlert(...a) }));
jest.mock('@/lib/groups', () => ({ ...jest.requireActual('@/lib/groups'), listMyGroups: () => Promise.resolve([{ id: GID, name: 'Family', role: 'owner', memberCount: 2 }]) }));
jest.mock('@/lib/social', () => {
  const actual = jest.requireActual('@/lib/social');
  const wrap = (k: keyof typeof mockSocial) => (...a: unknown[]) => mockSocial[k](...a);
  const keys = ['listFriends', 'acceptFriendRequest', 'removeFriend', 'listMessages', 'sendMessage', 'threadTitle', 'watchThread'] as const;
  return { ...actual, ...Object.fromEntries(keys.map((k) => [k, wrap(k)])) };
});
jest.mock('@/lib/competitions', () => ({
  ...jest.requireActual('@/lib/competitions'),
  getCompetition: (...a: unknown[]) => mockCompetitions.getCompetition(...a),
  getParticipation: (...a: unknown[]) => mockCompetitions.getParticipation(...a),
  getCompetitionStandings: () => Promise.resolve([]),
  getCompetitionDailyValues: () => Promise.resolve([]),
  getMyContributions: () => Promise.resolve(null),
}));
jest.mock('@/components/competitions/Integrity', () => ({ CompetitionIntegrity: () => null, confirmFinalize: jest.fn() }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  mockSocial.listFriends.mockResolvedValue([
    { userId: BOB, name: 'Bob', status: 'incoming' },
    { userId: 'c', name: 'Cat', status: 'friend' },
  ]);
  mockSocial.acceptFriendRequest.mockResolvedValue(undefined);
  mockSocial.listMessages.mockResolvedValue([
    { id: 'm2', senderId: 'me', senderName: 'Me', body: 'on my way', createdAt: '2026-11-12T10:01:00Z' },
    { id: 'm1', senderId: BOB, senderName: 'Bob', body: 'walk at 6?', createdAt: '2026-11-12T10:00:00Z' },
  ]);
  mockSocial.sendMessage.mockResolvedValue(undefined);
  mockSocial.threadTitle.mockResolvedValue('Family');
  mockSocial.watchThread.mockReturnValue(jest.fn());
});

async function render(el: React.ReactElement) {
  const r = createRoot();
  await act(async () => r.render(el));
  return r;
}
// Element-valued props (refreshControl, ListEmptyComponent) make the tree circular, so read the text nodes instead.
const textOf = (n: any): string => (typeof n === 'string' ? n : (n.children ?? []).map(textOf).join(' '));
const byLabel = (r: any, label: string) => r.container.queryAll((n: any) => n.props.accessibilityLabel === label && n.props.onClick)[0];

test('Social lists groups and friends, and an incoming request can be accepted', async () => {
  const r = await render(<Social />);
  const text = textOf(r.container);
  expect(text).toContain('Social');
  expect(text).toContain('Family');
  expect(text).toContain('Wants to be friends');
  await act(async () => byLabel(r, 'Cat, Message').props.onClick());
  expect(mockRouter.push).toHaveBeenCalledWith('/groups/chat?friend=c');
  await act(async () => byLabel(r, 'Bob, Wants to be friends').props.onClick());
  const accept = mockAlert.mock.calls[0][2].find((b: { text: string }) => b.text === 'Accept');
  await act(async () => accept.onPress());
  expect(mockSocial.acceptFriendRequest).toHaveBeenCalledWith(BOB);
  expect(mockSocial.listFriends).toHaveBeenCalledTimes(2); // reloaded after accepting
});

test('Chat shows the thread, sends a trimmed draft and reloads, and stops watching on unmount', async () => {
  mockParams = { group: GID };
  const r = await render(<Chat />);
  const text = textOf(r.container);
  expect(text).toContain('walk at 6?');
  expect(text).toContain('Family');
  expect(mockSocial.watchThread).toHaveBeenCalledWith({ kind: 'group', id: GID }, 'me', expect.any(Function));
  const input = (r.container as any).queryAll((n: any) => n.props.onChangeText)[0];
  await act(async () => input.props.onChangeText('see you there'));
  await act(async () => byLabel(r, 'Send').props.onClick());
  expect(mockSocial.sendMessage).toHaveBeenCalledWith({ kind: 'group', id: GID }, 'see you there');
  expect(mockSocial.listMessages).toHaveBeenCalledTimes(2);
  const stop = mockSocial.watchThread.mock.results[0].value;
  await act(async () => r.unmount());
  expect(stop).toHaveBeenCalled();
});

test('Chat with a malformed id never queries', async () => {
  mockParams = { friend: 'not-a-uuid' };
  const r = await render(<Chat />);
  expect(textOf(r.container)).toContain('This chat is unavailable.');
  expect(mockSocial.listMessages).not.toHaveBeenCalled();
});

test.each([['joined', true], ['left', false]])('competition chat button for a %s participant: %s', async (status, shown) => {
  mockParams = { id: GID, competitionId: BOB };
  const now = Date.now();
  mockCompetitions.getCompetition.mockResolvedValue({
    id: BOB, group_id: GID, name: 'Race', metric: 'steps', scoring: 'total', status: 'scheduled', late_joins: false, include_manual: false,
    starts_at: new Date(now + 86_400_000).toISOString(), ends_at: new Date(now + 3 * 86_400_000).toISOString(), timezone: 'UTC', scoring_version: 1, creator_id: 'me',
  });
  mockCompetitions.getParticipation.mockResolvedValue({ status });
  const r = await render(<CompetitionDetail />);
  const button = byLabel(r, 'Competition Chat');
  expect(!!button).toBe(shown);
  if (button) {
    await act(async () => button.props.onClick());
    expect(mockRouter.push).toHaveBeenCalledWith(`/groups/chat?competition=${BOB}`, { withAnchor: true });
  }
  await act(async () => r.unmount());
});
