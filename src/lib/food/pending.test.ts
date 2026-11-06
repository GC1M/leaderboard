import { clearFoodPending, discard, ENTRY_GONE, enqueue, flushPending, loadPending, SYNC_FAILED, SYNC_REFUSED, takeNotices } from './pending';

const mockStore = new Map<string, string>();
jest.mock('@/lib/secure-storage', () => ({
  secureStorage: {
    getItem: async (k: string) => mockStore.get(k) ?? null,
    setItem: async (k: string, v: string) => void mockStore.set(k, v),
    removeItem: async (k: string) => void mockStore.delete(k),
  },
}));
const mockUpsert = jest.fn();
const mockEq = jest.fn();
const mockUpdate = jest.fn();
const mockMaybe = jest.fn();
const mockSession = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: () => mockSession() },
    from: () => ({
      upsert: (...a: unknown[]) => mockUpsert(...a),
      update: (...a: unknown[]) => { mockUpdate(...a); return { eq: (...e: unknown[]) => ({ select: () => mockEq(...e) }) }; },
      select: () => ({ eq: () => ({ maybeSingle: () => mockMaybe() }) }),
    }),
  },
}));

const log = { kind: 'log' as const, clientId: 'c1', row: { grams: 100, meal: 'lunch' } };
beforeEach(() => {
  mockStore.clear();
  jest.clearAllMocks();
  mockUpsert.mockResolvedValue({ error: null });
  mockEq.mockResolvedValue({ error: null, data: [{ id: 'e1' }] });
  mockMaybe.mockResolvedValue({ error: null, data: { id: 'e1' } });
  mockSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
});

test('an op is saved on the device before any network call and survives a reload', async () => {
  await enqueue('u1', log);
  expect(mockUpsert).not.toHaveBeenCalled();
  expect(await loadPending('u1')).toEqual([log]);
  expect(await loadPending('u2')).toEqual([]);
});

test('a failed send keeps the op with its error, and the next flush retries and clears it', async () => {
  await enqueue('u1', log);
  mockUpsert.mockResolvedValueOnce({ error: { message: 'offline' } });
  expect(await flushPending('u1')).toBe(1);
  expect((await loadPending('u1'))[0]).toMatchObject({ clientId: 'c1', error: SYNC_FAILED });
  expect(await flushPending('u1')).toBe(0);
  expect(await loadPending('u1')).toEqual([]);
  expect(mockStore.size).toBe(0);
  // Both sends are the same upsert on (user_id, client_id), so the retry cannot make a second entry.
  expect(mockUpsert.mock.calls.map((c) => [c[0].client_id, c[0].user_id, c[1]])).toEqual(Array(2).fill(['c1', 'u1', { onConflict: 'user_id,client_id' }]));
});

test('a thrown network error is a failed send, not a lost op', async () => {
  await enqueue('u1', log);
  mockUpsert.mockRejectedValueOnce(new Error('Network request failed'));
  expect(await flushPending('u1')).toBe(1);
  expect(await loadPending('u1')).toHaveLength(1);
});

test('edits of one entry merge into one UPDATE of its changed columns, and a log replaces itself by client id', async () => {
  await enqueue('u1', { kind: 'edit', id: 'e1', patch: { grams: 50, energy_kcal: 10 } });
  await enqueue('u1', { kind: 'edit', id: 'e1', patch: { meal: 'dinner' } });
  await enqueue('u1', log);
  await enqueue('u1', { ...log, row: { grams: 200 } });
  const ops = await loadPending('u1');
  expect(ops).toHaveLength(2);
  expect(ops[0]).toMatchObject({ kind: 'edit', patch: { grams: 50, energy_kcal: 10, meal: 'dinner' } });
  expect(ops[1]).toMatchObject({ kind: 'log', row: { grams: 200 } });
  await flushPending('u1');
  expect(mockUpdate).toHaveBeenCalledWith({ grams: 50, energy_kcal: 10, meal: 'dinner' });
  expect(mockEq).toHaveBeenCalledWith('id', 'e1');
});

test('an edit that arrives while a send is in flight stays queued', async () => {
  await enqueue('u1', { kind: 'edit', id: 'e1', patch: { grams: 50 } });
  mockEq.mockImplementationOnce(async () => {
    await enqueue('u1', { kind: 'edit', id: 'e1', patch: { grams: 60 } });
    return { error: null, data: [{ id: 'e1' }] };
  });
  expect(await flushPending('u1')).toBe(0);
  expect(await loadPending('u1')).toEqual([{ kind: 'edit', id: 'e1', patch: { grams: 60 } }]);
});

test('discard removes one op, and unreadable storage reads as empty', async () => {
  await enqueue('u1', log);
  await discard('u1', log);
  expect(await loadPending('u1')).toEqual([]);
  mockStore.set('food-pending-u1', '{not json');
  expect(await loadPending('u1')).toEqual([]);
});

const edit = { kind: 'edit' as const, id: 'e1', patch: { grams: 50 } };

describe('error classification', () => {
  test.each([
    ['a network failure', { status: 0, error: { message: 'Failed to fetch' } }],
    ['a 5xx', { status: 503, error: { message: 'x' } }],
    ['a 408', { status: 408, error: { message: 'x' } }],
    ['a 429', { status: 429, error: { message: 'x' } }],
    ['an expired JWT', { status: 401, error: { code: 'PGRST301', message: 'JWT expired' } }],
  ])('%s is retried on the next flush', async (_n, failure) => {
    await enqueue('u1', log);
    mockUpsert.mockResolvedValueOnce(failure);
    expect(await flushPending('u1')).toBe(1);
    expect((await loadPending('u1'))[0]).toMatchObject({ error: SYNC_FAILED });
    expect((await loadPending('u1'))[0].permanent).toBeFalsy();
    expect(await flushPending('u1')).toBe(0);
    expect(mockUpsert).toHaveBeenCalledTimes(2);
  });

  test.each([
    ['a 400', { status: 400, error: { message: 'x' } }],
    ['a 403', { status: 403, error: { message: 'x' } }],
    ['a 409', { status: 409, error: { message: 'x' } }],
    ['a check violation', { status: 400, error: { code: '23514', message: 'x' } }],
    ['a bad value', { status: 0, error: { code: '22P02', message: 'x' } }],
    ['no permission', { status: 0, error: { code: '42501', message: 'x' } }],
  ])('%s is permanent: kept for the user, shown as refused and not retried', async (_n, failure) => {
    await enqueue('u1', log);
    mockUpsert.mockResolvedValueOnce(failure);
    expect(await flushPending('u1')).toBe(1);
    expect((await loadPending('u1'))[0]).toMatchObject({ error: SYNC_REFUSED, permanent: true });
    mockUpsert.mockClear();
    expect(await flushPending('u1')).toBe(1);
    expect(mockUpsert).not.toHaveBeenCalled();
    // Editing it again is a new try; discarding removes it.
    await enqueue('u1', { ...log, row: { grams: 5 } });
    expect((await loadPending('u1'))[0].permanent).toBeUndefined();
    await discard('u1', log);
    expect(await loadPending('u1')).toEqual([]);
  });
});

describe('session and missing rows', () => {
  test('nothing is sent while the signed-in user is not the queue owner, and nothing is lost', async () => {
    await enqueue('u1', log);
    mockSession.mockResolvedValue({ data: { session: { user: { id: 'other' } } } });
    expect(await flushPending('u1')).toBe(1);
    mockSession.mockResolvedValue({ data: { session: null } });
    expect(await flushPending('u1')).toBe(1);
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(await loadPending('u1')).toHaveLength(1);
  });

  test('an edit that updates no row is dropped with a notice when the entry is gone', async () => {
    await enqueue('u1', edit);
    mockEq.mockResolvedValueOnce({ error: null, data: [] });
    mockMaybe.mockResolvedValueOnce({ error: null, data: null });
    expect(await flushPending('u1')).toBe(0);
    expect(await loadPending('u1')).toEqual([]);
    expect(takeNotices('u1')).toEqual([ENTRY_GONE]);
    expect(takeNotices('u1')).toEqual([]);
  });

  test('an edit that updates no row but whose entry still exists stays queued', async () => {
    await enqueue('u1', edit);
    mockEq.mockResolvedValueOnce({ error: null, data: [] });
    expect(await flushPending('u1')).toBe(1);
    expect(await loadPending('u1')).toHaveLength(1);
    expect(takeNotices('u1')).toEqual([]);
  });
});

describe('concurrent flushes', () => {
  test('a flush started during another waits for it, then sends what was queued meanwhile, and reports the final result', async () => {
    await enqueue('u1', log);
    let release: () => void = () => {};
    mockUpsert.mockImplementationOnce(() => new Promise((r) => { release = () => r({ error: null }); }));
    const first = flushPending('u1');
    await new Promise((r) => setTimeout(r, 0));
    await enqueue('u1', edit);
    const second = flushPending('u1');
    release();
    expect(await first).toBe(0);
    expect(await second).toBe(0);
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith({ grams: 50 });
    expect(await loadPending('u1')).toEqual([]);
  });

  test('overlapping flushes never send an op twice at the same time', async () => {
    await enqueue('u1', log);
    const all = await Promise.all([flushPending('u1'), flushPending('u1'), flushPending('u1')]);
    expect(all).toEqual([0, 0, 0]);
    expect(mockUpsert).toHaveBeenCalledTimes(1);
  });

  test('a failed first pass does not hide itself: the last call reports what is still queued', async () => {
    await enqueue('u1', edit);
    mockEq.mockResolvedValue({ status: 500, error: { message: 'x' }, data: null });
    const [a, b] = await Promise.all([flushPending('u1'), flushPending('u1')]);
    expect([a, b]).toEqual([1, 1]);
  });

  test('each account has its own flush', async () => {
    await enqueue('u1', log);
    await enqueue('u2', { ...log, clientId: 'c2' });
    mockSession.mockImplementation(async () => ({ data: { session: { user: { id: 'u1' } } } }));
    let release: () => void = () => {};
    mockUpsert.mockImplementationOnce(() => new Promise((r) => { release = () => r({ error: null }); }));
    const one = flushPending('u1');
    await new Promise((r) => setTimeout(r, 0));
    // u2 is not blocked by u1's slow send (its session check fails here, which only proves it ran on its own).
    expect(await flushPending('u2')).toBe(1);
    release();
    expect(await one).toBe(0);
    expect(await loadPending('u2')).toHaveLength(1);
  });
});

test('clearFoodPending removes the account queue', async () => {
  await enqueue('u1', log);
  await clearFoodPending('u1');
  expect(await loadPending('u1')).toEqual([]);
});
