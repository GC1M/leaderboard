import { type NutrientKey, roundNutrient } from './nutrition';

const UNITS: Record<NutrientKey, string> = { energy_kcal: 'kcal', protein_g: 'g', carbs_g: 'g', fat_g: 'g', fiber_g: 'g', sugars_g: 'g', sat_fat_g: 'g', sodium_mg: 'mg' };

// Display text for one nutrient. Unknown is never shown as 0.
export function formatNutrient(key: NutrientKey, value: number | null): string {
  const r = roundNutrient(key, value);
  return r == null ? 'Unknown' : `${r} ${UNITS[key]}`;
}
