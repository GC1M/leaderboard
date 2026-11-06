/** @jest-environment node */
// The food-search edge function (#50): what the app gets when USDA is down, slow, over its limit or misconfigured.
// The function runs on Deno, so Deno and the Supabase client are stubbed and the real handler is called directly.
const mockGetUser = jest.fn();
const mockRpc = jest.fn();
const mockCached = jest.fn();
const mockIlike = jest.fn();
const mockEq = jest.fn();
const mockOrder = jest.fn();
const mockUpserts: unknown[] = [];
jest.mock(
  'npm:@supabase/supabase-js@2',
  () => ({
    createClient: (_url: string, key: string) =>
      key === 'anon-key'
        ? { auth: { getUser: mockGetUser } }
        : {
            rpc: mockRpc,
            from: () => {
              const c: Record<string, unknown> = {};
              c.select = () => c;
              c.eq = (...a: unknown[]) => (mockEq(...a), c);
              c.order = (...a: unknown[]) => (mockOrder(...a), c);
              c.ilike = (...a: unknown[]) => (mockIlike(...a), c);
              c.limit = () => mockCached();
              c.upsert = (rows: unknown) => (mockUpserts.push(rows), { select: async () => ({ data: [], error: null }) });
              return c;
            },
          },
  }),
  { virtual: true },
);

type Handler = (req: unknown) => Promise<Response>;
let handler: Handler;
const env: Record<string, string | undefined> = {};
const mockFetch = jest.fn();
beforeAll(() => {
  (globalThis as any).Deno = { env: { get: (k: string) => env[k] }, serve: (h: Handler) => { handler = h; } };
  globalThis.fetch = mockFetch as never;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../../supabase/functions/food-search/index');
});

const req = (body: unknown = { query: 'almonds' }, method = 'POST') => ({ method, headers: { get: () => 'Bearer t' }, json: async () => body });
const call = async (r: unknown = req()) => {
  const res = await handler(r);
  return { status: res.status, body: await res.json() };
};
const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json });
const bad = (status: number) => ({ ok: false, status, json: async () => ({}) });
const cachedRow = { id: 'f1', provider: 'usda_fdc', provider_id: '9', source_data_type: 'Foundation', name: 'Almonds', food_portions: [{ food_id: 'f1', label: 'cup', gram_weight: 140 }] };

beforeEach(() => {
  jest.resetAllMocks();
  mockUpserts.length = 0;
  Object.assign(env, { SUPABASE_URL: 'http://x', SUPABASE_ANON_KEY: 'anon-key', SUPABASE_SERVICE_ROLE_KEY: 'service-key', FDC_API_KEY: 'k' });
  mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
  mockRpc.mockResolvedValue({ data: true, error: null });
  mockCached.mockResolvedValue({ data: [cachedRow], error: null });
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

describe('requests the function refuses', () => {
  test('only POST, only signed-in users, and only when the secrets are set', async () => {
    expect(await call(req(null, 'GET'))).toMatchObject({ status: 405, body: { error: { code: 'bad_request' } } });
    env.FDC_API_KEY = undefined;
    expect(await call()).toMatchObject({ status: 503, body: { error: { code: 'not_configured' } } });
    env.FDC_API_KEY = 'k';
    mockGetUser.mockResolvedValue({ data: { user: null } });
    expect(await call()).toMatchObject({ status: 401, body: { error: { code: 'unauthorized' } } });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('a bad body is a 400 and the search limit answers 429 rate_limited before USDA is called', async () => {
    expect((await call(req({ query: 'a' }))).status).toBe(400);
    mockRpc.mockResolvedValue({ data: false, error: null });
    expect(await call()).toMatchObject({ status: 429, body: { error: { code: 'rate_limited' } } });
    mockRpc.mockResolvedValue({ data: null, error: { code: 'x' } });
    expect(await call()).toMatchObject({ status: 500, body: { error: { code: 'cache_error' } } });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('USDA failures', () => {
  // [what the provider does, failure code, HTTP status when nothing is cached]
  const outages: [string, () => void, string, number][] = [
    ['429 over its rate limit', () => mockFetch.mockResolvedValue(bad(429)), 'rate_limited', 429],
    ['403 bad key', () => mockFetch.mockResolvedValue(bad(403)), 'not_configured', 503],
    ['500 server error', () => mockFetch.mockResolvedValue(bad(500)), 'provider_error', 502],
    ['network error', () => mockFetch.mockRejectedValue(new TypeError('offline')), 'provider_error', 502],
    ['timeout', () => mockFetch.mockRejectedValue(new DOMException('slow', 'TimeoutError')), 'provider_timeout', 504],
    ['a stalled body read', () => mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => { throw new DOMException('slow', 'AbortError'); } }), 'provider_timeout', 504],
  ];

  test.each(outages)('%s with nothing cached returns the code and status, so the app offers a custom food', async (_n, setup, code, status) => {
    setup();
    mockCached.mockResolvedValue({ data: [], error: null });
    expect(await call()).toMatchObject({ status, body: { error: { code } } });
  });

  test.each(outages)('%s with matching foods cached returns them as a saved fallback with the code', async (_n, setup, code) => {
    setup();
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body).toMatchObject({ fromCache: true, failure: code, page: 1, totalHits: 1 });
    expect(body.foods.map((f: { id: string }) => f.id)).toEqual(['f1']);
    expect(body.foods[0].food_portions).toEqual(cachedRow.food_portions);
  });

  test('the second page has no cache to fall back on and says so instead of repeating page one', async () => {
    mockFetch.mockResolvedValue(bad(500));
    expect(await call(req({ query: 'almonds', page: 2 }))).toMatchObject({ status: 200, body: { foods: [], page: 2, fromCache: true, failure: 'provider_error' } });
  });

  test('a failure on the details call after a good search is the same fallback', async () => {
    mockFetch.mockResolvedValueOnce(ok({ totalHits: 1, foods: [{ fdcId: 9 }] })).mockResolvedValueOnce(bad(429));
    expect(await call()).toMatchObject({ status: 200, body: { fromCache: true, failure: 'rate_limited' } });
  });

  test('the cache is searched by name with the wildcards in the query escaped', async () => {
    mockFetch.mockResolvedValue(bad(500));
    mockCached.mockResolvedValue({ data: [], error: null });
    await call(req({ query: '100%_off' }));
    expect(mockIlike).toHaveBeenCalledWith('name', '%100\\%\\_off%');
  });

  test('the fallback reads only USDA rows, in name order', async () => {
    mockFetch.mockResolvedValue(bad(500));
    await call();
    expect(mockEq).toHaveBeenCalledWith('provider', 'usda_fdc');
    expect(mockOrder).toHaveBeenCalledWith('name');
  });

  test('a successful search caches the normalized food once, by provider and id', async () => {
    const detail = { fdcId: 9, description: 'Nuts, almonds', dataType: 'SR Legacy', publicationDate: '4/1/2019', foodNutrients: [{ nutrient: { number: '208', unitName: 'kcal' }, amount: 579 }], foodPortions: [] };
    mockFetch.mockResolvedValueOnce(ok({ totalHits: 1, foods: [{ fdcId: 9 }] })).mockResolvedValueOnce(ok([detail]));
    expect((await call()).status).toBe(200);
    expect(mockUpserts).toHaveLength(1);
    expect(mockUpserts[0]).toEqual([expect.objectContaining({ provider: 'usda_fdc', provider_id: '9', name: 'Nuts, almonds', source_data_type: 'SR Legacy', energy_kcal: 579 })]);
  });

  test('a search with no hits is an empty list, not a failure, and writes nothing', async () => {
    mockFetch.mockResolvedValue(ok({ totalHits: 0, foods: [] }));
    expect(await call()).toMatchObject({ status: 200, body: { foods: [], totalHits: 0 } });
    expect(mockUpserts).toEqual([]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
