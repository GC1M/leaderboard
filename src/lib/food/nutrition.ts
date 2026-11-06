// Nutrition math for food logging (#44). Pure functions, no I/O. Stored units: grams, kcal, mg.
// A null nutrient is unknown, never zero: scaling keeps it null and sums flag it as incomplete.

export const NUTRIENT_KEYS = ['energy_kcal', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'sugars_g', 'sat_fat_g', 'sodium_mg'] as const;
export type NutrientKey = (typeof NUTRIENT_KEYS)[number];
export type Nutrients = Record<NutrientKey, number | null>;

// The one place the energy conversion is defined. Only kcal is ever stored.
export const KJ_PER_KCAL = 4.184;
export const kcalToKj = (kcal: number) => kcal * KJ_PER_KCAL;
export const kjToKcal = (kj: number) => kj / KJ_PER_KCAL;

export type MassUnit = 'g' | 'oz' | 'lb';
const GRAMS_PER_UNIT: Record<MassUnit, number> = { g: 1, oz: 28.349523125, lb: 453.59237 };
export const massToGrams = (amount: number, unit: MassUnit) => amount * GRAMS_PER_UNIT[unit];
export const gramsToMass = (grams: number, unit: MassUnit) => grams / GRAMS_PER_UNIT[unit];

// A portion is only usable with a positive, finite gram weight and a positive count. Otherwise null.
export function portionToGrams(count: number, gramWeight: number | null | undefined): number | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  if (gramWeight == null || !Number.isFinite(gramWeight) || gramWeight <= 0) return null;
  return count * gramWeight;
}

export const emptyNutrients = (): Nutrients => ({
  energy_kcal: null, protein_g: null, carbs_g: null, fat_g: null, fiber_g: null, sugars_g: null, sat_fat_g: null, sodium_mg: null,
});

// Per-100 g values to the amount eaten. Unknown stays unknown.
export function scaleNutrients(per100g: Nutrients, grams: number): Nutrients {
  if (!Number.isFinite(grams) || grams <= 0) throw new Error('Grams must be more than 0.');
  const out = emptyNutrients();
  for (const k of NUTRIENT_KEYS) {
    const v = per100g[k];
    out[k] = v == null ? null : (v * grams) / 100;
  }
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
      const v = item[k];
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
  return Math.round((value + Number.EPSILON) * f) / f;
}
