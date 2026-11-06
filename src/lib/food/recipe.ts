// Recipe and meal math (#46). Pure, no I/O. A recipe is ingredients (grams, each with its own per-100 g copy of
// the food's nutrients) plus servings and an optional cooked weight. Totals are estimates: a nutrient unknown
// in any ingredient makes that total incomplete (a lower bound), never a silent 0. Applying a recipe to a day
// logs one entry holding a copy of the scaled totals, so later recipe edits never reach it.
import { MAX_GRAMS, MAX_PORTION_COUNT, type Quantity, resolveQuantity } from './log';
import { NUTRIENT_NAMES } from './format';
import type { Food } from './search';
import { NUTRIENT_KEYS, type NutrientKey, type NutrientTotals, type Nutrients, scaleNutrients, scaleSnapshot, sumNutrients } from './nutrition';

export type Ingredient = { foodId: string | null; name: string; grams: number; per100g: Nutrients };
// servings: how many servings it makes (a reusable meal is 1). yieldG: total cooked weight, null if not weighed.
export type Recipe = { id: string | null; name: string; notes: string | null; servings: number; yieldG: number | null; ingredients: Ingredient[] };

// An ingredient from a picked food and an amount in grams or in one of its portions (needs a gram weight).
// Null when the amount is not usable. `note` keeps the portion as read-only context; the saved amount is grams.
export function ingredientFromFood(food: Food, q: Quantity): (Ingredient & { note?: string }) | null {
  const r = resolveQuantity(q);
  if (!r) return null;
  const note = r.portionLabel ? `${Math.round((r.portionCount ?? 0) * 100) / 100} x ${r.portionLabel}` : undefined;
  return { foodId: food.id, name: food.name, grams: r.grams, per100g: food.per100g, note };
}

export const ingredientGrams = (r: Pick<Recipe, 'ingredients'>) => r.ingredients.reduce((a, i) => a + i.grams, 0);
// The weight a gram amount or per-100 g value refers to: the cooked weight when given, else the raw ingredients.
export const recipeGrams = (r: Recipe) => r.yieldG ?? ingredientGrams(r);

// Whole recipe. `incomplete` lists nutrients some ingredient did not know.
export const recipeTotals = (r: Recipe): NutrientTotals => sumNutrients(r.ingredients.map((i) => scaleNutrients(i.per100g, i.grams)));

export const perServing = (r: Recipe, t: Nutrients): Nutrients => scaleSnapshot(t, r.servings, 1);
export const per100g = (r: Recipe, t: Nutrients): Nutrients => scaleSnapshot(t, recipeGrams(r), 100);

// Plain-language limits of the numbers, shown wherever totals are.
export function recipeCaveats(r: Recipe, incomplete: readonly NutrientKey[]): string[] {
  const out = ['Estimate from the ingredient values saved when each was added.'];
  if (incomplete.length) out.push(`Missing values in some ingredients: ${incomplete.map((k) => NUTRIENT_NAMES[k].toLowerCase()).join(', ')}. Totals for these are lower bounds or unknown.`);
  out.push(r.yieldG ? 'Per 100 g and gram portions use the cooked weight you entered.' : 'No cooked weight entered, so per 100 g and gram portions use the total ingredient weight.');
  if (r.notes?.trim()) out.push(r.notes.trim());
  return out;
}

// The largest nutrient amounts a food entry may hold (the food_entries column checks).
const ENTRY_CAPS: Nutrients = { energy_kcal: 1e6, protein_g: 1e5, carbs_g: 1e5, fat_g: 1e5, fiber_g: 1e5, sugars_g: 1e5, sat_fat_g: 1e5, sodium_mg: 1e8 };

export type RecipeQuantity = { mode: 'servings'; count: number } | { mode: 'grams'; amount: number };
export type RecipePortion = { grams: number; portionLabel: string | null; portionCount: number | null; fraction: number };

export const recipeAmountMessage = (mode: RecipeQuantity['mode']) =>
  `${mode === 'grams' ? 'Enter an amount above 0 and up to 100,000 g.' : 'Enter a number of servings above 0. The total can be up to 100,000 g.'} The nutrient totals must also stay within what an entry can hold.`;

// Why an amount cannot be logged: not a usable amount, or fine by itself but too large for an entry's columns.
export const recipeAmountError = (r: Recipe, q: RecipeQuantity) =>
  resolveRecipePortion(r, q) && !recipeSnapshot(r, q) ? 'That amount is too large to save.' : recipeAmountMessage(q.mode);

// What part of the recipe is eaten: N servings, or grams of the cooked yield (needs a cooked weight). Null when unusable.
export function resolveRecipePortion(r: Recipe, q: RecipeQuantity): RecipePortion | null {
  const total = recipeGrams(r);
  if (!(total > 0) || !(r.servings > 0)) return null;
  if (q.mode === 'grams' && !r.yieldG) return null;
  const fraction = q.mode === 'servings' ? q.count / r.servings : q.amount / total;
  const grams = fraction * total;
  if (!Number.isFinite(grams) || grams <= 0 || grams > MAX_GRAMS) return null;
  if (q.mode === 'servings' && q.count > MAX_PORTION_COUNT) return null;
  return q.mode === 'servings' ? { grams, portionLabel: 'serving', portionCount: q.count, fraction } : { grams, portionLabel: null, portionCount: null, fraction };
}

// The nutrients saved on the entry. A nutrient unknown in any ingredient is saved as unknown (null), not as a
// partial sum, so the diary shows it as incomplete instead of an exact-looking number. Null when the amount is unusable.
export function recipeSnapshot(r: Recipe, q: RecipeQuantity): (RecipePortion & { nutrients: Nutrients; incomplete: NutrientKey[] }) | null {
  const p = resolveRecipePortion(r, q);
  if (!p) return null;
  const { totals, incomplete } = recipeTotals(r);
  const nutrients = scaleSnapshot(totals, 1, p.fraction);
  for (const k of incomplete) nutrients[k] = null;
  // Too much for an entry row: the server would refuse it for good, so refuse it here.
  if (NUTRIENT_KEYS.some((k) => (nutrients[k] ?? 0) > (ENTRY_CAPS[k] ?? 0))) return null;
  return { ...p, nutrients, incomplete };
}

export function validateRecipe(r: Recipe): string | null {
  const name = r.name.trim();
  if (name.length < 1 || name.length > 200) return 'Recipe names must be 1 to 200 characters.';
  if ((r.notes?.trim().length ?? 0) > 2000) return 'Notes must be 2,000 characters or fewer.';
  if (!Number.isFinite(r.servings) || r.servings <= 0 || r.servings > 1000) return 'Servings must be more than 0 and up to 1,000.';
  if (r.yieldG != null && (!Number.isFinite(r.yieldG) || r.yieldG <= 0 || r.yieldG > MAX_GRAMS)) return 'Cooked weight must be more than 0 and up to 100,000 g.';
  if (r.ingredients.length < 1) return 'Add at least one ingredient.';
  if (r.ingredients.length > 100) return 'A recipe can have up to 100 ingredients.';
  if (r.ingredients.some((i) => !Number.isFinite(i.grams) || i.grams <= 0 || i.grams > MAX_GRAMS)) return 'Each ingredient needs an amount above 0 and up to 100,000 g.';
  return null;
}

// The recipe as the save_food_recipe RPC takes it.
export const recipePayload = (r: Recipe) => ({
  name: r.name.trim(),
  notes: r.notes?.trim() || null,
  servings: r.servings,
  yield_g: r.yieldG,
  ingredients: r.ingredients.map((i) => ({ food_id: i.foodId, food_name: i.name, grams: i.grams, ...Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, i.per100g[k]])) })),
});
