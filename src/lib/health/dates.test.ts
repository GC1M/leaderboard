import { formatLocalDateTime, lastNDates, parseLocalDateTime, localDateKey, readingDateLabel, startOfLocalDay, weekStartKey } from './dates';

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

describe('readingDateLabel', () => {
  const now = new Date(2026, 9, 26, 9);
  it('names today and yesterday by local day', () => {
    expect(readingDateLabel(new Date(2026, 9, 26, 0, 5), now)).toBe('Today');
    expect(readingDateLabel(new Date(2026, 9, 25, 23, 59), now)).toBe('Yesterday');
  });
  it('dates older readings, with the year when it differs', () => {
    expect(readingDateLabel(new Date(2026, 9, 19, 7), now)).toBe('Oct 19');
    expect(readingDateLabel(new Date(2025, 11, 31, 7), now)).toBe('Dec 31, 2025');
  });
});

describe('local date-time text', () => {
  it('round-trips and rejects impossible dates', () => {
    const d = new Date(2026, 9, 25, 7, 5);
    expect(formatLocalDateTime(d)).toBe('2026-10-25 07:05');
    expect(parseLocalDateTime('2026-10-25 07:05')).toEqual(d);
    expect(parseLocalDateTime('2026-02-30 07:05')).toBeNull();
    expect(parseLocalDateTime('tomorrow')).toBeNull();
  });
});

describe('weekStartKey', () => {
  it('is the Monday of the local week, Sunday included', () => {
    expect(weekStartKey(new Date(2026, 9, 26, 12))).toBe('2026-10-26'); // Monday
    expect(weekStartKey(new Date(2026, 9, 25, 23, 59))).toBe('2026-10-19'); // Sunday
    expect(weekStartKey(new Date(2026, 9, 28))).toBe('2026-10-26');
  });
  it('steps back whole weeks across month, year and DST changes', () => {
    expect(weekStartKey(new Date(2026, 9, 26), 1)).toBe('2026-10-19');
    expect(weekStartKey(new Date(2026, 0, 1), 0)).toBe('2025-12-29');
    expect(weekStartKey(new Date(2026, 2, 9), 1)).toBe('2026-03-02');
    expect(weekStartKey(new Date(2026, 10, 2), 1)).toBe('2026-10-26');
  });
});
