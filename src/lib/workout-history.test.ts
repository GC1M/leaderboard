import {
  formatSetDuration, historyStart, setText, sourceLabel, totalsParts, weekLabel, weeklyTotals, weeksSummary, workoutSeconds,
} from './workout-history';
import type { Workout } from './workouts';

// Monday 2026-10-26 noon, local.
const now = new Date(2026, 9, 26, 12);

let n = 0;
function w(over: Partial<Workout> & { at: Date; minutes?: number }): Workout {
  const { at, minutes = 30, ...rest } = over;
  return {
    id: `w${++n}`, user_id: 'u', source: 'manual', activity_type: 'Strength', started_at: at.toISOString(),
    ended_at: new Date(at.getTime() + minutes * 60000).toISOString(), timezone: 'UTC', duration_s: minutes * 60,
    distance_m: null, energy_kcal: null, notes: null, health_uuid: null, health_device_id: null, source_app: null, source_key: null, updated_at: at.toISOString(), ...rest,
  };
}

describe('workoutSeconds', () => {
  it('uses the recorded duration, a recorded zero included, else end minus start', () => {
    expect(workoutSeconds(w({ at: now, minutes: 10, duration_s: 90 }))).toBe(90);
    expect(workoutSeconds(w({ at: now, minutes: 10, duration_s: 0 }))).toBe(0);
    expect(workoutSeconds(w({ at: now, minutes: 10, duration_s: null }))).toBe(600);
  });
});

describe('weeklyTotals', () => {
  const rows = [
    w({ at: new Date(2026, 9, 26, 7), minutes: 60 }), // this Monday
    w({ at: new Date(2026, 9, 25, 23, 30), minutes: 45, source: 'healthkit', distance_m: 5000, energy_kcal: 300, duration_s: 2700 }), // Sunday: last week
    w({ at: new Date(2026, 9, 20, 9), minutes: 30, source: 'healthkit', distance_m: 0, duration_s: null }), // last week, recorded zero distance
    w({ at: new Date(2026, 8, 1, 9) }), // before the window
  ];
  const t = weeklyTotals(rows, 3, now);

  it('has one entry per week, oldest first, ending with this week', () => {
    expect(t.map((x) => x.weekStart)).toEqual(['2026-10-12', '2026-10-19', '2026-10-26']);
  });
  it('counts, sums time and splits by source; workouts outside the window are ignored', () => {
    expect(t[2]).toMatchObject({ count: 1, durationS: 3600, manual: 1, imported: 0 });
    expect(t[1]).toMatchObject({ count: 2, durationS: 2700 + 1800, manual: 0, imported: 2 });
    expect(t[0].count).toBe(0);
  });
  it('missing distance and energy stay null, recorded zeros stay values', () => {
    expect(t[2].distanceM).toBeNull();
    expect(t[2].energyKcal).toBeNull();
    expect(t[1]).toMatchObject({ distanceM: 5000, distanceCount: 2, energyKcal: 300, energyCount: 1 });
    expect(weeklyTotals([rows[2]], 1, new Date(2026, 9, 21))[0]).toMatchObject({ distanceM: 0, distanceCount: 1, energyKcal: null });
  });
  it('buckets by the device week: late Sunday is still last week', () => {
    expect(weeklyTotals([w({ at: new Date(2026, 9, 25, 23, 59) })], 2, now).map((x) => x.count)).toEqual([1, 0]);
  });
});

describe('totalsParts', () => {
  const [, last, current] = weeklyTotals(
    [
      w({ at: new Date(2026, 9, 26, 7), minutes: 60 }),
      w({ at: new Date(2026, 9, 21, 7), minutes: 45, source: 'healthkit', distance_m: 5000, energy_kcal: 300 }),
      w({ at: new Date(2026, 9, 22, 7), minutes: 30, source: 'healthkit', distance_m: 10000 }),
    ],
    3,
    now,
  );
  it('is empty for a week with nothing', () => {
    expect(totalsParts(weeklyTotals([], 1, now)[0], 'km')).toEqual([]);
  });
  it('leaves out distance and energy nobody recorded', () => {
    expect(totalsParts(current, 'km')).toEqual(['1 workout', '1h 0m']);
  });
  it('says how many workouts a total covers when only some recorded it', () => {
    expect(totalsParts(last, 'km')).toEqual(['2 workouts', '1h 15m', '15 km', '300 kcal (1 of 2)']);
    expect(totalsParts(last, 'mi')[2]).toBe('9.32 mi');
  });
});

describe('labels', () => {
  it('names the current and previous week, then dates', () => {
    expect(weekLabel('2026-10-26', now)).toBe('This week');
    expect(weekLabel('2026-10-19', now)).toBe('Last week');
    expect(weekLabel('2026-10-05', now)).toBe('Week of Oct 5');
    expect(weekLabel('2025-12-29', now)).toBe('Week of Dec 29, 2025');
  });
  it('summarises weeks with workouts and does not count empty weeks as zeros', () => {
    const t = weeklyTotals([w({ at: new Date(2026, 9, 26, 7) }), w({ at: new Date(2026, 9, 27, 7) }), w({ at: new Date(2026, 9, 14, 7) })], 4, now);
    expect(weeksSummary(t, now)).toBe('Last 4 weeks: 3 workouts over 2 weeks with workouts, 2 without. Most 2 workouts, this week');
    expect(weeksSummary(weeklyTotals([], 4, now), now)).toBe('Last 4 weeks: no workouts recorded');
  });
  it('labels sources', () => {
    expect(sourceLabel({ source: 'healthkit', source_app: null })).toBe('Apple Health');
    expect(sourceLabel({ source: 'manual', source_app: null })).toBe('Manual');
    expect(sourceLabel({ source: 'import', source_app: 'strong' })).toBe('Strong');
    expect(sourceLabel({ source: 'import', source_app: 'jefit' })).toBe('JEFIT');
  });
  it('starts history at the Monday of the oldest week', () => {
    const d = historyStart(4, now);
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 9, 5, 0]);
  });
});

describe('setText', () => {
  const set = { reps: null, load_kg: null, duration_s: null, distance_m: null };
  it('shows only what was recorded', () => {
    expect(setText({ ...set, reps: 5, load_kg: 100 }, 'kg', 'km')).toBe('5 × 100 kg');
    expect(setText({ ...set, reps: 12 }, 'kg', 'km')).toBe('12 reps');
    expect(setText({ ...set, reps: 1 }, 'kg', 'km')).toBe('1 rep');
    expect(setText({ ...set, load_kg: 20 }, 'kg', 'km')).toBe('20 kg');
    expect(setText({ ...set, distance_m: 2500, duration_s: 600 }, 'kg', 'km')).toBe('2.5 km, 10m');
  });
  it('keeps recorded zeros and converts units', () => {
    expect(setText({ ...set, reps: 0, load_kg: 0 }, 'kg', 'km')).toBe('0 × 0 kg');
    expect(setText({ ...set, reps: 5, load_kg: 100 }, 'lb', 'mi')).toBe('5 × 220.5 lb');
  });
  it('is null for an empty set', () => {
    expect(setText(set, 'kg', 'km')).toBeNull();
  });
  it('formats short durations with seconds', () => {
    expect(formatSetDuration(45)).toBe('45s');
    expect(formatSetDuration(90)).toBe('1m 30s');
    expect(formatSetDuration(3900)).toBe('1h 5m');
  });
});
