import { createCustomFood, foodFromRow, FoodSearchError, getFood, searchCachedFoods, searchFoods, validateCustomFood } from './search';
import { emptyNutrients } from './nutrition';

const mockInvoke = jest.fn();
const mockGetUser = jest.fn();
const mockResults: Record<string, { data?: unknown; error?: unknown }> = {};
const mockCalls: { op: string; args: unknown[] }[] = [];

function mockChain(key: string) {
  const c: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'ilike', 'order', 'limit']) c[m] = (...args: unknown[]) => (mockCalls.push({ op: m, args }), c);
  c.single = c.maybeSingle = () => Promise.resolve(mockResults[key] ?? { data: null, error: null });
  c.then = (res: (r: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(mockResults[key] ?? { data: [], error: null }).then(res, rej);
  return c;
}
jest.mock('@/lib/supabase', () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => mockInvoke(...a) },
    auth: { getUser: () => mockGetUser() },
    from: () => ({
      select: (...a: unknown[]) => (mockCalls.push({ op: 'select', args: a }), mockChain('select')),
      insert: (...a: unknown[]) => (mockCalls.push({ op: 'insert', args: a }), mockChain('insert')),
    }),
  },
}));

const row = (over = {}) => ({
  id: 'f1', provider: 'usda_fdc', provider_id: '1', source_data_type: 'Foundation', source_version: '2022-10-28', user_id: null, name: 'Almonds', brand: null,
  energy_kcal: 584, protein_g: 21.4, carbs_g: null, fat_g: 51, fiber_g: null, sugars_g: null, sat_fat_g: null, sodium_mg: 0, updated_at: '',
  food_portions: [
    { id: 'p2', food_id: 'f1', label: 'serving', gram_weight: 30 },
    { id: 'p1', food_id: 'f1', label: 'cup', gram_weight: 0 },
    { id: 'p3', food_id: 'f1', label: 'bag', gram_weight: 100 },
  ],
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockCalls.length = 0;
  for (const k of Object.keys(mockResults)) delete mockResults[k];
});

test('foodFromRow keeps unknown as null, parses numeric strings and drops portions without a gram weight', () => {
  const f = foodFromRow(row());
  expect(f.per100g).toMatchObject({ energy_kcal: 584, protein_g: 21.4, carbs_g: null, sodium_mg: 0 });
  expect(f.portions).toEqual([{ id: 'p3', label: 'bag', gramWeight: 100 }, { id: 'p2', label: 'serving', gramWeight: 30 }]);
  expect(f).toMatchObject({ providerId: '1', sourceDataType: 'Foundation', sourceVersion: '2022-10-28' });
});

describe('searchFoods', () => {
  test('invokes the function with a bounded page size and maps the rows', async () => {
    mockInvoke.mockResolvedValue({ data: { foods: [row()], page: 2, totalHits: 40 }, error: null });
    const r = await searchFoods('almonds', 2);
    expect(mockInvoke).toHaveBeenCalledWith('food-search', { body: { query: 'almonds', page: 2, pageSize: 20 } });
    expect(r).toMatchObject({ page: 2, totalHits: 40, fromCache: false, failure: null });
    expect(r.foods[0].name).toBe('Almonds');
  });

  test('a cached fallback is flagged with the failure that caused it', async () => {
    mockInvoke.mockResolvedValue({ data: { foods: [row()], fromCache: true, failure: 'rate_limited' }, error: null });
    expect(await searchFoods('almonds')).toMatchObject({ fromCache: true, failure: 'rate_limited', page: 1 });
  });

  test('an error body code becomes a typed failure with a clear message', async () => {
    for (const [code, text] of [['rate_limited', 'busy'], ['provider_timeout', 'too long'], ['not_configured', 'not available'], ['provider_error', 'reach the food database']]) {
      mockInvoke.mockResolvedValueOnce({ data: null, error: { name: 'FunctionsHttpError', context: { json: () => Promise.resolve({ error: { code } }) } } });
      const e = await searchFoods('rice').catch((x) => x);
      expect(e).toBeInstanceOf(FoodSearchError);
      expect(e.code).toBe(code);
      expect(e.message).toContain(text);
    }
  });

  test('network failures, unreadable bodies and unknown codes are still failures', async () => {
    mockInvoke.mockResolvedValueOnce({ data: null, error: { name: 'FunctionsFetchError' } });
    expect((await searchFoods('rice').catch((x) => x)).code).toBe('network');
    mockInvoke.mockResolvedValueOnce({ data: null, error: { name: 'FunctionsHttpError', context: { json: () => Promise.reject(new Error('html')) } } });
    expect((await searchFoods('rice').catch((x) => x)).code).toBe('unknown');
    mockInvoke.mockResolvedValueOnce({ data: null, error: { name: 'FunctionsHttpError', context: { json: () => Promise.resolve({ error: { code: 'weird' } }) } } });
    expect((await searchFoods('rice').catch((x) => x)).code).toBe('unknown');
    mockInvoke.mockResolvedValueOnce({ data: { nope: true }, error: null });
    expect((await searchFoods('rice').catch((x) => x)).code).toBe('unknown');
  });
});

describe('cached and custom foods', () => {
  test('searchCachedFoods escapes wildcards and can limit to custom foods', async () => {
    mockResults.select = { data: [row({ provider: 'custom', provider_id: null, user_id: 'me' })], error: null };
    const foods = await searchCachedFoods('50%_off', true);
    expect(mockCalls).toContainEqual({ op: 'ilike', args: ['name', '%50\\%\\_off%'] });
    expect(mockCalls).toContainEqual({ op: 'eq', args: ['provider', 'custom'] });
    expect(foods[0].provider).toBe('custom');
    mockResults.select = { data: null, error: { code: 'x' } };
    await expect(searchCachedFoods('x')).rejects.toThrow("Couldn't load saved foods");
  });

  test('getFood returns null when missing and fails clearly on error', async () => {
    expect(await getFood('nope')).toBeNull();
    mockResults.select = { data: row(), error: null };
    expect((await getFood('f1'))?.id).toBe('f1');
    mockResults.select = { data: null, error: { code: 'x' } };
    await expect(getFood('f1')).rejects.toThrow("Couldn't load that food");
  });

  test('validateCustomFood checks the name and nutrient bounds, and allows unknown nutrients', () => {
    const ok = { name: 'Soup', per100g: emptyNutrients() };
    expect(validateCustomFood(ok)).toBeNull();
    expect(validateCustomFood({ ...ok, name: ' ' })).toContain('Food names');
    expect(validateCustomFood({ ...ok, brand: 'x'.repeat(201) })).toContain('Brand');
    expect(validateCustomFood({ ...ok, per100g: { ...emptyNutrients(), fat_g: -1 } })).toContain('negative');
    expect(validateCustomFood({ ...ok, per100g: { ...emptyNutrients(), energy_kcal: 1001 } })).toContain('1000');
    expect(validateCustomFood({ ...ok, per100g: { ...emptyNutrients(), protein_g: 101 } })).toContain('100');
  });

  test('createCustomFood inserts an owner row with unknown nutrients as null', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'me' } } });
    mockResults.insert = { data: row({ provider: 'custom', provider_id: null, user_id: 'me', name: 'Soup', food_portions: null }), error: null };
    const f = await createCustomFood({ name: ' Soup ', brand: ' ', per100g: { ...emptyNutrients(), energy_kcal: 50 } });
    expect(mockCalls.find((c) => c.op === 'insert')?.args[0]).toMatchObject({ provider: 'custom', user_id: 'me', name: 'Soup', brand: null, energy_kcal: 50, protein_g: null });
    expect(f.portions).toEqual([]);
  });

  test('createCustomFood explains bad values, other failures, and a missing sign-in', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'me' } } });
    const input = { name: 'Soup', per100g: emptyNutrients() };
    mockResults.insert = { data: null, error: { code: '23514' } };
    await expect(createCustomFood(input)).rejects.toThrow('per 100 g');
    mockResults.insert = { data: null, error: { code: '42501' } };
    await expect(createCustomFood(input)).rejects.toThrow("Couldn't save that food");
    await expect(createCustomFood({ ...input, name: '' })).rejects.toThrow('Food names');
    mockGetUser.mockResolvedValue({ data: { user: null } });
    await expect(createCustomFood(input)).rejects.toThrow('Sign in');
  });
});
