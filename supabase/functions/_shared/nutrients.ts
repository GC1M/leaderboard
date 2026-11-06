// Nutrient keys and the kJ to kcal conversion, defined once. The edge function imports this file and
// src/lib/food/nutrition.ts re-exports it. Pure, no imports.
export const NUTRIENT_KEYS = ['energy_kcal', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'sugars_g', 'sat_fat_g', 'sodium_mg'] as const;
export type NutrientKey = (typeof NUTRIENT_KEYS)[number];
export type Nutrients = Record<NutrientKey, number | null>;

export const KJ_PER_KCAL = 4.184;
export const kjToKcal = (kj: number) => kj / KJ_PER_KCAL;
