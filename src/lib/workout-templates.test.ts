import {
  createTemplate,
  deleteTemplate,
  duplicateTemplate,
  getTemplate,
  listTemplates,
  type TemplateInput,
  updateTemplate,
} from './workout-templates';

type Result = { data?: unknown; error?: unknown };
const results: Record<string, Result> = {};
const mockGetUser = jest.fn();
const mockRpc = jest.fn();
const mockEq = jest.fn();

// Every builder method returns the chain; awaiting the chain resolves the table's canned result.
function mockChainFor(table: string, op: string) {
  const chain: Record<string, unknown> = {};
  chain.eq = (...a: unknown[]) => {
    mockEq(table, ...a);
    return chain;
  };
  for (const m of ['order', 'limit', 'select']) chain[m] = () => chain;
  chain.maybeSingle = () => Promise.resolve(results[`${table}.${op}`] ?? { data: null, error: null });
  chain.then = (res: (r: Result) => unknown, rej: (e: unknown) => unknown) =>
    Promise.resolve(results[`${table}.${op}`] ?? { data: [], error: null }).then(res, rej);
  return chain;
}

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: () => mockGetUser() },
    rpc: (...a: unknown[]) => mockRpc(...a),
    from: (table: string) => ({ select: () => mockChainFor(table, 'select'), delete: () => mockChainFor(table, 'delete') }),
  },
}));

const input: TemplateInput = {
  name: ' Push day ',
  activityType: ' Strength ',
  durationS: 3600,
  exercises: [
    { exerciseId: 'ex1', sets: [{ reps: 5, loadKg: 100 }, { reps: 0, loadKg: 0 }] },
    { exerciseId: 'ex2', sets: [{ durationS: 600, distanceM: 2000 }] },
  ],
};

const stored = {
  id: 't1', user_id: 'u1', name: 'Push day', activity_type: 'Strength', duration_s: 3600, notes: 'warm up', updated_at: '2026-10-20T12:00:00Z',
  workout_template_exercises: [
    { id: 'te2', exercise_id: 'ex2', position: 1, notes: null, exercises: { name: 'Running' }, workout_template_sets: [] },
    {
      id: 'te1', exercise_id: 'ex1', position: 0, notes: 'heavy', exercises: { name: 'Deadlift' },
      workout_template_sets: [
        { id: 's2', template_exercise_id: 'te1', position: 1, reps: 0, load_kg: 0, duration_s: null, distance_m: null },
        { id: 's1', template_exercise_id: 'te1', position: 0, reps: 5, load_kg: 100, duration_s: null, distance_m: null },
      ],
    },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(results)) delete results[k];
  mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
});

describe('createTemplate', () => {
  it('sends one RPC with ordered exercises and sets, leaving unknown fields null', async () => {
    mockRpc.mockResolvedValue({ data: 't1', error: null });
    await expect(createTemplate(input)).resolves.toBe('t1');
    expect(mockRpc).toHaveBeenCalledTimes(1);
    const [name, args] = mockRpc.mock.calls[0];
    expect(name).toBe('save_workout_template');
    expect(args.p_id).toBeNull();
    expect(args.p_template).toMatchObject({ name: 'Push day', activity_type: 'Strength', duration_s: 3600, notes: null });
    expect(args.p_template.exercises).toEqual([
      { exercise_id: 'ex1', notes: null, sets: [{ reps: 5, load_kg: 100, duration_s: null, distance_m: null }, { reps: 0, load_kg: 0, duration_s: null, distance_m: null }] },
      { exercise_id: 'ex2', notes: null, sets: [{ reps: null, load_kg: null, duration_s: 600, distance_m: 2000 }] },
    ]);
  });

  it('rejects a bad name or an empty set before hitting the database', async () => {
    await expect(createTemplate({ ...input, name: '   ' })).rejects.toThrow(/1 to 80/);
    await expect(createTemplate({ ...input, name: 'x'.repeat(81) })).rejects.toThrow(/1 to 80/);
    await expect(createTemplate({ ...input, exercises: [{ exerciseId: 'ex1', sets: [{}] }] })).rejects.toThrow(/Each set/);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('maps a failure to a friendly message', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '23503', message: 'secret' } });
    await expect(createTemplate(input)).rejects.toThrow(/Couldn't save/);
  });

  it('requires a signed-in user', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    await expect(createTemplate(input)).rejects.toThrow(/Sign in/);
  });
});

describe('updateTemplate', () => {
  it('passes the id to the same RPC', async () => {
    mockRpc.mockResolvedValue({ data: 't1', error: null });
    await updateTemplate('t1', input);
    expect(mockRpc).toHaveBeenCalledWith('save_workout_template', expect.objectContaining({ p_id: 't1' }));
  });

  it('fails when the template is not one of the user', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'template not found' } });
    await expect(updateTemplate('t1', input)).rejects.toThrow(/Couldn't save/);
  });
});

describe('getTemplate', () => {
  it('orders exercises and sets by position and flattens the exercise name', async () => {
    results['workout_templates.select'] = { data: stored, error: null };
    const t = await getTemplate('t1');
    expect(t?.exercises.map((e) => e.name)).toEqual(['Deadlift', 'Running']);
    expect(t?.exercises[0].sets.map((s) => s.id)).toEqual(['s1', 's2']);
    expect(t).not.toHaveProperty('workout_template_exercises');
  });

  it('returns null when the template is not visible', async () => {
    results['workout_templates.select'] = { data: null, error: null };
    await expect(getTemplate('nope')).resolves.toBeNull();
  });
});

describe('listTemplates', () => {
  it('asks for the signed-in user only and maps a failure', async () => {
    results['workout_templates.select'] = { data: [{ id: 't1' }], error: null };
    await expect(listTemplates()).resolves.toEqual([{ id: 't1' }]);
    expect(mockEq).toHaveBeenCalledWith('workout_templates', 'user_id', 'u1');
    results['workout_templates.select'] = { data: null, error: { message: 'boom' } };
    await expect(listTemplates()).rejects.toThrow(/Couldn't load/);
  });
});

describe('duplicateTemplate', () => {
  it('saves a new template with the same plan and a copy name', async () => {
    results['workout_templates.select'] = { data: stored, error: null };
    mockRpc.mockResolvedValue({ data: 't2', error: null });
    await expect(duplicateTemplate('t1')).resolves.toBe('t2');
    const [name, args] = mockRpc.mock.calls[0];
    expect(name).toBe('save_workout_template');
    expect(args.p_id).toBeNull();
    expect(args.p_template).toMatchObject({ name: 'Push day copy', activity_type: 'Strength', duration_s: 3600, notes: 'warm up' });
    expect(args.p_template.exercises).toEqual([
      { exercise_id: 'ex1', notes: 'heavy', sets: [{ reps: 5, load_kg: 100, duration_s: null, distance_m: null }, { reps: 0, load_kg: 0, duration_s: null, distance_m: null }] },
      { exercise_id: 'ex2', notes: null, sets: [] },
    ]);
  });

  it('keeps a long name within the limit', async () => {
    results['workout_templates.select'] = { data: { ...stored, name: 'y'.repeat(80) }, error: null };
    mockRpc.mockResolvedValue({ data: 't2', error: null });
    await duplicateTemplate('t1');
    const name = mockRpc.mock.calls[0][1].p_template.name;
    expect(name).toHaveLength(80);
    expect(name.endsWith(' copy')).toBe(true);
  });

  it('fails cleanly when the template is gone', async () => {
    results['workout_templates.select'] = { data: null, error: null };
    await expect(duplicateTemplate('t1')).rejects.toThrow(/doesn't exist/);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe('deleteTemplate', () => {
  it('maps a failure to a friendly message', async () => {
    results['workout_templates.delete'] = { error: { message: 'boom: secret' } };
    await expect(deleteTemplate('t1')).rejects.toThrow(/Couldn't delete/);
  });

  it('deletes by id', async () => {
    results['workout_templates.delete'] = { error: null };
    await expect(deleteTemplate('t1')).resolves.toBeUndefined();
    expect(mockEq).toHaveBeenCalledWith('workout_templates', 'id', 't1');
  });
});
