import { weekStats } from './WeekChart';

test('missing days are left out of the average; recorded zeros count', () => {
  expect(weekStats([null, 1000, 0, null, 2000, null, null])).toEqual({ total: 3000, days: 3, average: 1000, max: 2000 });
  expect(weekStats([null, null])).toEqual({ total: 0, days: 0, average: null, max: 0 });
  expect(weekStats([0, 0])).toEqual({ total: 0, days: 2, average: 0, max: 0 });
});
