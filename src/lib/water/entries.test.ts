import { buildEdit, dayTotal, entryFromRow, logWater, mergePending, waterQueue } from './entries';

const mockStore = new Map<string, string>();
jest.mock('@/lib/secure-storage', () => ({
  secureStorage: {
    getItem: async (k: string) => mockStore.get(k) ?? null,
    setItem: async (k: string, v: string) => void mockStore.set(k, v),
    removeItem: async (k: string) => void mockStore.delete(k),
  },
}));
const mockUpsert = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) },
    from: () => ({ upsert: (...a: unknown[]) => mockUpsert(...a) }),
  },
}));
jest.mock('@/lib/health/water-export', () => ({ bumpWaterSyncGeneration: () => {} }));

const row = (o: Record<string, unknown> = {}) => ({ id: 'e1', client_id: 'c1', source: 'manual', ml: 250, consumed_at: '2026-11-06T18:00:00Z', timezone: 'UTC', local_date: '2026-11-06', updated_at: 'v1', ...o });

beforeEach(() => {
  mockStore.clear();
  jest.clearAllMocks();
});

describe('mergePending', () => {
  it('applies queued edits, hides purged rows and adds queued logs the server does not have', () => {
    const out = mergePending(
      [row(), row({ id: 'e2', client_id: 'c2', consumed_at: '2026-11-06T08:00:00Z' }), row({ id: 'e3', client_id: 'c3' })],
      [
        { kind: 'edit', id: 'e1', patch: { ml: 500 } },
        { kind: 'purge', clientId: 'c3' },
        { kind: 'log', clientId: 'c4', row: { source: 'manual', ml: 100, consumed_at: '2026-11-06T20:00:00Z', timezone: 'UTC' }, error: 'offline' },
        { kind: 'log', clientId: 'c2', row: { source: 'manual', ml: 999, consumed_at: '2026-11-06T08:00:00Z', timezone: 'UTC' } },
      ],
    );
    expect(out.map((e) => [e.clientId, e.ml, e.pending])).toEqual([['c2', 250, null], ['c1', 500, 'edit'], ['c4', 100, 'log']]);
    expect(out[2]).toMatchObject({ id: null, syncError: 'offline' });
  });
});

describe('dayTotal', () => {
  it('is null for a day with no entries, not 0', () => {
    expect(dayTotal([])).toBeNull();
    expect(dayTotal([entryFromRow(row()), entryFromRow(row({ ml: 0.5 }))])).toBe(250.5);
  });
});

describe('buildEdit', () => {
  const manual = entryFromRow(row());
  it('validates amount and time and keeps only what changed', () => {
    expect(() => buildEdit(manual, { ml: 0 })).toThrow(/above 0/);
    expect(() => buildEdit(manual, { ml: 5001 })).toThrow(/up to 5000 mL/);
    expect(() => buildEdit(manual, { consumedAt: new Date(Date.now() + 3_600_000) })).toThrow(/future/);
    expect(buildEdit(manual, { ml: 250, consumedAt: new Date('2026-11-06T18:00:00Z') })).toEqual({});
    expect(buildEdit(manual, { ml: 300 })).toEqual({ ml: 300 });
  });
  it('refuses imported entries', () => {
    expect(() => buildEdit(entryFromRow(row({ source: 'healthkit', client_id: null })), { ml: 300 })).toThrow(/Health app/);
  });
});

describe('logWater', () => {
  it('offline: queues the entry on this device and resolves false', async () => {
    mockUpsert.mockRejectedValue(new Error('Network request failed'));
    await expect(logWater(250, new Date('2026-11-06T18:00:00Z'), 'c9')).resolves.toBe(false);
    const ops = await waterQueue.loadPending('u1');
    expect(ops).toMatchObject([{ kind: 'log', clientId: 'c9', row: { source: 'manual', ml: 250, consumed_at: '2026-11-06T18:00:00.000Z' } }]);
  });
  it('online: resolves true and leaves nothing queued; an invalid amount is refused before saving', async () => {
    mockUpsert.mockResolvedValue({ error: null });
    await expect(logWater(250, new Date('2026-11-06T18:00:00Z'), 'c9')).resolves.toBe(true);
    expect(await waterQueue.loadPending('u1')).toEqual([]);
    await expect(logWater(-1)).rejects.toThrow(/above 0/);
    expect(mockUpsert).toHaveBeenCalledTimes(1);
  });
});
