import { consumedNutrients, defaultMeal, logFood, MAX_GRAMS, resolveQuantity } from './log';
import { emptyNutrients } from './nutrition';
import type { Food } from './search';

const mockEnqueue = jest.fn();
const mockFlush = jest.fn();
const mockGetSession = jest.fn();
jest.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: () => mockGetSession() } } }));
jest.mock('./pending', () => ({ enqueue: (...a: unknown[]) => mockEnqueue(...a), flushPending: (...a: unknown[]) => mockFlush(...a) }));
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
    mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'me' } } } });
    mockEnqueue.mockResolvedValue(undefined);
    mockFlush.mockResolvedValue(0);
  });

  test('saves the identity copy, resolved grams, snapshot, meal and device time zone to the pending queue, then syncs', async () => {
    expect(await logFood(input)).toBe(true);
    const [uid, op] = mockEnqueue.mock.calls[0];
    expect([uid, op.kind, op.clientId]).toEqual(['me', 'log', 'c-1']);
    expect(op.row).toMatchObject({
      client_id: 'c-1', food_id: 'f1', meal: 'lunch', consumed_at: '2026-11-06T18:00:00.000Z', timezone: 'America/Chicago',
      grams: 236, portion_label: 'medium', portion_count: 2, is_estimated: false,
      food_name: 'Bananas, raw', food_brand: null, provider: 'usda_fdc', provider_id: '173944', source_data_type: 'SR Legacy', source_version: '2019-04-01',
      protein_g: 2.5724, fiber_g: null, sodium_mg: null,
    });
    expect(op.row.energy_kcal).toBeCloseTo(210.04, 2);
    expect(mockFlush).toHaveBeenCalledWith('me');
  });

  test('a retry with changed values keeps the same client id and identity columns', async () => {
    await logFood(input);
    await logFood({ ...input, quantity: { mode: 'portion', portion: food.portions[0], count: 3 }, meal: 'dinner' });
    const [a, b] = mockEnqueue.mock.calls.map((c) => c[1]);
    expect(b.clientId).toBe(a.clientId);
    for (const k of ['food_id', 'food_name', 'food_brand', 'provider', 'provider_id', 'source_data_type', 'source_version']) expect(b.row[k]).toEqual(a.row[k]);
    expect(b.row).toMatchObject({ grams: 354, meal: 'dinner', portion_count: 3 });
  });

  test('rejects a bad amount or time before anything is saved', async () => {
    await expect(logFood({ ...input, quantity: { mode: 'grams', amount: 0 } })).rejects.toThrow('Enter an amount above 0 and up to 100,000 g.');
    await expect(logFood({ ...input, consumedAt: new Date(Number.NaN) })).rejects.toThrow('valid time');
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  test('needs a signed-in user; a failed sync keeps the entry and resolves false', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: null } });
    await expect(logFood(input)).rejects.toThrow('Sign in');
    mockFlush.mockResolvedValueOnce(1);
    expect(await logFood(input)).toBe(false);
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
  });
});
