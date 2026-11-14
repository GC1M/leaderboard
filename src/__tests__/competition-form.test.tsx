import { act } from 'react';
import { createRoot } from 'test-renderer';
import NewCompetition from '@/app/(tabs)/groups/[id]/competitions/new';
const mockCreate = jest.fn(); const mockReplace = jest.fn();
let mockParams: { id?: string } = { id: 'g1' };
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: mockReplace, back: jest.fn(), canGoBack: () => true }), useLocalSearchParams: () => mockParams, useSegments: () => [] }));
jest.mock('@/lib/competitions', () => ({ ...jest.requireActual('@/lib/competitions'), createCompetition: (...args: unknown[]) => mockCreate(...args) }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
const mockGroups = jest.fn();
jest.mock('@/lib/groups', () => ({ listMyGroups: () => mockGroups() }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
let root: ReturnType<typeof createRoot>;
afterEach(() => { act(() => root?.unmount()); });
async function render() { root = createRoot(); await act(async () => root.render(<NewCompetition />)); return root.container as any; }
const find = (c: any, label: string, prop: string) => c.queryAll((n: any) => n.props[prop] && n.props.accessibilityLabel === label)[0];
const click = async (c: any, label: string) => act(async () => find(c, label, 'onClick').props.onClick());
const flip = async (c: any, label: string, value: boolean) => act(async () => c.queryAll((n: any) => n.type === 'RCTSwitch' && n.props.accessibilityLabel === label)[0].props.onChange({ nativeEvent: { value } }));
beforeEach(() => { jest.clearAllMocks(); mockParams = { id: 'g1' }; mockCreate.mockResolvedValue('c1'); mockGroups.mockResolvedValue([{ id: 'g1', name: 'Family' }, { id: 'g2', name: 'Work' }]); });
test('metric chips, late joins, scoring and manual entries reach the server; the default is a steps total', async () => {
  const c = await render();
  expect(find(c, 'Steps', 'onClick').props.accessibilityState.selected).toBe(true);
  expect(find(c, 'Water days', 'onClick').props.accessibilityState.selected).toBe(false);
  await act(async () => find(c, 'Name', 'onChangeText').props.onChangeText('Spring streak'));
  await click(c, 'Create competition');
  expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ groupId: 'g1', name: 'Spring streak', metric: 'steps', scoring: 'total', lateJoins: false, includeManual: false }));
  await click(c, 'Active days'); await click(c, 'Best streak');
  await flip(c, 'Late joins', true); await flip(c, 'Count manual entries', true);
  expect(find(c, 'Active days', 'onClick').props.accessibilityState.selected).toBe(true);
  expect(find(c, 'Steps', 'onClick').props.accessibilityState.selected).toBe(false);
  await click(c, 'Create competition');
  expect(mockCreate).toHaveBeenLastCalledWith(expect.objectContaining({ metric: 'active_days', scoring: 'best_streak', lateJoins: true, includeManual: true }));
  expect(mockCreate.mock.calls[1][0].endDay > mockCreate.mock.calls[1][0].firstDay).toBe(true);
  // Relative to the form's own directory: the group's stack, whether it was opened from Social or Summary.
  expect(mockReplace).toHaveBeenCalledWith('../c1', { relativeToDirectory: true });
});
test('from the Compete tab the form asks for a group, then opens the competition in Compete', async () => {
  mockParams = {};
  const c = await render();
  expect(mockGroups).toHaveBeenCalled();
  await act(async () => find(c, 'Name', 'onChangeText').props.onChangeText('Any group'));
  await click(c, 'Create competition');
  expect(mockCreate).not.toHaveBeenCalled(); expect(JSON.stringify(c)).toContain('Choose a group.');
  await click(c, 'Work');
  await click(c, 'Create competition');
  expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ groupId: 'g2', name: 'Any group' }));
  expect(mockReplace).toHaveBeenCalledWith('/compete/g2/c1');
});
test('with no groups the form says so instead of offering a create button that can only fail', async () => {
  mockParams = {}; mockGroups.mockResolvedValue([]);
  const c = await render();
  expect(JSON.stringify(c)).toContain('Create or join one in Social first');
  expect(find(c, 'Create competition', 'onClick').props.accessibilityState.disabled).toBe(true);
});
test('a name is required and server errors are shown', async () => {
  const c = await render();
  await click(c, 'Create competition');
  expect(mockCreate).not.toHaveBeenCalled(); expect(JSON.stringify(c)).toContain('Give the competition a name.');
  mockCreate.mockRejectedValue(new Error('the start day can be at most 90 days ago'));
  await act(async () => find(c, 'Name', 'onChangeText').props.onChangeText('Old'));
  await click(c, 'Create competition');
  expect(JSON.stringify(c)).toContain('the start day can be at most 90 days ago');
  expect(JSON.stringify(c)).toContain('Past days are scored from imported history');
});
