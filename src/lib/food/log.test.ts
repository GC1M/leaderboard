import { consumedNutrients, defaultMeal, logFood, MAX_GRAMS, resolveQuantity } from './log';
import { emptyNutrients } from './nutrition';
import type { Food } from './search';

const mockUpsert = jest.fn();
const mockGetUser = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { getUser: () => mockGetUser() }, from: (table: string) => ({ upsert: (...a: unknown[]) => mockUpsert(table, ...a) }) },
}));
jest.mock('@/lib/timezone', () => ({ deviceTimezone: () => 'America/Chicago' }));

const food: Food = {
  id: 'f1', name: 'Bananas, raw', brand: null, provider: 'usda_fdc', providerId: '173944', sourceDataType: 'SR Legacy', sourceVersion: '2019-04-01',
  per100g: { ...emptyNutrients(), energy_kcal: 89, protein_g: 1.09, carbs_g: 22.84, fat_g: 0.33 },
  portions: [{ id: 'p1', label: 'medium', gramWeight: 118 }],
};

describe('resolveQuantity', () => {
  test('grams pass through, portions multiply by their gram weight', () => {
    expect(resolveQuantity({ mode: 'grams', amount: 150 })).toEqual({ grams: 150, portionLabel: null, portionCount: null });
    expect(resolveQuantity({ mode: 'portion', portion: food.portions[0], count: 1.5 })).toEqual({ grams: 177, portionLabel: 'medium', portionCount: 1.5 });
  });

  test('zero, negative, non-finite, huge amounts and portions without a gram weight are rejected', () => {
    for (const amount of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, MAX_GRAMS + 1]) expect(resolveQuantity({ mode: 'grams', amount })).toBeNull();
    expect(resolveQuantity({ mode: 'portion', portion: { id: 'p', label: 'pinch', gramWeight: 0 }, count: 1 })).toBeNull();
    expect(resolveQuantity({ mode: 'portion', portion: food.portions[0], count: 0 })).toBeNull();
    expect(resolveQuantity({ mode: 'portion', portion: { id: 'p', label: 'g', gramWeight: 0.0001 }, count: 100001 })).toBeNull();
  });
});

test('consumedNutrients scales per 100 g and keeps unknown as null', () => {
  const n = consumedNutrients(food, { mode: 'portion', portion: food.portions[0], count: 1 })!;
  expect(n.energy_kcal).toBeCloseTo(105.02, 2);
  expect(n.fiber_g).toBeNull();
  expect(consumedNutrients(food, { mode: 'grams', amount: 0 })).toBeNull();
});

test('defaultMeal follows the hour', () => {
  const at = (h: number) => defaultMeal(new Date(2026, 0, 1, h));
  expect([at(7), at(12), at(19), at(23), at(2)]).toEqual(['breakfast', 'lunch', 'dinner', 'snack', 'snack']);
});

describe('logFood', () => {
  const input = { food, quantity: { mode: 'portion' as const, portion: food.portions[0], count: 2 }, meal: 'lunch' as const, consumedAt: new Date('2026-11-06T18:00:00Z'), clientId: 'c-1' };
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: 'me' } } });
    mockUpsert.mockResolvedValue({ error: null });
  });

  test('upserts the identity copy, resolved grams, snapshot, meal and device time zone on (user_id, client_id)', async () => {
    await logFood(input);
    const [table, row, opts] = mockUpsert.mock.calls[0];
    expect(table).toBe('food_entries');
    expect(opts).toEqual({ onConflict: 'user_id,client_id' });
    expect(row).toMatchObject({
      user_id: 'me', client_id: 'c-1', food_id: 'f1', meal: 'lunch', consumed_at: '2026-11-06T18:00:00.000Z', timezone: 'America/Chicago',
      grams: 236, portion_label: 'medium', portion_count: 2, is_estimated: false,
      food_name: 'Bananas, raw', food_brand: null, provider: 'usda_fdc', provider_id: '173944', source_data_type: 'SR Legacy', source_version: '2019-04-01',
      protein_g: 2.5724, fiber_g: null, sodium_mg: null,
    });
    expect(row.energy_kcal).toBeCloseTo(210.04, 2);
  });

  test('a retry with changed values sends the same client id and conflict key, with identity columns unchanged', async () => {
    await logFood(input);
    await logFood({ ...input, quantity: { mode: 'portion', portion: food.portions[0], count: 3 }, meal: 'dinner' });
    const [a, b] = mockUpsert.mock.calls.map((c) => c[1]);
    expect([b.user_id, b.client_id]).toEqual([a.user_id, a.client_id]);
    for (const k of ['food_id', 'food_name', 'food_brand', 'provider', 'provider_id', 'source_data_type', 'source_version']) expect(b[k]).toEqual(a[k]);
    expect(b).toMatchObject({ grams: 354, meal: 'dinner', portion_count: 3 });
  });

  test('rejects a bad amount or time before any write', async () => {
    await expect(logFood({ ...input, quantity: { mode: 'grams', amount: 0 } })).rejects.toThrow('Enter an amount above 0 and up to 100,000 g.');
    await expect(logFood({ ...input, consumedAt: new Date(Number.NaN) })).rejects.toThrow('valid time');
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  test('needs a signed-in user and reports a failed save without leaking the database error', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });
    await expect(logFood(input)).rejects.toThrow('Sign in');
    mockUpsert.mockResolvedValueOnce({ error: { message: 'secret detail' } });
    await expect(logFood(input)).rejects.toThrow("Couldn't log that food. Try again.");
  });
});
