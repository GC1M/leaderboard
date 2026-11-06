import {
  detailUrl,
  failureFor,
  normalizeFood,
  normalizePortions,
  parseSearchParams,
  searchResult,
  searchUrl,
  type RawFood,
} from '../../../supabase/functions/_shared/fdc';

// Trimmed from real FDC responses (GET /foods?format=full&nutrients=...), 2026-11.
const n = (number: string, unitName: string, amount?: number) => ({ nutrient: { number, unitName }, ...(amount === undefined ? {} : { amount }) });

const foundation: RawFood = {
  fdcId: 2346393, description: 'Nuts, almonds, whole, raw', dataType: 'Foundation', publicationDate: '10/28/2022',
  foodNutrients: [n('957', 'kcal', 625.75), n('958', 'kcal', 583.597022), n('203', 'g', 21.45038), n('204', 'g', 51.09), n('205', 'g', 20.03462), n('291', 'g', 10.78), n('307', 'mg', 0), n('606', 'g', 3.785)],
  foodPortions: [{ gramWeight: 30, amount: 1, measureUnit: { name: 'RACC' } }],
};
const sr: RawFood = {
  fdcId: 169901, description: 'Cheese, american cheddar, imitation', dataType: 'SR Legacy', publicationDate: '4/1/2019',
  foodNutrients: [n('208', 'kcal', 239), n('268', 'kJ', 1000), n('203', 'g', 16.7), n('204', 'g', 14), n('205', 'g', 11.6), n('291', 'g', 0), n('269', 'g', 7.74), n('307', 'mg', 1345), n('606', 'g', 8.79)],
  foodPortions: [
    { gramWeight: 21, amount: 1, modifier: 'slice', measureUnit: { name: 'undetermined' } },
    { gramWeight: 224, amount: 1, modifier: 'cup', measureUnit: { name: 'undetermined' } },
    { gramWeight: 28.35, amount: 1.5, modifier: 'oz', measureUnit: { name: 'undetermined' } },
  ],
};
const branded: RawFood = {
  fdcId: 2517161, description: 'Cheerios Cereal', dataType: 'Branded', publicationDate: '4/27/2023', brandName: 'Cheerios', brandOwner: 'General Mills',
  servingSize: 20, servingSizeUnit: 'GRM', householdServingFullText: '3/4 cup (20g)',
  foodNutrients: [n('208', 'kcal', 359), n('203', 'g', 12.82), n('204', 'g', 6.41), n('205', 'g', 74.36), n('269', 'g', 5.13), n('291', 'g', 10.3), n('307', 'mg', 487), n('606', 'g', 1.28)],
  foodPortions: [],
};

describe('normalizeFood', () => {
  test('Foundation: energy comes from Atwater specific, then general; a missing sugar stays null; 0 stays 0', () => {
    const { food, portions } = normalizeFood(foundation)!;
    expect(food).toMatchObject({
      provider: 'usda_fdc', provider_id: '2346393', source_data_type: 'Foundation', source_version: '2022-10-28', name: 'Nuts, almonds, whole, raw', brand: null,
      energy_kcal: 583.6, protein_g: 21.45, carbs_g: 20.03, fat_g: 51.09, fiber_g: 10.78, sat_fat_g: 3.79, sodium_mg: 0, sugars_g: null,
    });
    expect(portions).toEqual([{ label: 'serving', gram_weight: 30 }]);
  });

  test('Atwater general is used when it is the only kcal value', () => {
    const only957 = { ...foundation, foodNutrients: [n('957', 'kcal', 600)] };
    expect(normalizeFood(only957)!.food.energy_kcal).toBe(600);
  });

  test('SR Legacy: kcal wins over kJ, and portions keep counts like 1.5 oz', () => {
    const { food, portions } = normalizeFood(sr)!;
    expect(food).toMatchObject({ energy_kcal: 239, sugars_g: 7.74, source_data_type: 'SR Legacy', source_version: '2019-04-01' });
    expect(portions).toEqual([
      { label: 'slice', gram_weight: 21 },
      { label: 'cup', gram_weight: 224 },
      { label: '1.5 oz', gram_weight: 28.35 },
    ]);
  });

  test('kJ-only energy converts with 4.184 and never invents a value from macros', () => {
    const kj = normalizeFood({ ...sr, foodNutrients: [n('268', 'kJ', 1000), n('203', 'g', 16.7)] })!.food;
    expect(kj.energy_kcal).toBe(239.01);
    const none = normalizeFood({ ...sr, foodNutrients: [n('203', 'g', 16.7), n('204', 'g', 14)] })!.food;
    expect(none.energy_kcal).toBeNull();
    expect(none.protein_g).toBe(16.7);
  });

  test('Branded: brand, label serving in grams as a portion', () => {
    const { food, portions } = normalizeFood(branded)!;
    expect(food).toMatchObject({ brand: 'Cheerios', energy_kcal: 359, carbs_g: 74.36, source_data_type: 'Branded', source_version: '2023-04-27' });
    expect(portions).toEqual([{ label: '3/4 cup (20g)', gram_weight: 20 }]);
  });

  test('brand falls back to the brand owner', () => {
    expect(normalizeFood({ ...branded, brandName: undefined })!.food.brand).toBe('General Mills');
  });

  test('a nutrient with no amount, the wrong unit, a negative or an impossible value is unknown, never 0', () => {
    const food = normalizeFood({
      ...sr,
      foodNutrients: [n('203', 'g'), n('204', 'mg', 14), n('205', 'g', -1), n('208', 'kcal', 5000), n('291', 'g', Number.NaN), n('307', 'g', 5)],
    })!.food;
    expect(food).toMatchObject({ protein_g: null, fat_g: null, carbs_g: null, energy_kcal: null, fiber_g: null, sodium_mg: null });
  });

  test('a record without an id or name is skipped', () => {
    expect(normalizeFood({ ...sr, fdcId: undefined })).toBeNull();
    expect(normalizeFood({ ...sr, description: '  ' })).toBeNull();
  });
});

describe('normalizePortions', () => {
  test('portions without a usable gram weight are dropped', () => {
    const raw: RawFood = {
      foodPortions: [
        { amount: 1, modifier: 'slice' },
        { gramWeight: 0, amount: 1, modifier: 'pinch' },
        { gramWeight: -4, amount: 1, modifier: 'dash' },
        { gramWeight: 1e9, amount: 1, modifier: 'truckload' },
        { gramWeight: 30, amount: 1 },
        { gramWeight: 50, amount: 1, modifier: 'bowl' },
        { gramWeight: 51, amount: 1, modifier: 'bowl' },
      ],
    };
    expect(normalizePortions(raw)).toEqual([{ label: 'bowl', gram_weight: 50 }]);
  });

  test('portionDescription wins and a measure unit name is the last fallback', () => {
    expect(normalizePortions({ foodPortions: [{ gramWeight: 9, amount: 1, portionDescription: '1 tbsp', modifier: 'x' }, { gramWeight: 5, amount: 2, measureUnit: { name: 'tsp' } }] })).toEqual([
      { label: '1 tbsp', gram_weight: 9 },
      { label: '2 tsp', gram_weight: 5 },
    ]);
  });

  test('a Branded serving only counts when it is in grams', () => {
    expect(normalizePortions({ ...branded, servingSizeUnit: 'MLT' })).toEqual([]);
    expect(normalizePortions({ ...branded, servingSizeUnit: 'g', servingSize: 0 })).toEqual([]);
    expect(normalizePortions({ ...branded, householdServingFullText: undefined })).toEqual([{ label: 'Serving', gram_weight: 20 }]);
  });
});

describe('request building and failures', () => {
  test('parseSearchParams bounds the query, page and page size', () => {
    expect(parseSearchParams({ query: '  cheddar   cheese ' })).toEqual({ ok: true, params: { query: 'cheddar cheese', page: 1, pageSize: 20 } });
    expect(parseSearchParams({ query: 'rice', page: 3, pageSize: 5 })).toEqual({ ok: true, params: { query: 'rice', page: 3, pageSize: 5 } });
    for (const bad of [null, 'x', {}, { query: 'a' }, { query: 'x'.repeat(101) }, { query: 5 }, { query: 'rice', page: 0 }, { query: 'rice', page: 51 }, { query: 'rice', page: 1.5 }, { query: 'rice', pageSize: 21 }, { query: 'rice', pageSize: '5' }]) {
      expect(parseSearchParams(bad).ok).toBe(false);
    }
  });

  test('URLs carry the key, the data types and encoded input', () => {
    const s = new URL(searchUrl({ query: 'a&b=c', page: 2, pageSize: 7 }, 'KEY'));
    expect(s.pathname).toBe('/fdc/v1/foods/search');
    expect(s.searchParams.get('query')).toBe('a&b=c');
    expect(s.searchParams.get('dataType')).toBe('Foundation,SR Legacy,Branded');
    expect([s.searchParams.get('api_key'), s.searchParams.get('pageNumber'), s.searchParams.get('pageSize')]).toEqual(['KEY', '2', '7']);
    const d = new URL(detailUrl([1, 2], 'KEY'));
    expect(d.searchParams.get('fdcIds')).toBe('1,2');
    expect(d.searchParams.get('format')).toBe('full');
    expect(d.searchParams.get('nutrients')).toContain('958');
  });

  test('searchResult reads ids and totals defensively', () => {
    expect(searchResult({ totalHits: 9, foods: [{ fdcId: 1 }, { fdcId: 'x' }, null, {}] })).toEqual({ ids: [1], totalHits: 9 });
    expect(searchResult(null)).toEqual({ ids: [], totalHits: 0 });
  });

  test('failureFor maps provider failures to clear codes', () => {
    expect(failureFor(429)).toMatchObject({ code: 'rate_limited', httpStatus: 429 });
    expect(failureFor('timeout')).toMatchObject({ code: 'provider_timeout', httpStatus: 504 });
    expect(failureFor(403)).toMatchObject({ code: 'not_configured', httpStatus: 503 });
    expect(failureFor(500)).toMatchObject({ code: 'provider_error', httpStatus: 502 });
    expect(failureFor(0)).toMatchObject({ code: 'provider_error' });
  });
});
