// FoodData Central parsing for the food-search edge function (#45). Pure: no Deno or network APIs, so Jest
// tests it with fixture JSON. Field names were checked against the FDC OpenAPI spec and live responses
// (see docs/food/data-source.md). Unknown stays null, never 0.
import { kjToKcal, type NutrientKey, type Nutrients } from './nutrients.ts';

export const FDC_BASE = 'https://api.nal.usda.gov/fdc/v1';
export const DATA_TYPES = ['Foundation', 'SR Legacy', 'Branded'] as const;

// FDC nutrient numbers per column, in precedence order. 957 is Atwater General and 958 Atwater Specific
// energy (kcal); Foundation foods often carry only those. 269.3 is Foundation's total sugars.
type Source = { number: string; unit: 'g' | 'mg' | 'kcal' | 'kj' };
const SOURCES: Record<NutrientKey, Source[]> = {
  energy_kcal: [{ number: '208', unit: 'kcal' }, { number: '958', unit: 'kcal' }, { number: '957', unit: 'kcal' }, { number: '268', unit: 'kj' }],
  protein_g: [{ number: '203', unit: 'g' }],
  carbs_g: [{ number: '205', unit: 'g' }],
  fat_g: [{ number: '204', unit: 'g' }],
  fiber_g: [{ number: '291', unit: 'g' }],
  sugars_g: [{ number: '269', unit: 'g' }, { number: '269.3', unit: 'g' }],
  sat_fat_g: [{ number: '606', unit: 'g' }],
  sodium_mg: [{ number: '307', unit: 'mg' }],
};
export const NUTRIENT_NUMBERS = [...new Set(Object.values(SOURCES).flatMap((s) => s.map((x) => x.number)))];

// Mirrors the per-100 g check constraints on public.foods. A value outside them is bad data, so unknown.
const MAX: Record<NutrientKey, number> = { energy_kcal: 1000, protein_g: 100, carbs_g: 100, fat_g: 100, fiber_g: 100, sugars_g: 100, sat_fat_g: 100, sodium_mg: 100000 };

type RawNutrient = { nutrient?: { number?: string; unitName?: string }; amount?: number };
type RawPortion = { gramWeight?: number; amount?: number; modifier?: string; portionDescription?: string; measureUnit?: { name?: string } };
export type RawFood = {
  fdcId?: number; description?: string; dataType?: string; publicationDate?: string;
  brandName?: string; brandOwner?: string; servingSize?: number; servingSizeUnit?: string; householdServingFullText?: string;
  foodNutrients?: RawNutrient[]; foodPortions?: RawPortion[];
};

export type FoodRow = Nutrients & {
  provider: 'usda_fdc'; provider_id: string; source_data_type: string; source_version: string | null; name: string; brand: string | null;
};
export type PortionRow = { label: string; gram_weight: number };

const round = (n: number) => Math.round(n * 100) / 100;

function nutrientValue(key: NutrientKey, raw: RawNutrient[]): number | null {
  for (const s of SOURCES[key]) {
    const hit = raw.find((n) => n.nutrient?.number === s.number && n.nutrient.unitName?.toLowerCase() === s.unit);
    if (typeof hit?.amount !== 'number' || !Number.isFinite(hit.amount) || hit.amount < 0) continue;
    const v = round(s.unit === 'kj' ? kjToKcal(hit.amount) : hit.amount);
    return v <= MAX[key] ? v : null;
  }
  return null;
}

// FDC detail dates look like "4/27/2023" and search dates are ISO. The ISO date is what we store as source_version.
function isoDate(d: string | undefined): string | null {
  const iso = /^(\d{4}-\d{2}-\d{2})(?:$|T)/.exec(d ?? '');
  if (iso) return iso[1];
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(d ?? '');
  return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null;
}

const MASS_UNITS = new Set(['g', 'grm', 'gm']);
const isMassUnit = (u: string | undefined) => MASS_UNITS.has((u ?? '').toLowerCase());
const clip = (s: string, n: number) => s.trim().slice(0, n);

// A portion only counts with a positive gram weight. The label keeps the count (e.g. "2 tbsp") so its weight is for the whole label.
export function normalizePortions(raw: RawFood): PortionRow[] {
  const out = new Map<string, PortionRow>();
  for (const p of raw.foodPortions ?? []) {
    const unit = p.measureUnit?.name && p.measureUnit.name !== 'undetermined' ? (p.measureUnit.name === 'RACC' ? 'serving' : p.measureUnit.name) : '';
    const text = (p.portionDescription || p.modifier || unit).trim();
    if (!text || typeof p.gramWeight !== 'number' || !(p.gramWeight > 0) || p.gramWeight > 100000) continue;
    const label = clip(p.amount && p.amount !== 1 && !p.portionDescription ? `${p.amount} ${text}` : text, 100);
    if (label && !out.has(label)) out.set(label, { label, gram_weight: round(p.gramWeight) });
  }
  // Branded foods have one label serving, usable only when it is given in grams.
  const size = raw.servingSize;
  if (raw.dataType === 'Branded' && typeof size === 'number' && size > 0 && size <= 100000 && isMassUnit(raw.servingSizeUnit)) {
    const label = clip(raw.householdServingFullText || 'Serving', 100);
    if (!out.has(label)) out.set(label, { label, gram_weight: round(size) });
  }
  return [...out.values()];
}

// One FDC detail record (format=full) to our food row and portions. Null when it has no usable id or name.
export function normalizeFood(raw: RawFood): { food: FoodRow; portions: PortionRow[] } | null {
  const name = raw.description?.trim();
  if (!raw.fdcId || !Number.isInteger(raw.fdcId) || !name) return null;
  // Branded nutrients are per 100 of the serving unit, so a food measured in ml (or with no unit) is per 100 ml,
  // not per 100 g. Known gap: those foods are skipped until we have a density.
  if (raw.dataType === 'Branded' && !isMassUnit(raw.servingSizeUnit)) return null;
  const nutrients = raw.foodNutrients ?? [];
  const values = {} as Nutrients;
  for (const k of Object.keys(SOURCES) as NutrientKey[]) values[k] = nutrientValue(k, nutrients);
  return {
    food: {
      ...values,
      provider: 'usda_fdc',
      provider_id: String(raw.fdcId),
      source_data_type: clip(raw.dataType || 'FDC', 60),
      source_version: isoDate(raw.publicationDate),
      name: clip(name, 200),
      brand: clip(raw.brandName || raw.brandOwner || '', 200) || null,
    },
    portions: normalizePortions(raw),
  };
}

export type SearchParams = { query: string; page: number; pageSize: number };
export type ParamResult = { ok: true; params: SearchParams } | { ok: false; message: string };

export function parseSearchParams(body: unknown): ParamResult {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const query = typeof b.query === 'string' ? b.query.trim().replace(/\s+/g, ' ') : '';
  if (query.length < 3 || query.length > 100) return { ok: false, message: 'Search needs 3 to 100 characters.' };
  const page = b.page === undefined ? 1 : b.page;
  const pageSize = b.pageSize === undefined ? 20 : b.pageSize;
  if (typeof page !== 'number' || !Number.isInteger(page) || page < 1 || page > 50) return { ok: false, message: 'Page must be a whole number from 1 to 50.' };
  if (typeof pageSize !== 'number' || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 20) return { ok: false, message: 'Page size must be a whole number from 1 to 20.' };
  return { ok: true, params: { query, page, pageSize } };
}

// The API key goes in the query string because FDC reads it there. These URLs are never logged or returned.
export function searchUrl({ query, page, pageSize }: SearchParams, apiKey: string): string {
  const q = new URLSearchParams({ api_key: apiKey, query, dataType: DATA_TYPES.join(','), pageNumber: String(page), pageSize: String(pageSize) });
  return `${FDC_BASE}/foods/search?${q}`;
}

export function detailUrl(ids: readonly number[], apiKey: string): string {
  const q = new URLSearchParams({ api_key: apiKey, format: 'full', nutrients: NUTRIENT_NUMBERS.join(','), fdcIds: ids.join(',') });
  return `${FDC_BASE}/foods?${q}`;
}

export function searchResult(json: unknown): { ids: number[]; totalHits: number } {
  const j = (json ?? {}) as { foods?: { fdcId?: unknown }[]; totalHits?: unknown };
  const ids = (Array.isArray(j.foods) ? j.foods : []).map((f) => f?.fdcId).filter((i): i is number => Number.isInteger(i));
  return { ids, totalHits: typeof j.totalHits === 'number' ? j.totalHits : ids.length };
}

export type FailureCode = 'not_configured' | 'rate_limited' | 'provider_timeout' | 'provider_error';
// FDC answers 429 over the hourly limit, and 403 (API_KEY_INVALID or missing) for a bad key.
export function failureFor(status: number | 'timeout'): { code: FailureCode; httpStatus: number; message: string } {
  if (status === 'timeout') return { code: 'provider_timeout', httpStatus: 504, message: 'The food database took too long to answer.' };
  if (status === 429) return { code: 'rate_limited', httpStatus: 429, message: 'The food database is busy. Try again in a few minutes.' };
  if (status === 401 || status === 403) return { code: 'not_configured', httpStatus: 503, message: 'Food search is not set up on the server.' };
  return { code: 'provider_error', httpStatus: 502, message: 'The food database could not be reached.' };
}

export type CacheItem = { food: FoodRow; portions: PortionRow[] };

// Normalize, drop duplicate ids, and sort by provider_id. A fixed order for the upserts avoids deadlocks between
// concurrent searches, and a repeated id in one upsert would fail with "cannot affect row a second time".
export function cacheItems(raw: readonly RawFood[]): CacheItem[] {
  const byId = new Map<string, CacheItem>();
  for (const r of raw) {
    const item = normalizeFood(r);
    if (item && !byId.has(item.food.provider_id)) byId.set(item.food.provider_id, item);
  }
  return [...byId.values()].sort((a, b) => Number(a.food.provider_id) - Number(b.food.provider_id));
}

export type StoredFood = { id: string; provider_id: string | null; source_data_type: string | null };
export type StoredPortion = { food_id: string; label: string; gram_weight: number };

// Portion rows for the upsert (food ids filled in from the stored foods), sorted by food id and label.
export function portionRows(items: readonly CacheItem[], stored: readonly StoredFood[]): (PortionRow & { food_id: string })[] {
  const idByProvider = new Map(stored.map((f) => [f.provider_id, f.id]));
  return items
    .flatMap((i) => i.portions.map((p) => ({ ...p, food_id: idByProvider.get(i.food.provider_id) })))
    .filter((p): p is PortionRow & { food_id: string } => !!p.food_id)
    .sort((a, b) => a.food_id.localeCompare(b.food_id) || a.label.localeCompare(b.label));
}

// Whole foods (Foundation, SR Legacy) rank before Branded; within a group FDC's relevance order is kept.
const rank = (t: string | null) => (t === 'Foundation' ? 0 : t === 'SR Legacy' ? 1 : 2);
export function orderedResponse<F extends StoredFood>(stored: readonly F[], portions: readonly StoredPortion[], searchOrder: readonly string[]) {
  const pos = new Map(searchOrder.map((id, i) => [id, i]));
  const at = (f: F) => pos.get(f.provider_id ?? '') ?? searchOrder.length;
  return [...stored]
    .sort((a, b) => rank(a.source_data_type) - rank(b.source_data_type) || at(a) - at(b))
    .map((f) => ({ ...f, food_portions: portions.filter((p) => p.food_id === f.id) }));
}
