import { formatValue, getLeaderboard, getManualDays, hasNoData, myStanding, periodRange, rankLabels, sourceLabel, type LeaderboardRow } from './leaderboard';

const mockRpc = jest.fn();
jest.mock('./supabase', () => ({ supabase: { rpc: (...a: unknown[]) => mockRpc(...a) } }));

const row = (userId: string, value: number | null, rank: number): LeaderboardRow => ({
  userId, name: userId, value, rank, state: value === null ? 'no_data' : 'recorded',
});

test('formatValue per metric', () => {
  expect(formatValue('steps', 12345)).toBe('12,345');
  expect(formatValue('workout_minutes', 45)).toBe('45 min');
  expect(formatValue('weight_kg', 61.6)).toBe('62%');
});

test('hasNoData is true only without a value; a recorded zero is data', () => {
  expect(hasNoData(row('a', null, 3))).toBe(true);
  expect(hasNoData(row('a', 0, 2))).toBe(false);
  expect(hasNoData(row('a', 1, 1))).toBe(false);
});

test('getLeaderboard keeps null values and the row state', async () => {
  mockRpc.mockResolvedValue({
    data: [
      { user_id: 'a', display_name: 'A', value: '0', rank: '1', state: 'recorded' },
      { user_id: 'b', display_name: 'B', value: null, rank: '2', state: 'not_shared' },
    ],
    error: null,
  });
  expect(await getLeaderboard('g', 'steps', 'day')).toEqual([
    { userId: 'a', name: 'A', value: 0, rank: 1, state: 'recorded' },
    { userId: 'b', name: 'B', value: null, rank: 2, state: 'not_shared' },
  ]);
});

test('rankLabels marks ties and no-data', () => {
  const rows = [row('a', 9000, 1), row('b', 5000, 2), row('c', 5000, 2), row('d', 0, 4), row('e', null, 5), row('f', null, 5)];
  expect(rankLabels(rows)).toEqual(['1', 'T2', 'T2', '4', '-', '-']);
});

test('periodRange: today, and Monday to Sunday for the week', () => {
  const sun = new Date(2026, 9, 25, 23, 30); // Sunday
  expect(periodRange('day', sun)).toEqual({ from: '2026-10-25', to: '2026-10-25' });
  expect(periodRange('week', sun)).toEqual({ from: '2026-10-19', to: '2026-10-25' });
  expect(periodRange('week', new Date(2026, 9, 19, 0, 5))).toEqual({ from: '2026-10-19', to: '2026-10-25' }); // Monday
  expect(periodRange('week', new Date(2026, 10, 1))).toEqual({ from: '2026-10-26', to: '2026-11-01' }); // across months
});

test('sourceLabel', () => {
  expect(sourceLabel('day', 0, 'no_data')).toEqual({ text: 'No data yet', manual: false });
  expect(sourceLabel('day', 0, 'not_shared')).toEqual({ text: 'Not sharing with this group', manual: false });
  expect(sourceLabel('day', 0, 'recorded')).toEqual({ text: 'Health', manual: false });
  expect(sourceLabel('day', 1, 'recorded')).toEqual({ text: 'Manual', manual: true });
  expect(sourceLabel('week', 2, 'recorded')).toEqual({ text: '2 of 7 days manual', manual: true });
});

test('myStanding', () => {
  const rows = [row('a', 9000, 1), row('b', 5000, 2), row('c', 5000, 2), row('d', 0, 4), row('e', null, 5)];
  expect(myStanding(rows, 'c')).toEqual({ rankLabel: 'T2', members: 5, value: 5000, leader: 9000 });
  expect(myStanding(rows, 'd')).toEqual({ rankLabel: '4', members: 5, value: 0, leader: 9000 });
  expect(myStanding(rows, 'e')).toEqual({ rankLabel: '-', members: 5, value: null, leader: 9000 });
  expect(myStanding(rows, 'zz')).toBeNull();
});

test('getManualDays counts manual days per member from the group-scoped RPC', async () => {
  mockRpc.mockResolvedValue({
    data: [
      { user_id: 'a', source: 'manual' },
      { user_id: 'a', source: 'healthkit' },
      { user_id: 'a', source: 'manual' },
      { user_id: 'b', source: 'healthkit' },
    ],
    error: null,
  });
  expect(await getManualDays('g', 'week')).toEqual({ a: 2 });
  expect(mockRpc).toHaveBeenCalledWith('group_steps', expect.objectContaining({ p_group_id: 'g' }));
});
