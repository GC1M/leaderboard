import { type NutrientKey, roundNutrient } from './nutrition';

const UNITS: Record<NutrientKey, string> = { energy_kcal: 'kcal', protein_g: 'g', carbs_g: 'g', fat_g: 'g', fiber_g: 'g', sugars_g: 'g', sat_fat_g: 'g', sodium_mg: 'mg' };

export const NUTRIENT_NAMES: Record<NutrientKey, string> = { energy_kcal: 'Calories', protein_g: 'Protein', carbs_g: 'Carbs', fat_g: 'Fat', fiber_g: 'Fiber', sugars_g: 'Sugars', sat_fat_g: 'Saturated fat', sodium_mg: 'Sodium' };

// Display text for one nutrient. Unknown is never shown as 0.
export function formatNutrient(key: NutrientKey, value: number | null): string {
  const r = roundNutrient(key, value);
  return r == null ? 'Unknown' : `${r} ${UNITS[key]}`;
}

type Amount = { grams: number; portionLabel: string | null; portionCount: number | null };
const g1 = (n: number) => Math.round(n * 10) / 10;

// "2 x medium (236 g)" or "150 g".
export const formatAmount = (e: Amount) => (e.portionLabel && e.portionCount ? `${g1(e.portionCount)} x ${e.portionLabel} (${g1(e.grams)} g)` : `${g1(e.grams)} g`);

// Labels beside an entry: "Custom" for your own food, "Recipe" for a recipe or meal, "Estimate" when the amount is a guess, "Not synced" until the server has it.
export const entryTags = (e: { provider: string; isEstimated: boolean; pending: string | null }) =>
  [e.provider === 'custom' && 'Custom', e.provider === 'recipe' && 'Recipe', e.isEstimated && 'Estimate', e.pending && 'Not synced'].filter((t): t is string => !!t);
