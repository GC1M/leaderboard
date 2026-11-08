import { flushLocalLogs } from '@/lib/flush-logs';

jest.mock('@/lib/food/pending', () => ({ flushPending: () => new Promise(() => {}) })); // a request that never answers
jest.mock('@/lib/water/entries', () => ({ waterQueue: { flushPending: async () => 0 } }));

test('a hung flush does not hold up the screen past the wait (#155)', async () => {
  jest.useFakeTimers();
  const done = jest.fn();
  void flushLocalLogs('u1', 3000).then(done);
  await jest.advanceTimersByTimeAsync(3000);
  expect(done).toHaveBeenCalled();
  jest.useRealTimers();
});
