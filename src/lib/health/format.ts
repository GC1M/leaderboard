import { displayWeight } from './weight';

export const RANGES = [7, 30, 90] as const;
export type Range = (typeof RANGES)[number];
export type WeightUnit = 'kg' | 'lb';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

// "7h 20m", "45m". Whole minutes, so 119.6 never prints as "1h 60m".
export function formatSleep(minutes: number): string {
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  return h ? `${h}h ${total % 60}m` : `${total}m`;
}

export const formatWeight = (kg: number, unit: WeightUnit) => `${displayWeight(kg, unit).toFixed(1)} ${unit}`;

// No stored preference yet: pounds where the device region is the US, kilograms elsewhere.
export function defaultWeightUnit(locale: string | undefined): WeightUnit {
  const region = locale?.split(/[-_]/).find((p) => /^[A-Za-z]{2}$/.test(p) && p === p.toUpperCase());
  return region === 'US' ? 'lb' : 'kg';
}

// 'YYYY-MM-DD' as a local date (new Date('YYYY-MM-DD') is UTC midnight and can land on the day before).
export function dateFromKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// One sentence describing a bar chart, shown under it and used as its accessibility label. Days without a
// value are not zeros: the average is over recorded days only, and says how many.
export function barSummary(
  dates: string[],
  values: (number | null)[],
  fmt: (v: number) => string,
  noun: string,
  now: Date,
  label: (d: Date, now: Date) => string,
): string {
  const recorded = values.filter((v): v is number => v !== null);
  if (!recorded.length) return `Last ${dates.length} days: no ${noun} recorded`;
  const average = recorded.reduce((a, b) => a + b, 0) / recorded.length;
  const max = Math.max(...recorded);
  const missing = dates.length - recorded.length;
  return `Last ${dates.length} days: average ${fmt(average)} over ${plural(recorded.length, 'day')} with data${missing ? `, ${missing} without` : ''}. Best ${fmt(max)}, ${label(dateFromKey(dates[values.indexOf(max)]), now)}`;
}

// Place readings by their real time: x is 0 at `from` and 1 at `to`, y is 0 at the lowest weight and 1 at the highest.
export function weightPoints(readings: readonly { kg: number; measuredAt: string }[], from: Date, to: Date) {
  const span = to.getTime() - from.getTime();
  const inRange = readings.filter((r) => {
    const t = Date.parse(r.measuredAt);
    return t >= from.getTime() && t <= to.getTime();
  });
  const kgs = inRange.map((r) => r.kg);
  const min = Math.min(...kgs);
  const max = Math.max(...kgs);
  return {
    min,
    max,
    points: inRange.map((r) => ({
      kg: r.kg,
      x: (Date.parse(r.measuredAt) - from.getTime()) / span,
      y: max === min ? 0.5 : (r.kg - min) / (max - min),
    })),
  };
}
