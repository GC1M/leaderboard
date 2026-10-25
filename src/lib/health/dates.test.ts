import { lastNDates, localDateKey, startOfLocalDay } from './dates';

describe('localDateKey', () => {
  it('uses local fields, not UTC', () => {
    expect(localDateKey(new Date(2026, 0, 5, 23, 59, 59))).toBe('2026-01-05');
    expect(localDateKey(new Date(2026, 0, 5, 0, 0, 1))).toBe('2026-01-05');
  });
  it('pads month and day', () => {
    expect(localDateKey(new Date(2026, 2, 3))).toBe('2026-03-03');
  });
});

describe('lastNDates', () => {
  it('returns 7 days oldest first ending today', () => {
    expect(lastNDates(7, new Date(2026, 9, 25, 12))).toEqual([
      '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25',
    ]);
  });
  it('just after midnight is the new day', () => {
    expect(lastNDates(2, new Date(2026, 0, 1, 0, 0, 5))).toEqual(['2025-12-31', '2026-01-01']);
  });
  it('crosses month and year boundaries', () => {
    expect(lastNDates(3, new Date(2026, 0, 1, 0, 0, 5))).toEqual(['2025-12-30', '2025-12-31', '2026-01-01']);
  });
  it('handles a leap day', () => {
    expect(lastNDates(2, new Date(2028, 2, 1))).toEqual(['2028-02-29', '2028-03-01']);
  });
  it('stays sequential across US DST changes (23h and 25h days)', () => {
    expect(lastNDates(3, new Date(2026, 2, 9, 0, 30))).toEqual(['2026-03-07', '2026-03-08', '2026-03-09']);
    expect(lastNDates(3, new Date(2026, 10, 2, 0, 30))).toEqual(['2026-10-31', '2026-11-01', '2026-11-02']);
  });
});

describe('startOfLocalDay', () => {
  it('returns local midnight', () => {
    const d = startOfLocalDay(new Date(2026, 9, 25, 17, 30), 2);
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 9, 23, 0]);
  });
});
