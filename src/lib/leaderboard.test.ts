import { formatValue, hasNoData, rankLabels, type LeaderboardRow } from './leaderboard';

jest.mock('./supabase', () => ({ supabase: {} }));

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
