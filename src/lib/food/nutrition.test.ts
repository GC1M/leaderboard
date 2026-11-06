import { emptyNutrients, gramsToMass, kcalToKj, kjToKcal, massToGrams, portionToGrams, roundNutrient, scaleNutrients, sumNutrients, type Nutrients } from './nutrition';

const food = (o: Partial<Nutrients>): Nutrients => ({ ...emptyNutrients(), ...o });

test('kcal and kJ convert both ways with 4.184', () => {
  expect(kcalToKj(100)).toBeCloseTo(418.4);
  expect(kjToKcal(418.4)).toBeCloseTo(100);
});

test('mass units convert to grams and back', () => {
  expect(massToGrams(1, 'oz')).toBeCloseTo(28.3495, 4);
  expect(massToGrams(1, 'lb')).toBeCloseTo(453.5924, 4);
  expect(massToGrams(5, 'g')).toBe(5);
  expect(gramsToMass(453.59237, 'lb')).toBeCloseTo(1);
  expect(gramsToMass(massToGrams(3, 'oz'), 'oz')).toBeCloseTo(3);
});

test('a portion needs a valid gram weight and count', () => {
  expect(portionToGrams(2, 182)).toBe(364);
  expect(portionToGrams(0.5, 240)).toBe(120);
  expect(portionToGrams(1, null)).toBeNull();
  expect(portionToGrams(1, 0)).toBeNull();
  expect(portionToGrams(1, NaN)).toBeNull();
  expect(portionToGrams(0, 100)).toBeNull();
  expect(portionToGrams(Infinity, 100)).toBeNull();
});

test('scaling per-100g values keeps unknown as null and zero as zero', () => {
  const out = scaleNutrients(food({ energy_kcal: 52, protein_g: 0.26, sodium_mg: 0 }), 182);
  expect(out.energy_kcal).toBeCloseTo(94.64);
  expect(out.protein_g).toBeCloseTo(0.4732);
  expect(out.sodium_mg).toBe(0);
  expect(out.carbs_g).toBeNull();
});

test('scaling rejects a non-positive or non-finite amount', () => {
  expect(() => scaleNutrients(food({}), 0)).toThrow('Grams');
  expect(() => scaleNutrients(food({}), NaN)).toThrow('Grams');
});

test('sums add known values and flag nutrients with an unknown input', () => {
  const { totals, incomplete } = sumNutrients([
    food({ energy_kcal: 100, protein_g: 5, fat_g: 0 }),
    food({ energy_kcal: 50, protein_g: null, fat_g: 0 }),
  ]);
  expect(totals.energy_kcal).toBe(150);
  expect(totals.protein_g).toBe(5);
  expect(totals.fat_g).toBe(0);
  expect(incomplete).toContain('protein_g');
  expect(incomplete).not.toContain('energy_kcal');
  expect(incomplete).not.toContain('fat_g');
});

test('a nutrient no input knows stays null, and no entries is not a zero total', () => {
  expect(sumNutrients([food({ energy_kcal: 10 })]).totals.carbs_g).toBeNull();
  const none = sumNutrients([]);
  expect(none.totals.energy_kcal).toBeNull();
  expect(none.incomplete).toEqual([]);
});

test('display rounding', () => {
  expect(roundNutrient('energy_kcal', 94.64)).toBe(95);
  expect(roundNutrient('sodium_mg', 1.5)).toBe(2);
  expect(roundNutrient('protein_g', 0.4732)).toBe(0.5);
  expect(roundNutrient('fat_g', 1.005)).toBe(1);
  expect(roundNutrient('fat_g', 0)).toBe(0);
  expect(roundNutrient('fat_g', null)).toBeNull();
});
