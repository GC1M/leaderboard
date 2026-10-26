import { barSummary, defaultWeightUnit, formatSleep, formatWeight, weightPoints } from './format';

describe('formatSleep', () => {
  it('shows hours and minutes', () => {
    expect(formatSleep(440)).toBe('7h 20m');
    expect(formatSleep(420)).toBe('7h 0m');
    expect(formatSleep(45)).toBe('45m');
    expect(formatSleep(0)).toBe('0m');
  });
  it('rounds without printing 60 minutes', () => {
    expect(formatSleep(119.6)).toBe('2h 0m');
  });
});

describe('formatWeight', () => {
  it('converts from kg', () => {
    expect(formatWeight(80, 'kg')).toBe('80.0 kg');
    expect(formatWeight(80, 'lb')).toBe('176.4 lb');
  });
});

describe('defaultWeightUnit', () => {
  it('uses pounds only for a US region', () => {
    expect(defaultWeightUnit('en-US')).toBe('lb');
    expect(defaultWeightUnit('es_US')).toBe('lb');
    expect(defaultWeightUnit('en-GB')).toBe('kg');
    expect(defaultWeightUnit('en')).toBe('kg');
    expect(defaultWeightUnit(undefined)).toBe('kg');
  });
});

describe('weightPoints', () => {
  const from = new Date('2026-10-01T00:00:00Z');
  const to = new Date('2026-10-11T00:00:00Z');
  it('places readings by real time, not by index', () => {
    const { points, min, max } = weightPoints(
      [
        { kg: 80, measuredAt: '2026-10-01T00:00:00Z' },
        { kg: 78, measuredAt: '2026-10-02T00:00:00Z' },
        { kg: 79, measuredAt: '2026-10-11T00:00:00Z' },
      ],
      from,
      to,
    );
    expect(points.map((p) => p.x)).toEqual([0, 0.1, 1]);
    expect(points.map((p) => p.y)).toEqual([1, 0, 0.5]);
    expect([min, max]).toEqual([78, 80]);
  });
  it('drops readings outside the range and centres a single value', () => {
    const { points } = weightPoints([{ kg: 70, measuredAt: '2026-09-01T00:00:00Z' }, { kg: 80, measuredAt: '2026-10-05T00:00:00Z' }], from, to);
    expect(points).toEqual([{ kg: 80, x: 0.4, y: 0.5 }]);
  });
});

describe('barSummary', () => {
  const label = (d: Date) => `d${d.getDate()}`;
  const fmt = (v: number) => `${Math.round(v)} u`;
  const dates = ['2026-10-19', '2026-10-20', '2026-10-21'];
  it('averages recorded days only and says how many', () => {
    expect(barSummary(dates, [100, null, 200], fmt, 'steps', new Date(), label)).toBe(
      'Last 3 days: average 150 u over 2 days with data, 1 without. Best 200 u, d21',
    );
  });
  it('says so when nothing is recorded', () => {
    expect(barSummary(dates, [null, null, null], fmt, 'steps', new Date(), label)).toBe('Last 3 days: no steps recorded');
  });
});
