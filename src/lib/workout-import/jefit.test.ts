import { previewImport } from '.';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));

const start = Date.UTC(2026, 9, 20, 17, 0) / 1000;
const file = (mass: string) => [
  '### SETTING ##########',
  'mass,length',
  `"${mass}"," cm"`,
  '######################',
  '### WORKOUT SESSIONS ##########',
  '_id,day_id,starttime,endtime,total_time,total_weight',
  `7,3,${start},${start + 3600},3600,5000`,
  '######################',
  '### EXERCISE LOGS ##########',
  '_id,belongsession,eid,belongSys,ename,mydate,logs,record',
  '1,7,12,1,"Barbell Bench Press",2026-10-20,"40x8,",50',
  '2,7,12,1,"Barbell Bench Press",2026-10-20,"40x8,60x5,",70',
  '3,7,30,1,"Pull-Up",2026-10-20,"0x10,",0',
  '4,7,12,1,"Barbell Bench Press",2026-10-20,"40x8,60x5,60x4,",70',
  '5,7,99,1,"Treadmill",2026-10-20,"0x0.0,0x0,",0',
  '6,,12,1,"",2026-10-22,"50x5,",60',
  '7,,12,1,"Bench Press (Barbell)",2026-10-25,"55x5,",62',
  '######################',
].join('\n');

describe('JEFIT import', () => {
  it('reads sessions, collapses the cumulative log rows, and uses the file unit', () => {
    const p = previewImport(file(' lb'), { weight: 'kg', distance: 'km' });
    expect(p.format.app).toBe('jefit');
    expect(p.unitsInFile).toBe(true);
    expect(p.workouts).toHaveLength(3);
    const [a, b, c] = p.workouts;
    expect(a).toMatchObject({ startedAt: new Date(start * 1000), endedAt: new Date((start + 3600) * 1000), durationS: 3600 });
    // Bench rows 1, 2 and 4 are one growing snapshot, even with the pull-ups saved in between.
    expect(a.exercises.map((e) => e.name)).toEqual(['Bench Press (Barbell)', 'Pull-Up']);
    expect(a.exercises[0].sets.map((s) => [s.reps, Number(s.loadKg?.toFixed(2))])).toEqual([[8, 18.14], [5, 27.22], [4, 27.22]]);
    expect(a.exercises[1].sets).toEqual([{ reps: 10, loadKg: null, durationS: null, distanceM: null }]);
    expect(b).toMatchObject({ startedAt: new Date(2026, 9, 22), durationS: null, exercises: [{ name: 'Bench Press (Barbell)' }] });
    expect(c.startedAt).toEqual(new Date(2026, 9, 25));
    expect(p.skipped).toEqual([{ row: 15, reason: 'no sets with reps' }]);
  });

  it('asks for the unit when the file has no setting', () => {
    const noSetting = file(' lb').split('\n').slice(4).join('\n');
    const p = previewImport(noSetting, { weight: 'kg', distance: 'km' });
    expect(p.unitsInFile).toBe(false);
    expect(p.workouts[0].exercises[0].sets[0].loadKg).toBe(40);
  });
});
