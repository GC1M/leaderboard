// Saving, loading and applying recipes and meals (#46). The math is in ./recipe; this file talks to the server.
import { supabase } from '@/lib/supabase';

import { logEntry, type Meal } from './log';
import { emptyNutrients, NUTRIENT_KEYS } from './nutrition';
import { type Ingredient, type Recipe, recipeAmountError, recipePayload, type RecipeQuantity, recipeSnapshot, validateRecipe } from './recipe';

const SAVE_MESSAGE = "Couldn't save your recipe. Check your connection and try again.";
const LOAD_MESSAGE = "Couldn't load your recipes. Pull down to try again.";
const num = (v: unknown): number | null => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));

export type RecipeSummary = { id: string; name: string; servings: number; yieldG: number | null };

export async function listRecipes(): Promise<RecipeSummary[]> {
  const { data, error } = await supabase.from('food_recipes').select('id, name, servings, yield_g').order('updated_at', { ascending: false });
  if (error) throw new Error(LOAD_MESSAGE);
  return data.map((r) => ({ id: r.id, name: r.name, servings: Number(r.servings), yieldG: num(r.yield_g) }));
}

export async function getRecipe(id: string): Promise<Recipe | null> {
  const { data, error } = await supabase.from('food_recipes').select('*, food_recipe_ingredients(*)').eq('id', id).maybeSingle();
  if (error) throw new Error(LOAD_MESSAGE);
  if (!data) return null;
  const ingredients: Ingredient[] = [...data.food_recipe_ingredients]
    .sort((a, b) => a.position - b.position)
    .map((i) => {
      const per100g = emptyNutrients();
      for (const k of NUTRIENT_KEYS) per100g[k] = num(i[k]);
      return { foodId: i.food_id, name: i.food_name, grams: Number(i.grams), per100g };
    });
  return { id: data.id, name: data.name, notes: data.notes, servings: Number(data.servings), yieldG: num(data.yield_g), ingredients };
}

// Insert when id is null, else replace the ingredients (one atomic RPC). Entries already logged are untouched.
export async function saveRecipe(id: string | null, recipe: Recipe): Promise<string> {
  const problem = validateRecipe(recipe);
  if (problem) throw new Error(problem);
  const { data, error } = await supabase.rpc('save_food_recipe', { p_id: id as string, p_recipe: recipePayload(recipe) });
  if (error || !data) throw new Error(SAVE_MESSAGE);
  return data;
}

// Entries logged from it keep their own copy.
export async function deleteRecipe(id: string): Promise<void> {
  const { error } = await supabase.from('food_recipes').delete().eq('id', id);
  if (error) throw new Error("Couldn't delete that recipe. Check your connection and try again.");
}

export type LogRecipeInput = { recipe: Recipe; quantity: RecipeQuantity; meal: Meal; consumedAt: Date; clientId: string; isEstimated?: boolean };

// Logs one snapshot entry (provider 'recipe', no food id, no provider id) through the same saved-on-device-first
// path as foods. Resolves to false when the send failed and the entry is waiting to sync.
export async function logRecipe({ recipe, quantity, meal, consumedAt, clientId, isEstimated = true }: LogRecipeInput): Promise<boolean> {
  const s = recipeSnapshot(recipe, quantity);
  if (!s) throw new Error(recipeAmountError(recipe, quantity));
  return logEntry(clientId, consumedAt, {
    client_id: clientId,
    food_id: null,
    meal,
    grams: s.grams,
    portion_label: s.portionLabel,
    portion_count: s.portionCount,
    is_estimated: isEstimated,
    food_name: recipe.name.trim(),
    food_brand: null,
    provider: 'recipe',
    provider_id: null,
    source_data_type: null,
    source_version: null,
    ...s.nutrients,
  });
}
