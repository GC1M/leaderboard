import {
  buildWorkout, convertUnits, defaultDistanceUnit, emptyForm, emptySet, filterExercises, formFromDetail, parseDraft, serializeDraft,
  workoutSummary, type WorkoutForm,
} from './workout-form';
import type { Workout, WorkoutDetail } from './workouts';

const base = (over: Partial<WorkoutForm> = {}): WorkoutForm => ({
  ...emptyForm(new Date(2026, 9, 26, 18, 30), 'kg', 'km'),
  activityType: 'Strength',
  durationMin: '45',
  ...over,
});
const squat = (set: Partial<ReturnType<typeof emptySet>>) => ({ exerciseId: 'e1', name: 'Squat', category: 'strength' as const, sets: [{ ...emptySet(), ...set }] });
const fail = (f: WorkoutForm) => {
  const r = buildWorkout(f);
  if (r.ok) throw new Error('expected failure');
  return r.message;
};

test('builds canonical units from display units', () => {
  const r = buildWorkout(base({ weightUnit: 'lb', distanceUnit: 'mi', exercises: [squat({ reps: '5', load: '225', distance: '1' })] }));
  if (!r.ok) throw new Error(r.message);
  const set = r.input.exercises[0].sets[0];
  expect(set.reps).toBe(5);
  expect(set.loadKg).toBeCloseTo(102.058, 2);
  expect(set.distanceM).toBeCloseTo(1609.344, 3);
  expect(r.input.durationS).toBe(2700);
  expect(r.input.endedAt.getTime() - r.input.startedAt.getTime()).toBe(2700000);
  expect(r.input.startedAt).toEqual(new Date(2026, 9, 26, 18, 30));
  expect(r.input.energyKcal).toBeUndefined();
});

test('a recorded zero stays zero and blank stays null', () => {
  const r = buildWorkout(base({ exercises: [squat({ reps: '8', load: '0' })] }));
  if (!r.ok) throw new Error(r.message);
  expect(r.input.exercises[0].sets[0]).toEqual({ reps: 8, loadKg: 0, durationS: null, distanceM: null });
});

test('rejects bad values with a clear message', () => {
  expect(fail(base({ activityType: ' ' }))).toMatch(/activity type/);
  expect(fail(base({ durationMin: '' }))).toMatch(/how long/);
  expect(fail(base({ durationMin: '-5' }))).toBe("Duration can't be negative.");
  expect(fail(base({ durationMin: '0' }))).toMatch(/more than zero/);
  expect(fail(base({ durationMin: 'abc' }))).toBe('Duration must be a number.');
  expect(fail(base({ durationMin: 'NaN' }))).toBe('Duration must be a number.');
  expect(fail(base({ durationMin: 'Infinity' }))).toBe('Duration must be a number.');
  expect(fail(base({ durationMin: '1441' }))).toMatch(/24 hours/);
  expect(fail(base({ date: '2099-01-01' }))).toMatch(/future/);
  expect(fail(base({ date: '2026-02-30' }))).toMatch(/does not exist/);
  expect(fail(base({ time: '25:00' }))).toMatch(/does not exist/);
  expect(fail(base({ time: 'noon' }))).toMatch(/HH:MM/);
  expect(fail(base({ exercises: [squat({ reps: '-1' })] }))).toBe("Squat set 1 reps can't be negative.");
  expect(fail(base({ exercises: [squat({ reps: '2.5' })] }))).toMatch(/whole number/);
  expect(fail(base({ exercises: [squat({ load: '-20' })] }))).toMatch(/negative/);
  expect(fail(base({ exercises: [squat({ load: '1e999' })] }))).toMatch(/number/);
});

test('rejects a set with no values and an exercise with no sets', () => {
  expect(fail(base({ exercises: [squat({})] }))).toBe('Squat set 1 needs reps, load, time, or distance.');
  expect(fail(base({ exercises: [{ ...squat({}), sets: [] }] }))).toMatch(/at least one set/);
});

test('accepts a decimal comma', () => {
  const r = buildWorkout(base({ exercises: [squat({ load: '22,5' })] }));
  if (!r.ok) throw new Error(r.message);
  expect(r.input.exercises[0].sets[0].loadKg).toBe(22.5);
});

test('unit conversion round-trips through storage', () => {
  const lb = convertUnits(base({ exercises: [squat({ load: '100' })] }), 'lb', 'mi');
  expect(Number(lb.exercises[0].sets[0].load)).toBeCloseTo(220.46, 2);
  expect(convertUnits(lb, 'kg', 'km').exercises[0].sets[0].load).toBe('100');
  expect(convertUnits(convertUnits(base({ exercises: [squat({ load: '135' })] }), 'lb', 'km'), 'kg', 'km').exercises[0].sets[0].load).toBe('135');
  const mi = convertUnits(base({ exercises: [{ ...squat({ distance: '5' }), category: 'cardio' }] }), 'kg', 'mi');
  expect(Number(mi.exercises[0].sets[0].distance)).toBeCloseTo(3.11, 2);
  expect(() => convertUnits(base({ exercises: [squat({ load: 'x' })] }), 'lb', 'km')).toThrow('Correct the invalid number');
  expect(Number(convertUnits(base({ exercises: [squat({ load: '22,5' })] }), 'lb', 'km').exercises[0].sets[0].load)).toBeCloseTo(49.6, 2);
  expect(Number(convertUnits(base({ exercises: [squat({ load: '100.' })] }), 'lb', 'km').exercises[0].sets[0].load)).toBeCloseTo(220.46, 2);
});

test('default distance unit follows the region', () => {
  expect(defaultDistanceUnit('en-US')).toBe('mi');
  expect(defaultDistanceUnit('en-GB')).toBe('mi');
  expect(defaultDistanceUnit('de-DE')).toBe('km');
  expect(defaultDistanceUnit(undefined)).toBe('km');
});

test('filters the catalog by name, prefix matches first', () => {
  const ex = ['Bench Press', 'Incline Bench', 'Squat'].map((name, i) => ({ id: String(i), name, category: 'strength' as const, isCustom: false }));
  expect(filterExercises(ex, '').length).toBe(3);
  expect(filterExercises(ex, 'bench').map((e) => e.name)).toEqual(['Bench Press', 'Incline Bench']);
  expect(filterExercises(ex, 'zzz')).toEqual([]);
});

test('draft survives a round trip and bad data is no draft', () => {
  const draft = { editingId: 'w1', form: base({ exercises: [squat({ reps: '5' })] }) };
  expect(parseDraft(serializeDraft(draft))).toEqual(draft);
  expect(parseDraft(serializeDraft({ editingId: null, form: base() }))?.editingId).toBeNull();
  expect(parseDraft(null)).toBeNull();
  expect(parseDraft('not json')).toBeNull();
  expect(parseDraft(JSON.stringify({ v: 2, editingId: null, form: base() }))).toBeNull();
  expect(parseDraft(JSON.stringify({ v: 1, editingId: null, form: { ...base(), exercises: [{ exerciseId: 'x' }] } }))).toBeNull();
  expect(parseDraft(JSON.stringify({ v: 1, editingId: null, form: { ...base(), weightUnit: 'stone' } }))).toBeNull();
});

const row = (over: Partial<Workout>): Workout => ({
  id: 'w', user_id: 'u', source: 'manual', activity_type: 'Run', started_at: '2026-10-26T10:00:00Z', ended_at: '2026-10-26T10:30:00Z',
  timezone: 'UTC', duration_s: null, distance_m: null, energy_kcal: null, notes: null, health_uuid: null, health_device_id: null, updated_at: '', ...over,
} as Workout);

test('summary shows calories only for measured Health values', () => {
  expect(workoutSummary(row({}), 'km')).toBe('30m');
  expect(workoutSummary(row({ distance_m: 5000 }), 'km')).toBe('30m, 5 km');
  expect(workoutSummary(row({ energy_kcal: 250 }), 'km')).toBe('30m');
  expect(workoutSummary(row({ source: 'healthkit', energy_kcal: 250 }), 'km')).toBe('30m, 250 kcal');
  expect(workoutSummary(row({ source: 'healthkit', energy_kcal: null }), 'km')).toBe('30m');
});

test('edit form shows stored canonical values in display units', () => {
  const d = {
    ...row({ duration_s: 2700, notes: 'ok' }),
    exercises: [{ id: 'x', exerciseId: 'e1', name: 'Squat', notes: null, sets: [{ reps: 5, load_kg: 100, duration_s: null, distance_m: null }] }],
  } as unknown as WorkoutDetail;
  const f = formFromDetail(d, 'lb', 'km', new Map([['e1', 'strength']]));
  expect(f.durationMin).toBe('45');
  expect(f.exercises[0].sets[0]).toEqual({ reps: '5', load: '220.46', duration: '', distance: '' });
  expect(f.exercises[0].category).toBe('strength');
});
