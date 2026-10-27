import { previewImport } from '.';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));

const KG = [
  '"title","start_time","end_time","description","exercise_title","superset_id","exercise_notes","set_index","set_type","weight_kg","reps","distance_km","duration_seconds","rpe"',
  '"Upper A","26 Oct 2024, 18:05","26 Oct 2024, 19:10","Shoulder ok","Bench Press (Barbell)",,"Pause reps","0","warmup","40","10",,,',
  '"Upper A","26 Oct 2024, 18:05","26 Oct 2024, 19:10","Shoulder ok","Bench Press (Barbell)",,"Pause reps","1","normal","80","5",,,"8"',
  '"Upper A","26 Oct 2024, 18:05","26 Oct 2024, 19:10","Shoulder ok","Bench Press (Barbell)",,"Pause reps","2","dropset","60","8",,,',
  '"Upper A","26 Oct 2024, 18:05","26 Oct 2024, 19:10","Shoulder ok","Pull Up",,,"0","failure","0","9",,,',
  '"Upper A","26 Oct 2024, 18:05","26 Oct 2024, 19:10","Shoulder ok","Plank",,,"0","normal",,,,"60",',
  '"Upper A","26 Oct 2024, 18:05","26 Oct 2024, 19:10","Shoulder ok","Plank",,,"1","normal",,,,,',
  '"Run","27 Oct 2024, 07:00","27 Oct 2024, 07:30","","Running",,,"0","normal",,,"5.2","1800",',
].join('\n');

const LBS = [
  'title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_lbs,reps,distance_miles,duration_seconds,rpe',
  'Legs,2024-10-28T06:00:00,2024-10-28T07:00:00,,Squat (Barbell),,,0,normal,225,5,,,',
  'Legs,2024-10-28T06:00:00,2024-10-28T07:00:00,,Treadmill,,,0,normal,,,1,600,',
].join('\n');

describe('Hevy import', () => {
  it('reads workouts with their real end time, sets in order, markers in the notes', () => {
    const p = previewImport(KG, { weight: 'lb', distance: 'mi' });
    expect(p.format.app).toBe('hevy');
    expect(p.unitsInFile).toBe(true);
    const [upper, run] = p.workouts;
    expect(upper).toMatchObject({ name: 'Upper A', notes: 'Shoulder ok', durationS: 3900, startedAt: new Date(2024, 9, 26, 18, 5), endedAt: new Date(2024, 9, 26, 19, 10) });
    expect(upper.exercises.map((e) => e.name)).toEqual(['Bench Press (Barbell)', 'Pull Up', 'Plank']);
    expect(upper.exercises[0].sets.map((s) => s.loadKg)).toEqual([40, 80, 60]);
    expect(upper.exercises[0].notes).toBe('Pause reps\nWarm-up: set 1\nDrop set: set 3');
    expect(upper.exercises[1]).toMatchObject({ notes: 'Failure: set 1', sets: [{ reps: 9, loadKg: 0, durationS: null, distanceM: null }] });
    expect(upper.exercises[2]).toMatchObject({ category: 'cardio', sets: [{ reps: null, loadKg: null, durationS: 60, distanceM: null }] });
    expect(run.exercises[0].sets[0]).toEqual({ reps: null, loadKg: null, durationS: 1800, distanceM: 5200 });
    expect(p.skipped).toEqual([{ row: 7, reason: 'no reps, weight, time or distance' }]);
  });

  it('reads pound and mile columns', () => {
    const p = previewImport(LBS, { weight: 'kg', distance: 'km' });
    expect(p.workouts[0].exercises[0].sets[0].loadKg).toBeCloseTo(102.06, 2);
    expect(p.workouts[0].exercises[1].sets[0].distanceM).toBeCloseTo(1609.344, 3);
  });
});
