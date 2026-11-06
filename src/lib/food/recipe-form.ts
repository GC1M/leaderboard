// The recipe editor's form state (#46): conversion to and from a Recipe, and whether it differs from what was loaded.
import { decimalValue } from '@/lib/numeric-input';

import type { Ingredient, Recipe } from './recipe';

// amount is the grams text being edited; note is read-only context such as "2 x medium" for an ingredient added by portion.
export type Line = Ingredient & { amount: string; note?: string };
export type Form = { name: string; notes: string; servings: string; yieldG: string; lines: Line[] };

export const blankForm: Form = { name: '', notes: '', servings: '1', yieldG: '', lines: [] };

export const toForm = (r: Recipe, copy: boolean): Form => ({
  name: copy ? `${r.name.slice(0, 195)} copy` : r.name,
  notes: r.notes ?? '',
  servings: String(r.servings),
  yieldG: r.yieldG == null ? '' : String(r.yieldG),
  lines: r.ingredients.map((i) => ({ ...i, amount: String(i.grams) })),
});

// An amount that is not a number becomes NaN, which validateRecipe rejects.
export function toRecipe(f: Form): Recipe {
  return {
    id: null,
    name: f.name,
    notes: f.notes,
    servings: decimalValue(f.servings) ?? Number.NaN,
    yieldG: f.yieldG.trim() ? (decimalValue(f.yieldG) ?? Number.NaN) : null,
    ingredients: f.lines.map((l) => ({ foodId: l.foodId, name: l.name, grams: decimalValue(l.amount) ?? Number.NaN, per100g: l.per100g })),
  };
}

// True when the user changed something. Only what is saved counts (a note is display only).
const key = (f: Form) => JSON.stringify([f.name, f.notes, f.servings, f.yieldG, f.lines.map((l) => [l.foodId, l.name, l.amount])]);
export const formChanged = (a: Form, b: Form) => key(a) !== key(b);
