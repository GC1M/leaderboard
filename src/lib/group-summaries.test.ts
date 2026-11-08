import { buildMemberSummaries, foodText, sleepText, waterText, weightText, workoutsText } from './group-summaries';

const members = [
  { userId: 'a', name: 'Ann' },
  { userId: 'b', name: 'Bo' },
  { userId: 'c', name: 'Cy' },
];
const now = new Date(2026, 9, 26, 12);

describe('buildMemberSummaries', () => {
  const out = buildMemberSummaries(
    members,
    { a: ['sleep', 'weight'], b: ['sleep', 'weight'], c: ['steps'] },
    [
      { user_id: 'a', date: '2026-10-24', minutes: 400 },
      { user_id: 'a', date: '2026-10-25', minutes: 0 },
    ],
    [{ user_id: 'a', measured_on: '2026-10-19', kg: 70 }],
  );
  it('takes the latest sleep date and keeps a recorded zero as a value', () => {
    expect(out[0].sleep).toEqual({ state: 'recorded', value: 0, date: '2026-10-25' });
  });
  it('shared but never synced is no data', () => {
    expect(out[1].sleep).toEqual({ state: 'no_data' });
    expect(out[1].weight).toEqual({ state: 'no_data' });
  });
  it('an unshared metric is not shared even if readings exist', () => {
    const o = buildMemberSummaries(
      members,
      { c: ['steps'] },
      [{ user_id: 'c', date: '2026-10-25', minutes: 300 }],
      [{ user_id: 'c', measured_on: '2026-10-25', kg: 80 }],
    );
    expect(o[2].sleep).toEqual({ state: 'not_shared' });
    expect(o[2].weight).toEqual({ state: 'not_shared' });
  });
});

describe('text', () => {
  it('shows value with a date label, stale dates included', () => {
    expect(sleepText({ state: 'recorded', value: 440, date: '2026-10-26' }, now)).toBe('7h 20m, Today');
    expect(sleepText({ state: 'recorded', value: 0, date: '2026-10-25' }, now)).toBe('0m, Yesterday');
    expect(weightText({ state: 'recorded', value: 70, date: '2026-10-19' }, 'kg', now)).toBe('70.0 kg, Oct 19');
    expect(weightText({ state: 'recorded', value: 70, date: '2026-10-19' }, 'lb', now)).toBe('154.3 lb, Oct 19');
  });
  it('states without a value', () => {
    expect(sleepText({ state: 'no_data' }, now)).toBe('No data');
    expect(weightText({ state: 'not_shared' }, 'kg', now)).toBe('Not shared');
  });
});

describe('workouts', () => {
  const week = (user_id: string, week_start: string, workout_count: number, total_duration_s: number) => ({ user_id, week_start, workout_count, total_duration_s });
  const out = buildMemberSummaries(
    members,
    { a: ['workouts'], b: ['workouts'], c: ['steps'] },
    [],
    [],
    [week('a', '2026-10-12', 2, 3600), week('a', '2026-10-26', 3, 7800), week('c', '2026-10-26', 1, 1800)],
  );
  it('takes the latest week and keeps count and total time', () => {
    expect(out[0].workouts).toEqual({ state: 'recorded', count: 3, durationS: 7800, weekStart: '2026-10-26' });
  });
  it('shared but nothing in the window is no data', () => {
    expect(out[1].workouts).toEqual({ state: 'no_data' });
  });
  it('an unshared member is not shared even if rows were returned', () => {
    expect(out[2].workouts).toEqual({ state: 'not_shared' });
  });
  it('numbers that arrive as strings are converted', () => {
    const o = buildMemberSummaries(members, { a: ['workouts'] }, [], [], [{ user_id: 'a', week_start: '2026-10-26', workout_count: '2', total_duration_s: '5400.000000' } as never]);
    expect(o[0].workouts).toEqual({ state: 'recorded', count: 2, durationS: 5400, weekStart: '2026-10-26' });
  });
  it('text', () => {
    expect(workoutsText({ state: 'recorded', count: 3, durationS: 7800, weekStart: '2026-10-26' }, now)).toBe('3 workouts, 2h 10m, this week');
    expect(workoutsText({ state: 'recorded', count: 1, durationS: 1800, weekStart: '2026-10-12' }, now)).toBe('1 workout, 30m, week of oct 12');
    expect(workoutsText({ state: 'no_data' }, now)).toBe('No recent workouts');
    expect(workoutsText({ state: 'not_shared' }, now)).toBe('Not shared');
  });
});

describe('food', () => {
  const day = (user_id: string, local_date: string, kcal: number | null, o: Partial<Record<'protein_g' | 'carbs_g' | 'fat_g', number | null>> = {}, incomplete = false) => ({
    user_id, local_date, energy_kcal: kcal, protein_g: o.protein_g ?? null, carbs_g: o.carbs_g ?? null, fat_g: o.fat_g ?? null,
    energy_kcal_incomplete: incomplete, protein_g_incomplete: false, carbs_g_incomplete: false, fat_g_incomplete: false,
  });
  const out = buildMemberSummaries(
    members,
    { a: ['food'], b: ['food'], c: ['steps'] },
    [],
    [],
    [],
    [day('a', '2026-10-24', 900), day('a', '2026-10-26', 1850.4, { protein_g: 80.26, carbs_g: 0, fat_g: 60 }, true), day('c', '2026-10-26', 500)],
  );
  it('takes the latest day and keeps a recorded zero', () => {
    expect(out[0].food).toMatchObject({ state: 'recorded', date: '2026-10-26', energy: { value: 1850.4, incomplete: true }, carbs: { value: 0 } });
  });
  it('shared with no entries is no data, and an unshared member is not shared even with entries', () => {
    expect(out[1].food).toEqual({ state: 'no_data' });
    expect(out[2].food).toEqual({ state: 'not_shared' });
  });
  it('is not shared when no food rows were passed in', () => {
    expect(buildMemberSummaries(members, { a: ['food'] }, [], [])[0].food).toEqual({ state: 'no_data' });
  });
  it('formats totals, lower bounds and unknowns, and never shows no food as 0', () => {
    expect(foodText(out[0].food, now)).toBe('at least 1,850 kcal, protein 80.3 g, carbs 0 g, fat 60 g, today');
    expect(foodText({ state: 'no_data' }, now)).toBe('No food logged this week');
    expect(foodText({ state: 'not_shared' }, now)).toBe('Not shared');
    const none = { value: null, incomplete: true };
    expect(foodText({ state: 'recorded', date: '2026-10-25', energy: none, protein: none, carbs: none, fat: none }, now)).toBe('Logged, amounts unknown, yesterday');
  });
});

describe('water', () => {
  const day = (user_id: string, local_date: string, total_ml: number) => ({ user_id, local_date, total_ml });
  const out = buildMemberSummaries(
    members,
    { a: ['water'], b: ['water'], c: ['food'] },
    [], [], [], [],
    [day('a', '2026-10-24', 900), day('a', '2026-10-26', 1500), day('c', '2026-10-26', 2000)],
  );
  it('takes the latest day per member', () => {
    expect(out[0].water).toEqual({ state: 'recorded', value: 1500, date: '2026-10-26' });
  });
  it('shared with no entries is no data, and unshared is not shared even with rows', () => {
    expect(out[1].water).toEqual({ state: 'no_data' });
    expect(out[2].water).toEqual({ state: 'not_shared' });
  });
  it('formats in the viewer unit and never shows no water as 0', () => {
    expect(waterText(out[0].water, 'ml', now)).toBe('1.5 L, today');
    expect(waterText({ state: 'recorded', value: 473.2, date: '2026-10-25' }, 'floz', now)).toBe('16 fl oz, yesterday');
    expect(waterText({ state: 'no_data' }, 'ml', now)).toBe('No water logged this week');
    expect(waterText({ state: 'not_shared' }, 'ml', now)).toBe('Not shared');
  });
});
