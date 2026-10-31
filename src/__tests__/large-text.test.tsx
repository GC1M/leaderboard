import { act } from 'react';
import { StyleSheet } from 'react-native';
import { createRoot } from 'test-renderer';

import GroupDetail from '@/app/(tabs)/groups/[id]';
import { Row } from '@/components/ui';

let mockFontScale = 1;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 390, height: 844, scale: 3, fontScale: mockFontScale }),
}));
const mockRouter = { replace: jest.fn(), push: jest.fn(), back: jest.fn(), canGoBack: () => true };
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    useSegments: () => [],
    useLocalSearchParams: () => ({ id: '12345678-1234-1234-1234-123456789abc' }),
    useRouter: () => mockRouter,
    useFocusEffect: (cb: () => void) => useEffect(cb, [cb]),
  };
});
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ session: { user: { id: 'me' } }, loading: false }) }));
jest.mock('@/lib/weight-unit', () => ({ useWeightUnit: () => ['kg', jest.fn()] }));
jest.mock('@/lib/supabase', () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { name: 'Bob Cod Club' }, error: null }) }) }) }) },
}));
jest.mock('@/lib/groups', () => ({
  ...jest.requireActual('@/lib/groups'),
  listMembers: () => Promise.resolve([]),
  getGroupShares: () => Promise.resolve([]),
  getGroupSleep: () => Promise.resolve([]),
  getGroupWeights: () => Promise.resolve([]),
  getGroupWorkouts: () => Promise.resolve([]),
}));
jest.mock('@/lib/leaderboard', () => ({
  ...jest.requireActual('@/lib/leaderboard'),
  getLeaderboard: () =>
    Promise.resolve([
      { userId: 'a', name: 'Alice', value: 900, rank: 1, state: 'recorded' },
      { userId: 'me', name: 'Me', value: 500, rank: 2, state: 'recorded' },
    ]),
  getManualDays: () => Promise.resolve({}),
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

let root: ReturnType<typeof createRoot>;
// Unmount so VirtualizedList's batching timer doesn't fire after the test.
afterEach(() => act(() => root.unmount()));

async function render(el: React.ReactElement) {
  const r = (root = createRoot());
  await act(async () => r.render(el));
  return r.container as any;
}

const texts = (c: any, s: string) => c.queryAll((n: any) => n.type === 'Text' && JSON.stringify(n.props.children).includes(s));

describe('group leaderboard', () => {
  const setup = async () => {
    const c = await render(<GroupDetail />);
    const scroll = c.queryAll((n: any) => n.type === 'RCTScrollView')[0];
    const title = texts(c, 'Bob Cod Club')[0];
    return { c, scroll, title };
  };

  test('the title block scrolls with the list and the header wraps', async () => {
    const { c, scroll, title } = await setup();
    expect(scroll.queryAll((n: any) => n === title)).toHaveLength(1);
    expect(texts(scroll, 'This Week')).toHaveLength(1);
    expect(texts(scroll, ' member')).toHaveLength(1);
    const header = c.queryAll((n: any) => n.type === 'View' && StyleSheet.flatten(n.props.style)?.flexWrap === 'wrap');
    expect(header.some((h: any) => texts(h, 'Group Info').length)).toBe(true);
    expect(title.props.numberOfLines).toBe(2);
  });

  test('at accessibility sizes the title is not cut and the You bar is capped', async () => {
    mockFontScale = 3.1;
    const { c, scroll, title } = await setup();
    expect(title.props.numberOfLines).toBeUndefined();
    // Report only Alice's row on screen so the "You" shortcut appears.
    const flat = c.queryAll((n: any) => n.props.onViewableItemsChanged)[0];
    await act(async () => flat.props.onViewableItemsChanged({ viewableItems: [{ item: { userId: 'a' } }] }));
    const bar = texts(c, 'You: ')[0];
    expect(bar.props.maxFontSizeMultiplier).toBe(1.5);
    expect(scroll.queryAll((n: any) => n === bar)).toHaveLength(0);
    mockFontScale = 1;
  });

  test('member names truncate at default size and wrap at accessibility sizes', async () => {
    expect(texts((await setup()).c, 'Alice')[0].props.numberOfLines).toBe(1);
    act(() => root.unmount());
    mockFontScale = 3.1;
    expect(texts((await setup()).c, 'Alice')[0].props.numberOfLines).toBeUndefined();
    mockFontScale = 1;
  });
});

describe('list row', () => {
  test('truncates to one line at default size', async () => {
    const c = await render(<Row label="Share Invite Link" value="Steps Shared" />);
    expect(texts(c, 'Share Invite Link')[0].props.numberOfLines).toBe(1);
    expect(texts(c, 'Steps Shared')[0].props.numberOfLines).toBe(1);
    expect(JSON.stringify(c)).not.toContain('"flexDirection":"column"');
  });

  test('wraps and stacks the value under the label at accessibility sizes', async () => {
    mockFontScale = 2;
    const c = await render(<Row label="Share Invite Link" value="Steps Shared" />);
    expect(texts(c, 'Share Invite Link')[0].props.numberOfLines).toBeUndefined();
    expect(texts(c, 'Steps Shared')[0].props.numberOfLines).toBeUndefined();
    expect(JSON.stringify(c)).toContain('"flexDirection":"column"');
    mockFontScale = 1;
  });
});
