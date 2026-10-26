const pad = (n: number) => String(n).padStart(2, '0');

// Local calendar date as YYYY-MM-DD. Never use toISOString(): it converts to UTC and shifts the day near midnight.
export function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Local midnight of the day `daysAgo` days before `now`. Calendar arithmetic (not 24h * n ms) so DST days of 23/25 hours are right.
export function startOfLocalDay(now: Date, daysAgo = 0): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo);
}

// Oldest first, ending with today.
export function lastNDates(days: number, now: Date = new Date()): string[] {
  return Array.from({ length: days }, (_, i) => localDateKey(startOfLocalDay(now, days - 1 - i)));
}

// When a reading was taken, in local days: "Today", "Yesterday", or the date. A latest weight from last
// week must say so, not pass for today's.
export function readingDateLabel(at: Date, now: Date = new Date()): string {
  const key = localDateKey(at);
  if (key === localDateKey(now)) return 'Today';
  if (key === localDateKey(startOfLocalDay(now, 1))) return 'Yesterday';
  return at.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', ...(at.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}
