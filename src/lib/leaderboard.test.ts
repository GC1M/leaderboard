import { formatValue, getManualDays, hasNoData, myStanding, periodRange, rankLabels, sourceLabel, type LeaderboardRow } from './leaderboard';

const mockRpc = jest.fn();
jest.mock('./supabase', () => ({ supabase: { rpc: (...a: unknown[]) => mockRpc(...a) } }));

const row = (userId: string, value: number, rank: number): LeaderboardRow => ({ userId, name: userId, value, rank });

test('formatValue per metric', () => {
  expect(formatValue('steps', 12345)).toBe('12,345');
  expect(formatValue('workout_minutes', 45)).toBe('45 min');
  expect(formatValue('weight_kg', 61.6)).toBe('62%');
});

test('hasNoData is true only for zero', () => {
  expect(hasNoData(row('a', 0, 3))).toBe(true);
  expect(hasNoData(row('a', 1, 1))).toBe(false);
});

test('rankLabels marks ties and no-data', () => {
  const rows = [row('a', 9000, 1), row('b', 5000, 2), row('c', 5000, 2), row('d', 0, 4), row('e', 0, 4)];
  expect(rankLabels(rows)).toEqual(['1', 'T2', 'T2', '-', '-']);
});

test('periodRange: today, and Monday to Sunday for the week', () => {
  const sun = new Date(2026, 9, 25, 23, 30); // Sunday
  expect(periodRange('day', sun)).toEqual({ from: '2026-10-25', to: '2026-10-25' });
  expect(periodRange('week', sun)).toEqual({ from: '2026-10-19', to: '2026-10-25' });
  expect(periodRange('week', new Date(2026, 9, 19, 0, 5))).toEqual({ from: '2026-10-19', to: '2026-10-25' }); // Monday
  expect(periodRange('week', new Date(2026, 10, 1))).toEqual({ from: '2026-10-26', to: '2026-11-01' }); // across months
});

test('sourceLabel', () => {
  expect(sourceLabel('day', 0, true)).toEqual({ text: 'Not synced yet', manual: false });
  expect(sourceLabel('day', 0, false)).toEqual({ text: 'Health', manual: false });
  expect(sourceLabel('day', 1, false)).toEqual({ text: 'Manual', manual: true });
  expect(sourceLabel('week', 2, false)).toEqual({ text: '2 of 7 days manual', manual: true });
});

test('myStanding', () => {
  const rows = [row('a', 9000, 1), row('b', 5000, 2), row('c', 5000, 2), row('d', 0, 4)];
  expect(myStanding(rows, 'c')).toEqual({ rankLabel: 'T2', members: 4, value: 5000, leader: 9000 });
  expect(myStanding(rows, 'd')).toEqual({ rankLabel: '-', members: 4, value: 0, leader: 9000 });
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
