// Food search and custom foods (#45). USDA results come from the food-search edge function, which holds the
// FDC key and caches rows in public.foods; this file never talks to FDC. Nutrients are per 100 g.
import type { Tables } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';

import { emptyNutrients, NUTRIENT_KEYS, type Nutrients } from './nutrition';

export type Portion = { id: string; label: string; gramWeight: number };
export type Food = {
  id: string;
  name: string;
  brand: string | null;
  provider: 'usda_fdc' | 'custom';
  providerId: string | null;
  sourceDataType: string | null;
  sourceVersion: string | null;
  per100g: Nutrients;
  portions: Portion[];
};

export const FDC_ATTRIBUTION =
  'Nutrition data from the U.S. Department of Agriculture, Agricultural Research Service. FoodData Central. fdc.nal.usda.gov.';
export const ESTIMATE_NOTE = 'Nutrition values are estimates, not medical advice.';

type FoodRow = Tables<'foods'> & { food_portions?: Tables<'food_portions'>[] | null };

// Postgres numeric comes back as a number or string; null stays unknown.
const num = (v: unknown): number | null => (v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export function foodFromRow(r: FoodRow): Food {
  const per100g = emptyNutrients();
  for (const k of NUTRIENT_KEYS) per100g[k] = num(r[k]);
  return {
    id: r.id,
    name: r.name,
    brand: r.brand,
    provider: r.provider as Food['provider'],
    providerId: r.provider_id,
    sourceDataType: r.source_data_type,
    sourceVersion: r.source_version,
    per100g,
    // A portion without a positive gram weight cannot be used.
    portions: (r.food_portions ?? [])
      .map((p) => ({ id: p.id, label: p.label, gramWeight: Number(p.gram_weight) }))
      .filter((p) => Number.isFinite(p.gramWeight) && p.gramWeight > 0)
      .sort((a, b) => a.label.localeCompare(b.label)),
  };
}

export type SearchFailure = 'network' | 'not_configured' | 'rate_limited' | 'provider_timeout' | 'provider_error' | 'unauthorized' | 'bad_request' | 'cache_error' | 'unknown';

const FAILURE_MESSAGES: Record<SearchFailure, string> = {
  network: "Couldn't reach the server. Check your connection.",
  not_configured: 'Food search is not available right now.',
  rate_limited: 'Food search is busy. Try again in a few minutes.',
  provider_timeout: 'The food database took too long to answer.',
  provider_error: "Couldn't reach the food database.",
  unauthorized: 'Sign in to search foods.',
  bad_request: 'Try a different search.',
  cache_error: "Couldn't load search results. Try again.",
  unknown: "Couldn't search foods. Try again.",
};

export class FoodSearchError extends Error {
  constructor(readonly code: SearchFailure) {
    super(FAILURE_MESSAGES[code]);
  }
}

// invoke() reports a non-2xx answer as an error whose `context` is the Response, so read our error code from its body.
async function failureCode(error: { name?: string; context?: unknown }): Promise<SearchFailure> {
  if (error.name === 'FunctionsFetchError') return 'network';
  try {
    const body = (await (error.context as Response).json()) as { error?: { code?: string } };
    const code = body.error?.code as SearchFailure | undefined;
    return code && code in FAILURE_MESSAGES ? code : 'unknown';
  } catch {
    return 'unknown';
  }
}

// fromCache: the food database failed (`failure` says how) and these are matching foods already saved on our server.
export type SearchPage = { foods: Food[]; page: number; totalHits: number; fromCache: boolean; failure: SearchFailure | null };

export async function searchFoods(query: string, page = 1): Promise<SearchPage> {
  const { data, error } = await supabase.functions.invoke('food-search', { body: { query, page, pageSize: 20 } });
  if (error) throw new FoodSearchError(await failureCode(error));
  const d = data as { foods?: FoodRow[]; page?: number; totalHits?: number; fromCache?: boolean; failure?: SearchFailure } | null;
  if (!d || !Array.isArray(d.foods)) throw new FoodSearchError('unknown');
  return { foods: d.foods.map(foodFromRow), page: d.page ?? page, totalHits: d.totalHits ?? d.foods.length, fromCache: d.fromCache === true, failure: d.failure ?? null };
}

// What is already in the cache plus your own custom foods. RLS limits this to foods you may see.
export async function searchCachedFoods(query: string, customOnly = false): Promise<Food[]> {
  const pattern = `%${query.trim().replace(/[\\%_]/g, '\\$&')}%`;
  let q = supabase.from('foods').select('*, food_portions(*)').ilike('name', pattern);
  if (customOnly) q = q.eq('provider', 'custom');
  const { data, error } = await q.order('name').limit(20);
  if (error) throw new Error("Couldn't load saved foods. Try again.");
  return (data ?? []).map(foodFromRow);
}

export async function getFood(id: string): Promise<Food | null> {
  const { data, error } = await supabase.from('foods').select('*, food_portions(*)').eq('id', id).maybeSingle();
  if (error) throw new Error("Couldn't load that food. Try again.");
  return data ? foodFromRow(data) : null;
}

export type CustomFoodInput = { name: string; brand?: string; per100g: Nutrients };

export function validateCustomFood(input: CustomFoodInput): string | null {
  const name = input.name.trim();
  if (name.length < 1 || name.length > 200) return 'Food names must be 1 to 200 characters.';
  if ((input.brand?.trim().length ?? 0) > 200) return 'Brand names must be 200 characters or fewer.';
  for (const k of NUTRIENT_KEYS) {
    const v = input.per100g[k];
    if (v != null && (!Number.isFinite(v) || v < 0)) return 'Nutrient amounts cannot be negative.';
  }
  const { energy_kcal: kcal, protein_g, carbs_g, fat_g } = input.per100g;
  if (kcal != null && kcal > 1000) return 'Calories per 100 g cannot be more than 1000.';
  const { fiber_g, sugars_g, sat_fat_g, sodium_mg } = input.per100g;
  if ([protein_g, carbs_g, fat_g, fiber_g, sugars_g, sat_fat_g].some((g) => g != null && g > 100)) return 'Grams per 100 g cannot be more than 100.';
  if (sodium_mg != null && sodium_mg > 100000) return 'Sodium per 100 g cannot be more than 100,000 mg.';
  return null;
}

export async function createCustomFood(input: CustomFoodInput): Promise<Food> {
  const invalid = validateCustomFood(input);
  if (invalid) throw new Error(invalid);
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('Sign in to save your foods.');
  const { data, error } = await supabase
    .from('foods')
    .insert({ ...input.per100g, provider: 'custom', user_id: auth.user.id, name: input.name.trim(), brand: input.brand?.trim() || null })
    .select('*')
    .single();
  if (error) throw new Error(error.code === '23514' ? 'Check the nutrient amounts. Values are per 100 g.' : "Couldn't save that food. Try again.");
  return foodFromRow(data);
}
