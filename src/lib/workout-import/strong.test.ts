import { previewImport } from '.';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));

const kgKm = { weight: 'kg', distance: 'km' } as const;

// Older layout: semicolons, quoted, "1h 5m" durations, no units, 0 in unused columns, W/D/F set markers and a rest
// timer row, two exercises out of order (Bench, Row, Bench again stays three entries).
const OLD = [
  'Date;Workout Name;Duration;Exercise Name;Set Order;Weight;Reps;Distance;Seconds;Notes;Workout Notes;RPE',
  '"2024-03-02 18:30:00";"Push";"1h 5m";"Bench Press (Barbell)";"W";"40";"10";"0";"0";"";"Good day";""',
  '"2024-03-02 18:30:00";"Push";"1h 5m";"Bench Press (Barbell)";"1";"62,5";"5";"0";"0";"paused";"Good day";"8"',
  '"2024-03-02 18:30:00";"Push";"1h 5m";"Bench Press (Barbell)";"Rest Timer";"0";"0";"0";"90";"";"Good day";""',
  '"2024-03-02 18:30:00";"Push";"1h 5m";"Bench Press (Barbell)";"D";"50";"8";"0";"0";"";"Good day";""',
  '"2024-03-02 18:30:00";"Push";"1h 5m";"Push Up";"1";"0";"20";"0";"0";"";"Good day";""',
  '"2024-03-02 18:30:00";"Push";"1h 5m";"Bench Press (Barbell)";"F";"60";"3";"0";"0";"";"Good day";""',
  '"2024-03-04 07:00:00";"Run";"30m";"Running";"1";"0";"0";"5";"1800";"";"";""',
  '"not a date";"Run";"30m";"Running";"1";"0";"0";"5";"1800";"";"";""',
  '"2024-03-05 07:00:00";"Empty";"30m";"Running";"1";"0";"0";"0";"0";"";"";""',
].join('\n');

// Newer layout: commas, units in the header, duration in seconds.
const NEW = [
  'Workout #,Date,Workout Name,Duration (sec),Exercise Name,Set Order,Weight (lbs),Reps,RPE,Distance (meters),Seconds,Notes,Workout Notes',
  '12,2024-05-01 06:15:00,Legs,3600,Squat (Barbell),1,225,5,,0,0,,',
  '12,2024-05-01 06:15:00,Legs,3600,Squat (Barbell),2,225,5,,0,0,,',
  '13,2024-05-03 06:15:00,Row,1200,Rowing (Machine),1,0,0,,2000,480,,',
].join('\r\n');

describe('Strong import', () => {
  it('reads the older layout: workouts, ordered exercises and sets, markers and notes kept', () => {
    const p = previewImport(OLD, kgKm);
    expect(p.format.app).toBe('strong');
    expect(p.unitsInFile).toBe(false);
    expect(p.workouts.map((w) => w.name)).toEqual(['Push', 'Run']);
    const [push, run] = p.workouts;
    expect(push.startedAt).toEqual(new Date(2024, 2, 2, 18, 30));
    expect(push.durationS).toBe(3900);
    expect(push.endedAt).toEqual(new Date(2024, 2, 2, 19, 35));
    expect(push.notes).toBe('Good day');
    expect(push.exercises.map((e) => e.name)).toEqual(['Bench Press (Barbell)', 'Push Up', 'Bench Press (Barbell)']);
    expect(push.exercises[0].sets).toEqual([
      { reps: 10, loadKg: 40, durationS: null, distanceM: null },
      { reps: 5, loadKg: 62.5, durationS: null, distanceM: null },
      { reps: 8, loadKg: 50, durationS: null, distanceM: null },
    ]);
    expect(push.exercises[0].notes).toBe('paused\nWarm-up: set 1\nDrop set: set 3');
    expect(push.exercises[1].sets).toEqual([{ reps: 20, loadKg: null, durationS: null, distanceM: null }]);
    expect(push.exercises[2].notes).toBe('Failure: set 1');
    expect(run.exercises[0]).toMatchObject({ category: 'cardio', sets: [{ reps: null, loadKg: null, durationS: 1800, distanceM: 5000 }] });
    expect(p.skipped).toEqual([
      { row: 9, reason: 'a date that could not be read' },
      { row: 10, reason: 'no reps, weight, time or distance' },
    ]);
    expect(p.sets).toBe(6);
  });

  it('uses the picked units when the file has none', () => {
    const p = previewImport(OLD, { weight: 'lb', distance: 'mi' });
    expect(p.workouts[0].exercises[0].sets[0].loadKg).toBeCloseTo(18.144, 3);
    expect(p.workouts[1].exercises[0].sets[0].distanceM).toBeCloseTo(8046.72, 2);
  });

  it('reads the newer layout with units in the header, whatever the picked units', () => {
    const p = previewImport(NEW, kgKm);
    expect(p.unitsInFile).toBe(true);
    expect(p.workouts).toHaveLength(2);
    expect(p.workouts[0].exercises[0].sets[0].loadKg).toBeCloseTo(102.06, 2);
    expect(p.workouts[0].durationS).toBe(3600);
    expect(p.workouts[1].exercises[0].sets[0]).toEqual({ reps: null, loadKg: null, durationS: 480, distanceM: 2000 });
  });

  it('keys each workout by start time and name, the same across exports', () => {
    const a = previewImport(OLD, kgKm).workouts[0].key;
    const b = previewImport(OLD.split('\n').slice(0, 3).join('\n'), kgKm).workouts[0].key;
    expect(a).toBe(b);
    expect(a).toBe(`${new Date(2024, 2, 2, 18, 30).toISOString()}|Push`);
  });
});
