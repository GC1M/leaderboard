// Logging a food entry (#45): resolve the amount to grams, snapshot the nutrients for that amount and insert.
// The snapshot is an estimate computed here; the server only bounds it (see the food_entries migration).
import { supabase } from '@/lib/supabase';
import { deviceTimezone } from '@/lib/timezone';

import { portionToGrams, scaleNutrients, type Nutrients } from './nutrition';
import type { Food, Portion } from './search';

export const MEALS = [
  { value: 'breakfast', label: 'Breakfast' },
  { value: 'lunch', label: 'Lunch' },
  { value: 'dinner', label: 'Dinner' },
  { value: 'snack', label: 'Snack' },
] as const;
export type Meal = (typeof MEALS)[number]['value'];

export const MAX_GRAMS = 100000;
export const MAX_PORTION_COUNT = 100000;
export const amountMessage = (mode: Quantity['mode']) =>
  mode === 'grams' ? 'Enter an amount from 0 to 100,000 g' : 'Enter a number of portions from 0 to 100,000, up to 100,000 g in total';

export function defaultMeal(at: Date): Meal {
  const h = at.getHours();
  return h >= 5 && h < 11 ? 'breakfast' : h >= 11 && h < 16 ? 'lunch' : h >= 16 && h < 22 ? 'dinner' : 'snack';
}

export type Quantity = { mode: 'grams'; amount: number } | { mode: 'portion'; portion: Portion; count: number };
export type ResolvedQuantity = { grams: number; portionLabel: string | null; portionCount: number | null };

// Null when the amount is not usable: not a positive number, over the limit, or a portion without a gram weight.
export function resolveQuantity(q: Quantity): ResolvedQuantity | null {
  if (q.mode === 'portion' && q.count > MAX_PORTION_COUNT) return null;
  const grams = q.mode === 'grams' ? q.amount : portionToGrams(q.count, q.portion.gramWeight);
  if (grams == null || !Number.isFinite(grams) || grams <= 0 || grams > MAX_GRAMS) return null;
  return q.mode === 'grams' ? { grams, portionLabel: null, portionCount: null } : { grams, portionLabel: q.portion.label, portionCount: q.count };
}

// Nutrients for the amount eaten, or null when the amount is not usable. Unknown stays null.
export function consumedNutrients(food: Food, q: Quantity): Nutrients | null {
  const r = resolveQuantity(q);
  return r ? scaleNutrients(food.per100g, r.grams) : null;
}

export type LogInput = { food: Food; quantity: Quantity; meal: Meal; consumedAt: Date; clientId: string };

// Saving the same clientId twice never makes a second entry, so a retry after a failed save is safe.
export async function logFood({ food, quantity, meal, consumedAt, clientId }: LogInput): Promise<void> {
  const r = resolveQuantity(quantity);
  if (!r) throw new Error(amountMessage(quantity.mode));
  if (!Number.isFinite(consumedAt.getTime())) throw new Error('Choose a valid time.');
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('Sign in to log food.');
  const n = scaleNutrients(food.per100g, r.grams);
  const { error } = await supabase.from('food_entries').upsert(
    {
      user_id: auth.user.id,
      client_id: clientId,
      food_id: food.id,
      meal,
      consumed_at: consumedAt.toISOString(),
      timezone: deviceTimezone(),
      grams: r.grams,
      portion_label: r.portionLabel,
      portion_count: r.portionCount,
      is_estimated: false,
      food_name: food.name,
      food_brand: food.brand,
      provider: food.provider,
      provider_id: food.providerId,
      source_data_type: food.sourceDataType,
      source_version: food.sourceVersion,
      ...n,
    },
    { onConflict: 'user_id,client_id', ignoreDuplicates: true },
  );
  if (error) throw new Error("Couldn't log that food. Try again.");
}
