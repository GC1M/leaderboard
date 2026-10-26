import {
  createCustomExercise,
  createManualWorkout,
  deleteWorkout,
  getWorkout,
  listExercises,
  updateManualWorkout,
  type ManualWorkoutInput,
} from './workouts';

type Result = { data?: unknown; error?: unknown };
const results: Record<string, Result> = {};
const calls: { table: string; op: string; arg?: unknown }[] = [];
const mockGetUser = jest.fn();

// Every builder method records itself and returns the chain; awaiting the chain resolves the table's canned result.
function mockChainFor(table: string, op: string) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  for (const m of ['eq', 'order', 'limit', 'select']) chain[m] = self;
  chain.single = () => Promise.resolve(results[`${table}.${op}`] ?? { data: null, error: null });
  chain.maybeSingle = chain.single;
  chain.then = (res: (r: Result) => unknown, rej: (e: unknown) => unknown) =>
    Promise.resolve(results[`${table}.${op}`] ?? { data: [], error: null }).then(res, rej);
  return chain;
}

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: () => mockGetUser() },
    from: (table: string) => {
      const start = (op: string) => (arg?: unknown) => {
        calls.push({ table, op, arg });
        return mockChainFor(table, op);
      };
      return { select: start('select'), insert: start('insert'), update: start('update'), delete: start('delete') };
    },
  },
}));

const input: ManualWorkoutInput = {
  activityType: ' strength ',
  startedAt: new Date('2026-10-26T15:00:00Z'),
  endedAt: new Date('2026-10-26T16:00:00Z'),
  timezone: 'America/Chicago',
  exercises: [
    { exerciseId: 'ex1', sets: [{ reps: 5, loadKg: 100 }, { reps: 0, loadKg: 0 }] },
    { exerciseId: 'ex2', sets: [{ durationS: 600, distanceM: 2000 }] },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  calls.length = 0;
  for (const k of Object.keys(results)) delete results[k];
  mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
});

describe('createManualWorkout', () => {
  it('saves a manual workout, then exercises and sets in order, leaving unknown fields null', async () => {
    results['workouts.insert'] = { data: { id: 'w1' }, error: null };
    results['workout_exercises.insert'] = { data: [{ id: 'we2', position: 1 }, { id: 'we1', position: 0 }], error: null };
    await expect(createManualWorkout(input)).resolves.toBe('w1');
    expect(calls[0].arg).toMatchObject({ user_id: 'u1', source: 'manual', activity_type: 'strength', distance_m: null, energy_kcal: null, notes: null });
    expect(calls[1].arg).toEqual([
      { workout_id: 'w1', exercise_id: 'ex1', position: 0, notes: null },
      { workout_id: 'w1', exercise_id: 'ex2', position: 1, notes: null },
    ]);
    const sets = calls[2].arg as { workout_exercise_id: string; position: number; reps: number | null; load_kg: number | null }[];
    expect(sets.map((s) => [s.workout_exercise_id, s.position, s.reps, s.load_kg])).toEqual([
      ['we1', 0, 5, 100],
      ['we1', 1, 0, 0],
      ['we2', 0, null, null],
    ]);
  });

  it('rejects an empty set and a backwards time range before hitting the database', async () => {
    await expect(createManualWorkout({ ...input, exercises: [{ exerciseId: 'ex1', sets: [{}] }] })).rejects.toThrow(/Each set/);
    await expect(createManualWorkout({ ...input, endedAt: new Date('2026-10-26T14:00:00Z') })).rejects.toThrow(/cannot end before/);
    expect(calls).toHaveLength(0);
  });

  it('removes the workout if its exercises fail to save', async () => {
    results['workouts.insert'] = { data: { id: 'w1' }, error: null };
    results['workout_exercises.insert'] = { data: null, error: { code: '23503' } };
    await expect(createManualWorkout(input)).rejects.toThrow(/Couldn't save/);
    expect(calls.at(-1)).toMatchObject({ table: 'workouts', op: 'delete' });
  });

  it('requires a signed-in user', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    await expect(createManualWorkout(input)).rejects.toThrow(/Sign in/);
  });
});

describe('updateManualWorkout', () => {
  it('does not touch exercises when the workout is not a manual one of the user', async () => {
    results['workouts.update'] = { data: [], error: null };
    await expect(updateManualWorkout('w1', input)).rejects.toThrow(/Couldn't save/);
    expect(calls.map((c) => c.table + '.' + c.op)).toEqual(['workouts.update']);
  });

  it('replaces the exercises and sets', async () => {
    results['workouts.update'] = { data: [{ id: 'w1' }], error: null };
    results['workout_exercises.insert'] = { data: [{ id: 'we1', position: 0 }, { id: 'we2', position: 1 }], error: null };
    await updateManualWorkout('w1', input);
    expect(calls.map((c) => c.table + '.' + c.op)).toEqual(['workouts.update', 'workout_exercises.delete', 'workout_exercises.insert', 'workout_sets.insert']);
  });
});

describe('getWorkout', () => {
  it('orders exercises and sets by position and flattens the exercise name', async () => {
    results['workouts.select'] = {
      data: {
        id: 'w1',
        source: 'manual',
        workout_exercises: [
          { id: 'we2', exercise_id: 'ex2', position: 1, notes: null, exercises: { name: 'Running' }, workout_sets: [] },
          {
            id: 'we1',
            exercise_id: 'ex1',
            position: 0,
            notes: 'heavy',
            exercises: { name: 'Deadlift' },
            workout_sets: [{ id: 's2', position: 1 }, { id: 's1', position: 0 }],
          },
        ],
      },
      error: null,
    };
    const w = await getWorkout('w1');
    expect(w?.exercises.map((e) => e.name)).toEqual(['Deadlift', 'Running']);
    expect(w?.exercises[0].sets.map((s) => s.id)).toEqual(['s1', 's2']);
    expect(w).not.toHaveProperty('workout_exercises');
  });

  it('returns null when the workout is not visible', async () => {
    results['workouts.select'] = { data: null, error: null };
    await expect(getWorkout('nope')).resolves.toBeNull();
  });
});

describe('deleteWorkout', () => {
  it('maps a failure to a friendly message', async () => {
    results['workouts.delete'] = { error: { message: 'boom: secret' } };
    await expect(deleteWorkout('w1')).rejects.toThrow(/Couldn't delete/);
  });
});

describe('exercises', () => {
  it('lists the catalog and flags custom rows', async () => {
    results['exercises.select'] = {
      data: [
        { id: 'a', user_id: null, name: 'Deadlift', category: 'strength' },
        { id: 'b', user_id: 'u1', name: 'Sled Push', category: 'strength' },
      ],
      error: null,
    };
    expect((await listExercises()).map((e) => e.isCustom)).toEqual([false, true]);
  });

  it('validates the name and maps a duplicate', async () => {
    await expect(createCustomExercise('   ', 'strength')).rejects.toThrow(/1 to 80/);
    results['exercises.insert'] = { data: null, error: { code: '23505' } };
    await expect(createCustomExercise('Sled Push', 'strength')).rejects.toThrow(/already have/);
  });

  it('creates a trimmed custom exercise', async () => {
    results['exercises.insert'] = { data: { id: 'x', name: 'Sled Push', category: 'strength' }, error: null };
    await expect(createCustomExercise(' Sled Push ', 'strength')).resolves.toEqual({ id: 'x', name: 'Sled Push', category: 'strength', isCustom: true });
    expect(calls[0].arg).toEqual({ user_id: 'u1', name: 'Sled Push', category: 'strength' });
  });
});
