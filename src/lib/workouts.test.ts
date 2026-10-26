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
const mockRpc = jest.fn();

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
    rpc: (...a: unknown[]) => mockRpc(...a),
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
  it('sends one RPC with ordered exercises and sets, leaving unknown fields null', async () => {
    mockRpc.mockResolvedValue({ data: 'w1', error: null });
    await expect(createManualWorkout(input)).resolves.toBe('w1');
    expect(mockRpc).toHaveBeenCalledTimes(1);
    const [name, args] = mockRpc.mock.calls[0];
    expect(name).toBe('save_manual_workout');
    expect(args.p_id).toBeNull();
    expect(args.p_workout).toMatchObject({ activity_type: 'strength', distance_m: null, energy_kcal: null, notes: null });
    expect(args.p_workout.exercises).toEqual([
      { exercise_id: 'ex1', notes: null, sets: [{ reps: 5, load_kg: 100, duration_s: null, distance_m: null }, { reps: 0, load_kg: 0, duration_s: null, distance_m: null }] },
      { exercise_id: 'ex2', notes: null, sets: [{ reps: null, load_kg: null, duration_s: 600, distance_m: 2000 }] },
    ]);
  });

  it('rejects an empty set and a backwards time range before hitting the database', async () => {
    await expect(createManualWorkout({ ...input, exercises: [{ exerciseId: 'ex1', sets: [{}] }] })).rejects.toThrow(/Each set/);
    await expect(createManualWorkout({ ...input, endedAt: new Date('2026-10-26T14:00:00Z') })).rejects.toThrow(/cannot end before/);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('maps a failure to a friendly message', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '23503', message: 'secret' } });
    await expect(createManualWorkout(input)).rejects.toThrow(/Couldn't save/);
  });

  it('requires a signed-in user', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    await expect(createManualWorkout(input)).rejects.toThrow(/Sign in/);
  });
});

describe('updateManualWorkout', () => {
  it('passes the id to the same RPC', async () => {
    mockRpc.mockResolvedValue({ data: 'w1', error: null });
    await updateManualWorkout('w1', input);
    expect(mockRpc).toHaveBeenCalledWith('save_manual_workout', expect.objectContaining({ p_id: 'w1' }));
  });

  it('fails when the workout is not a manual one of the user', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'workout not found' } });
    await expect(updateManualWorkout('w1', input)).rejects.toThrow(/Couldn't save/);
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
