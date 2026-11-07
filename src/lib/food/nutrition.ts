// Nutrition math for food logging (#44). Pure functions, no I/O. Stored units: grams, kcal, mg.
// A null nutrient is unknown, never zero: scaling keeps it null and sums flag it as incomplete.

// Keys, types and the kJ to kcal conversion are defined in the edge function's shared folder (it cannot
// import from src/) and re-exported here. Only kcal is ever stored.
import { KJ_PER_KCAL, NUTRIENT_KEYS, type NutrientKey, type Nutrients } from '../../../supabase/functions/_shared/nutrients';

export { KJ_PER_KCAL, kjToKcal, NUTRIENT_KEYS, type NutrientKey, type Nutrients } from '../../../supabase/functions/_shared/nutrients';
export const kcalToKj = (kcal: number) => kcal * KJ_PER_KCAL;

export type MassUnit = 'g' | 'oz' | 'lb';
const GRAMS_PER_UNIT: Record<MassUnit, number> = { g: 1, oz: 28.349523125, lb: 453.59237 };
function gramsPer(amount: number, unit: MassUnit): number {
  const f = GRAMS_PER_UNIT[unit];
  if (f === undefined || !Number.isFinite(amount) || amount < 0) throw new Error('Invalid mass.');
  return f;
}
export const massToGrams = (amount: number, unit: MassUnit) => amount * gramsPer(amount, unit);
export const gramsToMass = (grams: number, unit: MassUnit) => grams / gramsPer(grams, unit);

// A portion is only usable with a positive, finite gram weight and a positive count. Otherwise null.
export function portionToGrams(count: number, gramWeight: number | null | undefined): number | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  if (gramWeight == null || !Number.isFinite(gramWeight) || gramWeight <= 0) return null;
  return count * gramWeight;
}

export const emptyNutrients = (): Nutrients => ({
  energy_kcal: null, protein_g: null, carbs_g: null, fat_g: null, fiber_g: null, sugars_g: null, sat_fat_g: null, sodium_mg: null,
});

// A per-100 g value that is missing, negative or not finite is treated as unknown, never as a number.
const known = (v: number | null | undefined): number | null => (v == null || !Number.isFinite(v) || v < 0 ? null : v);

// Per-100 g values to the amount eaten. Unknown stays unknown.
export function scaleNutrients(per100g: Nutrients, grams: number): Nutrients {
  if (!Number.isFinite(grams) || grams <= 0) throw new Error('Grams must be more than 0.');
  const out = emptyNutrients();
  for (const k of NUTRIENT_KEYS) {
    const v = known(per100g[k]);
    out[k] = v == null ? null : (v * grams) / 100;
  }
  return out;
}

// Nutrients of an amount `from`, scaled to amount `to` (any shared unit). Unknown stays unknown.
export function scaleSnapshot(n: Nutrients, from: number, to: number): Nutrients {
  const out = emptyNutrients();
  for (const k of NUTRIENT_KEYS) out[k] = n[k] == null ? null : (n[k] * to) / from;
  return out;
}

export type NutrientTotals = {
  totals: Nutrients;
  // Nutrients where at least one input was unknown, so the total is a lower bound. A total that is
  // null had no known input at all (no data, not zero).
  incomplete: NutrientKey[];
};

export function sumNutrients(items: readonly Nutrients[]): NutrientTotals {
  const totals = emptyNutrients();
  const incomplete: NutrientKey[] = [];
  for (const k of NUTRIENT_KEYS) {
    let unknown = false;
    for (const item of items) {
      const v = known(item[k]);
      if (v == null) unknown = true;
      else totals[k] = (totals[k] ?? 0) + v;
    }
    if (unknown && items.length > 0) incomplete.push(k);
  }
  return { totals, incomplete };
}

// Display rounding: whole kcal and mg, one decimal for grams. Never used before summing.
export function roundNutrient(key: NutrientKey, value: number | null): number | null {
  if (value == null) return null;
  const places = key === 'energy_kcal' || key === 'sodium_mg' ? 0 : 1;
  const f = 10 ** places;
  return Math.round(value * f) / f;
}
