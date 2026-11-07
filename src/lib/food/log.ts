// Logging a food entry (#45): resolve the amount to grams, snapshot the nutrients for that amount and insert.
// The snapshot is an estimate computed here; the server only bounds it (see the food_entries migration).
import { supabase } from '@/lib/supabase';
import { deviceTimezone } from '@/lib/timezone';

import { portionToGrams, scaleNutrients, type Nutrients } from './nutrition';
import { enqueue, flushPending } from './pending';
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
  mode === 'grams' ? 'Enter an amount above 0 and up to 100,000 g.' : 'Enter a number of portions above 0. The total can be up to 100,000 g.';

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

export type LogInput = { food: Food; quantity: Quantity; meal: Meal; consumedAt: Date; clientId: string; isEstimated?: boolean };

// One clientId per screen visit. Saving it again updates the same entry (last write wins), so a retry, or a retry
// with changed values, never makes a second entry. The payload carries the unchanged identity columns, which the
// food_entries trigger accepts because they equal the stored ones; amount, meal, time and nutrients are the edits.
// The entry is saved on this device first (see ./pending), then sent. Resolves to false when the send failed:
// the entry is kept and shows as "Not synced" in the diary until a retry succeeds.
export async function logFood({ food, quantity, meal, consumedAt, clientId, isEstimated = false }: LogInput): Promise<boolean> {
  const r = resolveQuantity(quantity);
  if (!r) throw new Error(amountMessage(quantity.mode));
  return logEntry(clientId, consumedAt, {
    client_id: clientId,
    food_id: food.id,
    meal,
    grams: r.grams,
    portion_label: r.portionLabel,
    portion_count: r.portionCount,
    is_estimated: isEstimated,
    food_name: food.name,
    food_brand: food.brand,
    provider: food.provider,
    provider_id: food.providerId,
    source_data_type: food.sourceDataType,
    source_version: food.sourceVersion,
    ...scaleNutrients(food.per100g, r.grams),
  });
}

// Saves one entry row on this device and sends it (see logFood). Shared by foods and recipes.
export async function logEntry(clientId: string, consumedAt: Date, row: Record<string, unknown>): Promise<boolean> {
  if (!Number.isFinite(consumedAt.getTime())) throw new Error('Choose a valid time.');
  // The stored session, not a network call, so logging works offline.
  const { data: auth } = await supabase.auth.getSession();
  if (!auth.session) throw new Error('Sign in to log food.');
  await enqueue(auth.session.user.id, { kind: 'log', clientId, row: { ...row, consumed_at: consumedAt.toISOString(), timezone: deviceTimezone() } });
  return (await flushPending(auth.session.user.id)) === 0;
}
