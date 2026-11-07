// Fixture-driven arithmetic for #50. Every expected value is worked out by hand in the comment beside it, so a
// wrong formula cannot pass by being compared with itself. Per-100 g inputs are the stored unit; only kcal is stored.
import { normalizeFood, type RawFood } from '../../../supabase/functions/_shared/fdc';
import { buildEdit, entryFromRow, groupDay } from './diary';
import { logFood, resolveQuantity, type Quantity } from './log';
import { emptyNutrients, kcalToKj, kjToKcal, massToGrams, type NutrientKey, type Nutrients, roundNutrient, scaleNutrients, sumNutrients } from './nutrition';
import { ingredientFromFood, per100g, perServing, type Recipe, recipePayload, recipeSnapshot, recipeTotals, resolveRecipePortion } from './recipe';
import { logRecipe } from './recipes';
import type { Food } from './search';

const mockEnqueue = jest.fn();
jest.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) } } }));
jest.mock('./pending', () => ({ enqueue: (...a: unknown[]) => mockEnqueue(...a), flushPending: async () => 0, loadPending: async () => [], discard: jest.fn() }));
jest.mock('@/lib/timezone', () => ({ deviceTimezone: () => 'America/Chicago' }));

const n = (o: Partial<Nutrients>): Nutrients => ({ ...emptyNutrients(), ...o });
// Every key not listed is expected to be unknown (null). A listed number is checked to 6 decimals.
function expectNutrients(actual: Nutrients, expected: Partial<Nutrients>) {
  for (const k of Object.keys(actual) as NutrientKey[]) {
    const e = expected[k] ?? null;
    if (e === null) expect({ k, v: actual[k] }).toEqual({ k, v: null });
    else expect(actual[k]).toBeCloseTo(e, 6);
  }
}

const rice: Food = {
  id: 'f-rice', name: 'Rice, cooked', brand: null, provider: 'usda_fdc', providerId: '1', sourceDataType: 'SR Legacy', sourceVersion: '2019-04-01',
  per100g: n({ energy_kcal: 130, protein_g: 2.7, carbs_g: 28, fat_g: 0, sodium_mg: 1 }), // fiber, sugars, sat fat unknown
  portions: [{ id: 'p-cup', label: 'cup', gramWeight: 158 }],
};
const cup = rice.portions[0];

describe('grams and servings', () => {
  // [case, quantity, expected grams, expected nutrients]. factor = grams / 100.
  const cases: [string, Quantity, number, Partial<Nutrients>][] = [
    ['100 g is the per-100 g values', { mode: 'grams', amount: 100 }, 100, { energy_kcal: 130, protein_g: 2.7, carbs_g: 28, fat_g: 0, sodium_mg: 1 }],
    // 250 g: factor 2.5. kcal 130*2.5=325, protein 2.7*2.5=6.75, carbs 28*2.5=70, fat 0 stays 0, sodium 2.5
    ['250 g', { mode: 'grams', amount: 250 }, 250, { energy_kcal: 325, protein_g: 6.75, carbs_g: 70, fat_g: 0, sodium_mg: 2.5 }],
    // 0.5 g: factor 0.005. kcal 0.65, protein 0.0135
    ['half a gram', { mode: 'grams', amount: 0.5 }, 0.5, { energy_kcal: 0.65, protein_g: 0.0135, carbs_g: 0.14, fat_g: 0, sodium_mg: 0.005 }],
    // 1 cup = 158 g, factor 1.58. kcal 205.4, protein 4.266, carbs 44.24, sodium 1.58
    ['1 cup (158 g)', { mode: 'portion', portion: cup, count: 1 }, 158, { energy_kcal: 205.4, protein_g: 4.266, carbs_g: 44.24, fat_g: 0, sodium_mg: 1.58 }],
    // 2.5 cups = 395 g, factor 3.95. kcal 513.5, protein 10.665, carbs 110.6, sodium 3.95
    ['2.5 cups (395 g)', { mode: 'portion', portion: cup, count: 2.5 }, 395, { energy_kcal: 513.5, protein_g: 10.665, carbs_g: 110.6, fat_g: 0, sodium_mg: 3.95 }],
    // 0.5 cup = 79 g, factor 0.79. kcal 102.7, protein 2.133
    ['half a cup (79 g)', { mode: 'portion', portion: cup, count: 0.5 }, 79, { energy_kcal: 102.7, protein_g: 2.133, carbs_g: 22.12, fat_g: 0, sodium_mg: 0.79 }],
  ];
  test.each(cases)('%s', (_name, quantity, grams, expected) => {
    expect(resolveQuantity(quantity)?.grams).toBeCloseTo(grams, 9);
    expectNutrients(scaleNutrients(rice.per100g, grams), expected);
  });

  test('ounces and pounds are grams before any nutrient maths', () => {
    // 8 oz = 8 * 28.349523125 = 226.796185 g; factor 2.26796185; kcal 130 * 2.26796185 = 294.8350405
    expect(massToGrams(8, 'oz')).toBeCloseTo(226.796185, 6);
    expect(scaleNutrients(rice.per100g, massToGrams(8, 'oz')).energy_kcal).toBeCloseTo(294.8350405, 6);
    // 1 lb = 453.59237 g; kcal 130 * 4.5359237 = 589.670081
    expect(scaleNutrients(rice.per100g, massToGrams(1, 'lb')).energy_kcal).toBeCloseTo(589.670081, 5);
  });

  test('logging stores the resolved grams, the portion as typed and the snapshot for that amount', async () => {
    mockEnqueue.mockReset();
    await logFood({ food: rice, quantity: { mode: 'portion', portion: cup, count: 2.5 }, meal: 'lunch', consumedAt: new Date('2026-11-06T18:00:00Z'), clientId: 'c1' });
    const row = mockEnqueue.mock.calls[0][1].row;
    // 2.5 cups = 395 g (above); kcal 513.5; the typed portion stays as label and count
    expect(row).toMatchObject({ grams: 395, portion_label: 'cup', portion_count: 2.5, carbs_g: 110.6, fiber_g: null });
    expect(row.energy_kcal).toBeCloseTo(513.5, 9);
  });

  test('display rounding happens last: whole kcal and mg, one decimal for grams', () => {
    // 205.4 kcal -> 205, 4.266 g -> 4.3, 1.58 mg -> 2, unknown stays unknown
    expect([roundNutrient('energy_kcal', 205.4), roundNutrient('protein_g', 4.266), roundNutrient('sodium_mg', 1.58), roundNutrient('fiber_g', null)]).toEqual([205, 4.3, 2, null]);
  });
});

describe('kcal and kJ', () => {
  // 1 kcal = 4.184 kJ. [kJ, kcal]
  const pairs: [number, number][] = [
    [0, 0],
    [4.184, 1],
    [418.4, 100], // 100 * 4.184
    [4184, 1000], // 1000 * 4.184
  ];
  test.each(pairs)('%f kJ is %f kcal both ways', (kj, kcal) => {
    expect(kjToKcal(kj)).toBeCloseTo(kcal, 9);
    expect(kcalToKj(kcal)).toBeCloseTo(kj, 9);
  });

  test('an amount that is not a round number: 1000 kJ is 239.0057 kcal, 500 kcal is 2092 kJ', () => {
    // 1000 / 4.184 = 239.00573...; 500 * 4.184 = 2092
    expect(kjToKcal(1000)).toBeCloseTo(239.0057, 4);
    expect(kcalToKj(500)).toBeCloseTo(2092, 9);
  });

  // The provider's kJ is stored as kcal rounded to 2 decimals, and kcal wins when both are present.
  const raw = (energy: { number: string; unitName: string; amount: number }[]): RawFood => ({
    fdcId: 1, description: 'Test food', dataType: 'SR Legacy', publicationDate: '4/1/2019',
    foodNutrients: energy.map((e) => ({ nutrient: { number: e.number, unitName: e.unitName }, amount: e.amount })), foodPortions: [],
  });
  const provider: [string, RawFood, number | null][] = [
    ['kJ only, 418.4 kJ / 4.184', raw([{ number: '268', unitName: 'kJ', amount: 418.4 }]), 100],
    ['kJ only, 837 kJ / 4.184 = 200.0478 -> 200.05', raw([{ number: '268', unitName: 'kJ', amount: 837 }]), 200.05],
    ['kcal wins over kJ', raw([{ number: '208', unitName: 'kcal', amount: 239 }, { number: '268', unitName: 'kJ', amount: 5000 }]), 239],
    ['a kJ amount with the wrong unit is unknown, never converted', raw([{ number: '268', unitName: 'kcal', amount: 418.4 }]), null],
    ['no energy at all is unknown, not 0', raw([{ number: '203', unitName: 'g', amount: 10 }]), null],
  ];
  test.each(provider)('provider energy: %s', (_name, food, kcal) => {
    expect(normalizeFood(food)!.food.energy_kcal).toBe(kcal);
  });
});

describe('unknown nutrients', () => {
  test('scaling keeps unknown as null and a recorded zero as 0, at any amount', () => {
    // fat 0 * 3 = 0 (recorded), fiber unknown * 3 = unknown, never 0
    const out = scaleNutrients(rice.per100g, 300);
    expect(out.fat_g).toBe(0);
    expect(out.fiber_g).toBeNull();
    expect(out.sugars_g).toBeNull();
  });

  // A: kcal 100, carbs 10. B: kcal 50, carbs unknown. C: kcal 0, carbs 0 (recorded).
  const A = n({ energy_kcal: 100, carbs_g: 10 });
  const B = n({ energy_kcal: 50 });
  const C = n({ energy_kcal: 0, carbs_g: 0 });
  const sums: [string, Nutrients[], Partial<Nutrients>, NutrientKey[]][] = [
    ['all known adds up: 100 + 0 = 100 kcal, carbs 10 + 0 = 10', [A, C], { energy_kcal: 100, carbs_g: 10 }, []],
    ['one unknown is a lower bound: kcal 100 + 50 = 150, carbs 10 (B unknown)', [A, B], { energy_kcal: 150, carbs_g: 10 }, ['carbs_g']],
    ['unknown does not hide a recorded zero: kcal 50 + 0 = 50, carbs 0 (B unknown)', [B, C], { energy_kcal: 50, carbs_g: 0 }, ['carbs_g']],
    ['nothing known is null (no data), still flagged', [B, B], { energy_kcal: 100 }, ['carbs_g']],
    ['no items is not a zero total', [], {}, []],
  ];
  test.each(sums)('sum: %s', (_name, items, totals, incomplete) => {
    const r = sumNutrients(items);
    expectNutrients(r.totals, totals);
    // every nutrient other than kcal and carbs is unknown in every item, so it is flagged whenever there is an item
    const unknownEverywhere = items.length ? (['protein_g', 'fat_g', 'fiber_g', 'sugars_g', 'sat_fat_g', 'sodium_mg'] as NutrientKey[]) : [];
    expect(new Set(r.incomplete)).toEqual(new Set([...incomplete, ...unknownEverywhere]));
  });

  test('a day with an unknown carb entry shows carbs as incomplete, and a day with no entries has no totals at all', () => {
    const e = (meal: string, nutrients: Partial<Nutrients>) =>
      entryFromRow({ id: meal, client_id: meal, meal, consumed_at: '2026-11-06T18:00:00Z', timezone: 'UTC', local_date: '2026-11-06', grams: 100, food_name: meal, provider: 'custom', ...nutrients } as never);
    const day = groupDay([e('lunch', { energy_kcal: 100, carbs_g: 10 }), e('dinner', { energy_kcal: 50 })]);
    expect(day.totals.energy_kcal).toBe(150);
    expect(day.totals.carbs_g).toBe(10);
    expect(day.incomplete).toContain('carbs_g');
    expect(day.incomplete).not.toContain('energy_kcal');
    expect(groupDay([])).toMatchObject({ count: 0, meals: [], incomplete: [] });
    expect(groupDay([]).totals.energy_kcal).toBeNull();
  });
});

describe('recipe yield', () => {
  // Raw ingredients: 300 g rice (130 kcal, 2.7 g protein, 1 mg sodium per 100 g) and 200 g chicken
  // (165 kcal, 31 g protein, sodium unknown). 500 g raw in all.
  const chicken: Food = { ...rice, id: 'f-chicken', name: 'Chicken', per100g: n({ energy_kcal: 165, protein_g: 31 }), portions: [] };
  const base = (o: Partial<Recipe>): Recipe => ({
    id: 'r1', name: 'Rice and chicken', notes: null, servings: 4, yieldG: 800,
    ingredients: [ingredientFromFood(rice, { mode: 'grams', amount: 300 })!, ingredientFromFood(chicken, { mode: 'grams', amount: 200 })!], ...o,
  });

  test('totals ignore the yield: kcal 300*1.3 + 200*1.65 = 390 + 330 = 720, protein 8.1 + 62 = 70.1, sodium unknown in chicken', () => {
    for (const yieldG of [800, 600, null]) {
      const { totals, incomplete } = recipeTotals(base({ yieldG }));
      expectNutrients(totals, { energy_kcal: 720, protein_g: 70.1, carbs_g: 84, fat_g: 0, sodium_mg: 3 });
      expect(incomplete).toContain('sodium_mg');
    }
  });

  // [yield, per-100 g kcal, grams in one of 4 servings]
  // per-100 g = 720 / (yield / 100). one serving = 1/4 of the weight.
  const yields: [number | null, number, number][] = [
    [800, 90, 200], // 720 / 8 = 90; 800 / 4 = 200 g
    [600, 120, 150], // 720 / 6 = 120; 600 / 4 = 150 g
    [null, 144, 125], // no cooked weight, so the raw 500 g: 720 / 5 = 144; 500 / 4 = 125 g
  ];
  test.each(yields)('cooked weight %p: per 100 g %p kcal, one serving weighs %p g, one serving is always 180 kcal', (yieldG, kcalPer100, servingGrams) => {
    const r = base({ yieldG });
    const { totals } = recipeTotals(r);
    expect(per100g(r, totals).energy_kcal).toBeCloseTo(kcalPer100, 9);
    expect(perServing(r, totals).energy_kcal).toBeCloseTo(180, 9); // 720 / 4
    expect(perServing(r, totals).protein_g).toBeCloseTo(17.525, 9); // 70.1 / 4
    const one = recipeSnapshot(r, { mode: 'servings', count: 1 })!;
    expect(one.grams).toBeCloseTo(servingGrams, 9);
    expect(one.nutrients.energy_kcal).toBeCloseTo(180, 9);
  });

  test('servings and grams of the cooked weight are the same fraction of the recipe', () => {
    const r = base({});
    // 2 of 4 servings = fraction 0.5 = 400 g of 800 g, kcal 360. 200 g of 800 g = fraction 0.25, kcal 180.
    expect(recipeSnapshot(r, { mode: 'servings', count: 2 })!.nutrients.energy_kcal).toBeCloseTo(360, 9);
    expect(recipeSnapshot(r, { mode: 'grams', amount: 400 })!.nutrients.energy_kcal).toBeCloseTo(360, 9);
    expect(recipeSnapshot(r, { mode: 'grams', amount: 200 })!.nutrients.energy_kcal).toBeCloseTo(180, 9);
    // 6 servings = 1.5 recipes: grams 1200, kcal 1080
    const six = recipeSnapshot(r, { mode: 'servings', count: 6 })!;
    expect([six.grams, six.nutrients.energy_kcal]).toEqual([1200, 1080]);
  });

  test('gram portions need a cooked weight, and a nutrient unknown in any ingredient is saved as unknown, not as a partial sum', () => {
    expect(resolveRecipePortion(base({ yieldG: null }), { mode: 'grams', amount: 100 })).toBeNull();
    const snap = recipeSnapshot(base({}), { mode: 'servings', count: 1 })!;
    expect(snap.nutrients.sodium_mg).toBeNull(); // rice alone would have given 0.75 mg
    expect(snap.nutrients.energy_kcal).toBeCloseTo(180, 9);
  });

  test('a meal (1 serving, no cooked weight) logs as a whole: 1 serving = all 500 g and all 720 kcal', () => {
    const snap = recipeSnapshot(base({ servings: 1, yieldG: null }), { mode: 'servings', count: 1 })!;
    expect([snap.grams, snap.nutrients.energy_kcal]).toEqual([500, 720]);
  });
});

describe('edits scale the entry snapshot', () => {
  // Logged as 100 g of rice: kcal 130, protein 2.7, carbs 28, fat 0 (recorded), fiber unknown.
  const logged = () => entryFromRow({
    id: 'e1', client_id: 'c1', food_id: 'f-rice', meal: 'lunch', consumed_at: '2026-11-06T18:00:00Z', timezone: 'UTC', local_date: '2026-11-06', grams: 100,
    food_name: rice.name, provider: 'usda_fdc', provider_id: '1', energy_kcal: 130, protein_g: 2.7, carbs_g: 28, fat_g: 0, sodium_mg: 1,
  } as never);

  const edits: [string, Quantity, number, Partial<Nutrients>][] = [
    ['to 250 g: factor 2.5', { mode: 'grams', amount: 250 }, 250, { energy_kcal: 325, protein_g: 6.75, carbs_g: 70, fat_g: 0, sodium_mg: 2.5 }],
    ['to 50 g: factor 0.5', { mode: 'grams', amount: 50 }, 50, { energy_kcal: 65, protein_g: 1.35, carbs_g: 14, fat_g: 0, sodium_mg: 0.5 }],
    // 2 cups = 316 g, factor 3.16: kcal 410.8, protein 8.532, carbs 88.48
    ['to 2 cups (316 g)', { mode: 'portion', portion: cup, count: 2 }, 316, { energy_kcal: 410.8, protein_g: 8.532, carbs_g: 88.48, fat_g: 0, sodium_mg: 3.16 }],
  ];
  test.each(edits)('%s', (_name, quantity, grams, expected) => {
    const patch = buildEdit(logged(), { quantity });
    expect(patch.grams).toBeCloseTo(grams, 9);
    expectNutrients(n(Object.fromEntries(Object.keys(emptyNutrients()).map((k) => [k, patch[k]]))), expected);
  });

  test('editing twice lands where editing once would: 100 -> 200 -> 50 g is 65 kcal, the same as 100 -> 50 g', () => {
    const first = buildEdit(logged(), { quantity: { mode: 'grams', amount: 200 } }); // 260 kcal
    const second = buildEdit({ ...logged(), grams: 200, nutrients: { ...logged().nutrients, energy_kcal: first.energy_kcal as number } }, { quantity: { mode: 'grams', amount: 50 } });
    expect(second.energy_kcal).toBeCloseTo(65, 9); // 260 * 50 / 200
  });

  test('a meal, time or estimate edit changes no nutrient', () => {
    const patch = buildEdit(logged(), { meal: 'dinner', isEstimated: true });
    expect(patch).toEqual({ meal: 'dinner', is_estimated: true });
  });
});

describe('immutable snapshots', () => {
  test('editing the food after logging changes nothing already logged, and an amount edit scales the saved values, not the new ones', async () => {
    mockEnqueue.mockReset();
    const food: Food = { ...rice, per100g: { ...rice.per100g } };
    await logFood({ food, quantity: { mode: 'grams', amount: 200 }, meal: 'lunch', consumedAt: new Date('2026-11-06T18:00:00Z'), clientId: 'c-food' });
    const row = mockEnqueue.mock.calls[0][1].row;
    expect([row.food_name, row.energy_kcal]).toEqual(['Rice, cooked', 260]); // 130 * 2
    // The food changes: new name, new value (999 kcal per 100 g).
    food.name = 'Renamed';
    food.per100g.energy_kcal = 999;
    expect([row.food_name, row.energy_kcal]).toEqual(['Rice, cooked', 260]);
    // Edit the entry to 100 g: 260 * 100 / 200 = 130, not 999.
    const entry = entryFromRow({ ...row, id: 'e1', meal: 'lunch', consumed_at: '2026-11-06T18:00:00Z', local_date: '2026-11-06' });
    expect(buildEdit(entry, { quantity: { mode: 'grams', amount: 100 } }).energy_kcal).toBeCloseTo(130, 9);
  });

  test('editing or deleting the recipe after logging changes nothing already logged', async () => {
    mockEnqueue.mockReset();
    const recipe: Recipe = {
      id: 'r1', name: 'Rice bowl', notes: null, servings: 2, yieldG: 400,
      ingredients: [ingredientFromFood(rice, { mode: 'grams', amount: 400 })!], // 400 g rice: 520 kcal
    };
    await logRecipe({ recipe, quantity: { mode: 'servings', count: 1 }, meal: 'dinner', consumedAt: new Date('2026-11-06T23:00:00Z'), clientId: 'c-recipe' });
    const row = mockEnqueue.mock.calls[0][1].row;
    // 1 of 2 servings: 200 g, 260 kcal (520 / 2)
    expect([row.grams, row.energy_kcal, row.food_name]).toEqual([200, 260, 'Rice bowl']);
    const before = JSON.stringify(row);
    // The saved recipe changes: a heavier ingredient, a new yield, a new name, and its payload is rebuilt.
    recipe.ingredients[0] = { ...recipe.ingredients[0], grams: 1000, per100g: n({ energy_kcal: 999 }) };
    recipe.yieldG = 100;
    recipe.name = 'Renamed';
    expect((recipePayload(recipe).ingredients[0] as Record<string, unknown>).energy_kcal).toBe(999); // the recipe moved on
    expect(JSON.stringify(row)).toBe(before); // the entry did not
    // The entry scales its own snapshot: 100 g of the 200 g is 130 kcal.
    const entry = entryFromRow({ ...row, id: 'e2', meal: 'dinner', consumed_at: '2026-11-06T23:00:00Z', local_date: '2026-11-06' });
    expect(buildEdit(entry, { quantity: { mode: 'grams', amount: 100 } }).energy_kcal).toBeCloseTo(130, 9);
  });
});
