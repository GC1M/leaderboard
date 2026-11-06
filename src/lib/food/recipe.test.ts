import { buildEdit, entryFromRow } from './diary';
import { emptyNutrients } from './nutrition';
import { per100g, perServing, recipeCaveats, recipePayload, type Recipe, recipeSnapshot, recipeTotals, resolveRecipePortion, validateRecipe } from './recipe';
import { logRecipe } from './recipes';

const mockEnqueue = jest.fn();
const mockFlush = jest.fn();
jest.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) } } }));
jest.mock('./pending', () => ({ enqueue: (...a: unknown[]) => mockEnqueue(...a), flushPending: (...a: unknown[]) => mockFlush(...a) }));
jest.mock('@/lib/timezone', () => ({ deviceTimezone: () => 'America/Chicago' }));

const n = (o: Partial<ReturnType<typeof emptyNutrients>>) => ({ ...emptyNutrients(), ...o });
const rice = { foodId: 'f1', name: 'Rice, cooked', grams: 300, per100g: n({ energy_kcal: 130, protein_g: 2.7, sodium_mg: 1 }) };
const sauce = { foodId: null, name: 'Sauce', grams: 100, per100g: n({ energy_kcal: 200, protein_g: 1 }) }; // sodium unknown
const recipe = (o: Partial<Recipe> = {}): Recipe => ({ id: 'r1', name: 'Rice bowl', notes: null, servings: 2, yieldG: 500, ingredients: [{ ...rice }, { ...sauce }], ...o });

test('totals sum the ingredients scaled by grams and flag unknown nutrients as incomplete', () => {
  const t = recipeTotals(recipe());
  expect(t.totals.energy_kcal).toBeCloseTo(590); // 390 + 200
  expect(t.totals.protein_g).toBeCloseTo(9.1);
  expect(t.totals.sodium_mg).toBeCloseTo(3); // only the known part
  expect(t.incomplete).toContain('sodium_mg');
  expect(t.incomplete).not.toContain('energy_kcal');
  expect(t.totals.fiber_g).toBeNull(); // unknown everywhere stays null, not 0
});

test('per serving and per 100 g come from servings and the cooked weight', () => {
  const r = recipe();
  const t = recipeTotals(r).totals;
  expect(perServing(r, t).energy_kcal).toBeCloseTo(295);
  expect(per100g(r, t).energy_kcal).toBeCloseTo(118); // 590 / 500 g
  // Without a cooked weight the ingredient weights (400 g) are used.
  expect(per100g(recipe({ yieldG: null }), t).energy_kcal).toBeCloseTo(147.5);
  expect(perServing(r, t).fiber_g).toBeNull();
});

test('a portion is N servings or grams of the cooked yield', () => {
  const r = recipe();
  expect(resolveRecipePortion(r, { mode: 'servings', count: 1 })).toMatchObject({ grams: 250, portionLabel: 'serving', portionCount: 1, fraction: 0.5 });
  expect(resolveRecipePortion(r, { mode: 'grams', amount: 100 })).toMatchObject({ grams: 100, portionLabel: null, fraction: 0.2 });
  // No cooked weight: grams of the cooked yield is not defined, servings use the raw weight.
  expect(resolveRecipePortion(recipe({ yieldG: null }), { mode: 'grams', amount: 100 })).toBeNull();
  expect(resolveRecipePortion(recipe({ yieldG: null }), { mode: 'servings', count: 1 })?.grams).toBe(200);
  for (const count of [0, -1, Number.NaN, 100001]) expect(resolveRecipePortion(r, { mode: 'servings', count })).toBeNull();
});

test('the snapshot saves incomplete nutrients as unknown, not as a partial sum', () => {
  const s = recipeSnapshot(recipe(), { mode: 'servings', count: 1 })!;
  expect(s.nutrients.energy_kcal).toBeCloseTo(295);
  expect(s.nutrients.sodium_mg).toBeNull();
  expect(s.incomplete).toContain('sodium_mg');
  expect(recipeSnapshot(recipe(), { mode: 'servings', count: 0 })).toBeNull();
});

test('a meal (one serving, no cooked weight) logs as a whole', () => {
  const s = recipeSnapshot(recipe({ servings: 1, yieldG: null }), { mode: 'servings', count: 1 })!;
  expect(s.grams).toBe(400);
  expect(s.nutrients.energy_kcal).toBeCloseTo(590);
});

test('caveats name missing nutrients and the weight basis, and never claim exactness', () => {
  const c = recipeCaveats(recipe({ notes: 'Rice is cooked.' }), ['sodium_mg']).join(' ');
  expect(c).toMatch(/Estimate/);
  expect(c).toMatch(/sodium/);
  expect(c).toMatch(/cooked weight you entered/);
  expect(c).toMatch(/Rice is cooked\./);
  expect(recipeCaveats(recipe({ yieldG: null }), []).join(' ')).toMatch(/No cooked weight/);
});

test('validation and payload', () => {
  expect(validateRecipe(recipe())).toBeNull();
  expect(validateRecipe(recipe({ name: ' ' }))).toMatch(/names/);
  expect(validateRecipe(recipe({ servings: 0 }))).toMatch(/Servings/);
  expect(validateRecipe(recipe({ yieldG: -1 }))).toMatch(/Cooked weight/);
  expect(validateRecipe(recipe({ ingredients: [] }))).toMatch(/ingredient/);
  expect(validateRecipe(recipe({ ingredients: [{ ...rice, grams: 0 }] }))).toMatch(/amount/);
  const p = recipePayload(recipe({ notes: '  ' }));
  expect(p).toMatchObject({ name: 'Rice bowl', notes: null, servings: 2, yield_g: 500 });
  expect(p.ingredients[1]).toMatchObject({ food_id: null, food_name: 'Sauce', grams: 100, energy_kcal: 200, sodium_mg: null });
});

describe('logging a recipe', () => {
  beforeEach(() => { mockEnqueue.mockReset(); mockFlush.mockReset().mockResolvedValue(0); });

  test('saves one recipe snapshot entry that later recipe edits do not change', async () => {
    const r = recipe();
    expect(await logRecipe({ recipe: r, quantity: { mode: 'servings', count: 1 }, meal: 'lunch', consumedAt: new Date('2026-11-08T18:00:00Z'), clientId: 'c1' })).toBe(true);
    const row = mockEnqueue.mock.calls[0][1].row;
    expect(row).toMatchObject({ provider: 'recipe', provider_id: null, food_id: null, food_name: 'Rice bowl', grams: 250, portion_label: 'serving', portion_count: 1, is_estimated: true, timezone: 'America/Chicago', sodium_mg: null });
    const before = JSON.stringify(row);
    // Edit the recipe afterwards: the saved row is its own copy.
    r.name = 'Changed';
    r.ingredients[0].grams = 1;
    expect(JSON.stringify(row)).toBe(before);
    expect(recipeTotals(r).totals.energy_kcal).not.toBeCloseTo(row.energy_kcal * 2);
  });

  test('editing the amount of a recipe entry scales its own snapshot', async () => {
    await logRecipe({ recipe: recipe(), quantity: { mode: 'servings', count: 1 }, meal: 'lunch', consumedAt: new Date(), clientId: 'c2' });
    const entry = entryFromRow({ ...mockEnqueue.mock.calls[0][1].row, meal: 'lunch', consumed_at: new Date().toISOString() });
    expect(entry.provider).toBe('recipe');
    const patch = buildEdit(entry, { quantity: { mode: 'grams', amount: 125 } });
    expect(patch.energy_kcal).toBeCloseTo(147.5);
    expect(patch.sodium_mg).toBeNull();
  });

  test('rejects an unusable amount and reports an unsynced send', async () => {
    await expect(logRecipe({ recipe: recipe(), quantity: { mode: 'servings', count: 0 }, meal: 'lunch', consumedAt: new Date(), clientId: 'c3' })).rejects.toThrow(/servings/);
    mockFlush.mockResolvedValue(1);
    expect(await logRecipe({ recipe: recipe(), quantity: { mode: 'grams', amount: 100 }, meal: 'dinner', consumedAt: new Date(), clientId: 'c4' })).toBe(false);
  });
});
