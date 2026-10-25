import { getMyRecentSteps, upsertDailyMetrics } from './metrics';

const mockUpsert = jest.fn();
const mockGetUser = jest.fn();
const mockSelect = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: () => mockGetUser() },
    from: () => ({
      upsert: mockUpsert,
      select: (...a: unknown[]) => {
        mockSelect(...a);
        const chain: Record<string, unknown> = {};
        chain.eq = () => chain;
        chain.gte = () => chain;
        chain.order = () => Promise.resolve({ data: [{ date: '2026-10-25', value: '8412', source: 'manual' }], error: null });
        return chain;
      },
    }),
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
  mockUpsert.mockResolvedValue({ error: null });
});

describe('upsertDailyMetrics', () => {
  it('upserts on (user_id, date, metric) with the user id filled in', async () => {
    await upsertDailyMetrics([{ date: '2026-10-25', value: 100, source: 'manual' }]);
    expect(mockUpsert).toHaveBeenCalledWith(
      [{ user_id: 'u1', date: '2026-10-25', metric: 'steps', value: 100, source: 'manual' }],
      { onConflict: 'user_id,date,metric' },
    );
  });
  it.each([80001, -1, 1.5])('rejects %p before hitting the database', async (value) => {
    await expect(upsertDailyMetrics([{ date: '2026-10-25', value, source: 'manual' }])).rejects.toThrow(/80,000|whole/);
    expect(mockUpsert).not.toHaveBeenCalled();
  });
  it('maps a check violation to the friendly cap message', async () => {
    mockUpsert.mockResolvedValue({ error: { code: '23514' } });
    await expect(upsertDailyMetrics([{ date: '2026-10-25', value: 5, source: 'manual' }])).rejects.toThrow("Steps can't be more than 80,000");
  });
  it('does nothing for an empty batch', async () => {
    await upsertDailyMetrics([]);
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});

describe('getMyRecentSteps', () => {
  it('returns numeric values', async () => {
    expect(await getMyRecentSteps(7, new Date(2026, 9, 25))).toEqual([{ date: '2026-10-25', value: 8412, source: 'manual' }]);
  });
});
