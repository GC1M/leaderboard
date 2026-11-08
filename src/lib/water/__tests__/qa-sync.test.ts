import { localDateKey } from '@/lib/health/dates';

import { loadWaterDay, mergePending, waterQueue } from '../entries';

const mockStore = new Map<string, string>();
jest.mock('@/lib/secure-storage', () => ({
  secureStorage: {
    getItem: async (k: string) => mockStore.get(k) ?? null,
    setItem: async (k: string, v: string) => void mockStore.set(k, v),
    removeItem: async (k: string) => void mockStore.delete(k),
  },
}));
// The server has nothing for the day yet (the entry is only queued on this device).
jest.mock('@/lib/supabase', () => {
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in']) q[m] = () => q;
  q.order = async () => ({ data: [], error: null });
  q.then = (r: (v: unknown) => unknown) => r({ data: [], error: null });
  return { supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) }, from: () => q } };
});
jest.mock('@/lib/health/water-export', () => ({ bumpWaterSyncGeneration: () => {} }));

// Calendar date of `at` in `zone`, the way the server's trigger computes local_date.
const dateIn = (at: string, zone: string) => new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date(at));
// A drink logged in a zone whose calendar date differs from this device's current zone at that instant (e.g. logged
// offline before a flight, viewed after landing). Picks whichever far-east/far-west zone disagrees with the device.
const AT = '2026-11-06T22:30:00.000Z';
const ZONE = ['Pacific/Kiritimati', 'Pacific/Pago_Pago'].find((z) => dateIn(AT, z) !== localDateKey(new Date(AT)))!;
const SERVER_DAY = dateIn(AT, ZONE);

beforeEach(() => mockStore.clear());

describe('queued entries use their own zone for the local day', () => {
  it('mergePending: a queued log gets the local_date the server will give it', () => {
    const [e] = mergePending([], [{ kind: 'log', clientId: 'c1', row: { source: 'manual', ml: 250, consumed_at: AT, timezone: ZONE } }]);
    expect(e.timezone).toBe(ZONE);
    expect(e.localDate).toBe(SERVER_DAY);
  });

  it('mergePending: a queued edit that moves the time takes the day in the edit\'s zone', () => {
    const row = { id: 'e1', client_id: 'c1', source: 'manual' as const, ml: 250, consumed_at: '2026-11-05T12:00:00+00:00', timezone: 'UTC', local_date: '2026-11-05' };
    const [e] = mergePending([row], [{ kind: 'edit', id: 'e1', patch: { consumed_at: AT, timezone: ZONE } }]);
    expect(e.localDate).toBe(SERVER_DAY);
  });

  it('loadWaterDay: the queued log shows on the day the server will file it under', async () => {
    await waterQueue.enqueue('u1', { kind: 'log', clientId: 'c1', row: { source: 'manual', ml: 250, consumed_at: AT, timezone: ZONE } });
    const day = await loadWaterDay('u1', SERVER_DAY);
    expect(day.entries.map((e) => e.clientId)).toEqual(['c1']);
  });
});
