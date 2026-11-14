import { competitionHighlights, dayGrid, dayWinners } from './competitions';
jest.mock('./supabase', () => ({ supabase: {} }));

const days = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14'];
const standings = [
  { user_id: 'maya', display_name: 'Maya', rank: 1, score: 6100 },
  { user_id: 'me', display_name: 'Sam', rank: 2, score: 5900 },
  { user_id: 'theo', display_name: 'Theo', rank: 3, score: 3000 },
  { user_id: 'hidden', display_name: 'Pri', rank: null, score: null },
];
const values = (user_id: string, list: (number | null)[]) => list.flatMap((value, i) => (value === null ? [] : [{ user_id, day: days[i], value }]));
const steps = [
  ...values('maya', [1000, 1200, 900, 1000, 1000, 1000]),
  ...values('me', [500, 600, 1200, 1300, 1400, 900]),
  ...values('theo', [800, null, 0, 700, 600, 900]),
];

test('the grid keeps standing order, drops unranked members and marks missing days', () => {
  const grid = dayGrid(days, steps, standings);
  expect(grid.map((r) => r.user_id)).toEqual(['maya', 'me', 'theo']);
  expect(grid[2].cells).toEqual([800, null, 0, 700, 600, 900]);
});

test('each day is won by its biggest value, ties share it, and an all-zero day has no winner', () => {
  const grid = dayGrid(days, steps, standings);
  expect(dayWinners(grid, 6)).toEqual([['maya'], ['maya'], ['me'], ['me'], ['me'], ['maya']]);
  const flat = dayGrid(['d'], [{ user_id: 'maya', day: 'd', value: 0 }, { user_id: 'me', day: 'd', value: 0 }], standings);
  expect(dayWinners(flat, 1)).toEqual([[]]);
});

test('amount highlights: biggest day, days won, streak, most improved, steadiest and the closest battle', () => {
  const grid = dayGrid(days, steps, standings);
  const h = Object.fromEntries(competitionHighlights(grid, days, true, 'steps', 'total', standings).map((x) => [x.key, x]));
  expect(h.biggest.who).toEqual(['me']); expect(h.biggest.detail).toMatch(/^1,400 steps on /);
  expect(h.wins).toMatchObject({ who: ['maya', 'me'], detail: '3 of 6 days' });
  expect(h.streak).toMatchObject({ who: ['maya', 'me'], detail: '6 days in a row with steps' });
  // Finished days only (today is live): Sam went from 550 a day (days 1-2) to 1,300 (days 3-5).
  expect(h.improved).toMatchObject({ who: ['me'], detail: '+750 steps a day lately' });
  expect(h.steady.who).toEqual(['maya']);
  expect(h.battle).toMatchObject({ who: ['maya', 'me'], detail: '200 steps apart' });
  expect(h.perfect).toBeUndefined();
});

test('on/off metrics get streaks and perfect records, never amounts', () => {
  const water = [...values('maya', [1, 1, 1, 1, 1, 0]), ...values('me', [1, 0, 1, 1, 1, 1])];
  const two = standings.slice(0, 2);
  const keys = competitionHighlights(dayGrid(days, water, two), days, true, 'water_days_on_target', 'total', two);
  expect(keys.map((k) => k.key)).toEqual(['streak', 'perfect']);
  expect(keys[1]).toMatchObject({ who: ['maya'], detail: 'Every finished day on target' });
  expect(keys[0].detail).toBe('5 days in a row on target');
});

test('nothing to say without at least two racers', () => {
  expect(competitionHighlights(dayGrid(days, steps, standings.slice(0, 1)), days, true, 'steps', 'total', standings.slice(0, 1))).toEqual([]);
});
