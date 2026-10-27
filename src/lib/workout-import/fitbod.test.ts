import { previewImport } from '.';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));

// Local noon-ish times written with the device's own offset, so the day grouping doesn't depend on the test machine.
const at = (d: Date) => {
  const off = -d.getTimezoneOffset();
  const pad = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:00 ${off >= 0 ? '+' : '-'}${pad(off / 60)}${pad(off % 60)}`;
};
const t = (day: number, h: number, m: number) => at(new Date(2024, 2, day, h, m));

const CSV = [
  'Date,Exercise,Reps,Weight(kg),Duration(s),Distance(m),Incline,Resistance,isWarmup,Note,multiplier',
  `${t(2, 18, 0)},Barbell Squat,10,40,0,0,0,0,true,,1`,
  `${t(2, 18, 4)},Barbell Squat,5,100,0,0,0,0,false,felt heavy,1`,
  `${t(2, 18, 40)},Dumbbell Bench Press,8,30,0,0,0,0,false,,2`,
  `${t(2, 18, 55)},Running,0,0,600,1600,0,0,false,,1`,
  `${t(4, 7, 0)},Plank,0,0,0,0,0,0,false,,1`,
  `${t(4, 7, 5)},Pull Up,12,0,0,0,0,0,false,,1`,
].join('\n');

describe('Fitbod import', () => {
  it('groups a day of sets into one workout spanning first to last set', () => {
    const p = previewImport(CSV, { weight: 'lb', distance: 'mi' });
    expect(p.format.app).toBe('fitbod');
    expect(p.unitsInFile).toBe(true);
    expect(p.workouts).toHaveLength(2);
    const [a, b] = p.workouts;
    expect(a).toMatchObject({ name: 'Fitbod Workout', startedAt: new Date(2024, 2, 2, 18, 0), endedAt: new Date(2024, 2, 2, 18, 55), durationS: 3300 });
    expect(a.exercises.map((e) => e.name)).toEqual(['Barbell Squat', 'Dumbbell Bench Press', 'Running']);
    expect(a.exercises[0]).toMatchObject({ notes: 'felt heavy\nWarm-up: set 1', sets: [{ reps: 10, loadKg: 40 }, { reps: 5, loadKg: 100 }] });
    expect(a.exercises[2]).toMatchObject({ category: 'cardio', sets: [{ reps: null, loadKg: null, durationS: 600, distanceM: 1600 }] });
    expect(b).toMatchObject({ durationS: null, endedAt: b.startedAt, exercises: [{ name: 'Pull Up', sets: [{ reps: 12, loadKg: null }] }] });
    expect(p.skipped).toEqual([{ row: 6, reason: 'no reps, weight, time or distance' }]);
  });

  it('keeps the same key for a day when a newer export repeats it', () => {
    const older = previewImport(CSV.split('\n').slice(0, 4).join('\n'), { weight: 'kg', distance: 'km' });
    expect(older.workouts[0].key).toBe(previewImport(CSV, { weight: 'kg', distance: 'km' }).workouts[0].key);
  });
});
