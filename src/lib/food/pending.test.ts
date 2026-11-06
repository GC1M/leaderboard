import { discard, enqueue, flushPending, loadPending, SYNC_FAILED } from './pending';

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
jest.mock('@/lib/supabase', () => ({
  supabase: { from: () => ({ upsert: (...a: unknown[]) => mockUpsert(...a), update: (...a: unknown[]) => { mockUpdate(...a); return { eq: mockEq }; } }) },
}));

const log = { kind: 'log' as const, clientId: 'c1', row: { grams: 100, meal: 'lunch' } };
beforeEach(() => {
  mockStore.clear();
  jest.clearAllMocks();
  mockUpsert.mockResolvedValue({ error: null });
  mockEq.mockResolvedValue({ error: null });
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
    return { error: null };
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
