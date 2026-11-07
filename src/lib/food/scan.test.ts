import { emptyNutrients, type NutrientKey } from './nutrition';
import { labelToPer100g, linesFromText, parseLabel, parseMenu, toLines, type LabelScan, type ScanLine } from './scan';

const lines = (...text: string[]): ScanLine[] => text.map((t) => ({ text: t, confidence: 0.95 }));
const values = (scan: LabelScan) => Object.fromEntries(Object.entries(scan.fields).map(([k, f]) => [k, f.value]));

// Photo-assistance test set (#54): text as Apple Vision returns it from real label and menu layouts. Each case
// lists every value a careful reader takes from the label; anything not listed must come back unknown.
const LABELS: { name: string; text: ScanLine[]; basis: 'serving' | '100g'; servingGrams: number | null; expect: Partial<Record<NutrientKey, number>>; check?: NutrientKey[] }[] = [
  {
    name: 'US Nutrition Facts with % Daily Value',
    text: lines('Nutrition Facts', '8 servings per container', 'Serving size 2/3 cup (55g)', 'Amount per serving', 'Calories 230', '% Daily Value*', 'Total Fat 8g 10%', 'Saturated Fat 1g 5%', 'Trans Fat 0g', 'Cholesterol 0mg 0%', 'Sodium 160mg 7%', 'Total Carbohydrate 37g 13%', 'Dietary Fiber 4g 14%', 'Total Sugars 12g', 'Includes 10g Added Sugars 20%', 'Protein 3g', 'Vitamin D 2mcg 10%', '*The % Daily Value tells you how much a nutrient in a serving of food contributes to a daily diet. 2,000 calories a day is used for general nutrition advice.'),
    basis: 'serving',
    servingGrams: 55,
    expect: { energy_kcal: 230, fat_g: 8, sat_fat_g: 1, sodium_mg: 160, carbs_g: 37, fiber_g: 4, sugars_g: 12, protein_g: 3 },
  },
  {
    name: 'EU two columns, per 100 g first, salt instead of sodium',
    text: lines('Nutrition', 'Typical values Per 100g Per 30g serving', 'Energy 1569kJ 471kJ', '373kcal 112kcal', 'Fat 4.2g 1.3g', 'of which saturates 0.8g 0.2g', 'Carbohydrate 68g 20g', 'of which sugars 1.1g 0.3g', 'Fibre 9.0g 2.7g', 'Protein 12g 3.6g', 'Salt 0.02g 0.01g'),
    basis: '100g',
    servingGrams: 30,
    expect: { energy_kcal: 373, fat_g: 4.2, sat_fat_g: 0.8, carbs_g: 68, sugars_g: 1.1, fiber_g: 9, protein_g: 12, sodium_mg: 8 },
  },
  {
    name: 'Serving column before the 100 g column',
    text: lines('Per bar (40 g) Per 100 g', 'Energy 180 kcal 450 kcal', 'Fat 8 g 20 g', 'Protein 4 g 10 g'),
    basis: '100g',
    servingGrams: 40,
    expect: { energy_kcal: 450, fat_g: 20, protein_g: 10 },
  },
  {
    name: 'Decimal commas and kJ only',
    text: lines('Nährwerte pro 100 g', 'Energy 1046 kJ', 'Fat 3,5 g', 'Carbohydrate 45,2 g', 'Protein 8,1 g'),
    basis: '100g',
    servingGrams: null,
    expect: { energy_kcal: 250, fat_g: 3.5, carbs_g: 45.2, protein_g: 8.1 },
  },
  {
    name: 'Noisy OCR: O for 0, unreadable line, less-than value, thousands-looking grams',
    text: [
      ...lines('Serving size 1 cup (240g)', 'Calories 1OO', 'Total Fat <1g'),
      { text: 'Sodium 45Omg', confidence: 0.3 },
      ...lines('Total Carbohydrate 1,250g', 'Protein 2g'),
    ],
    basis: 'serving',
    servingGrams: 240,
    expect: { protein_g: 2 },
    check: ['energy_kcal', 'fat_g', 'sodium_mg', 'carbs_g'],
  },
];

describe('parseLabel test set', () => {
  it.each(LABELS)('$name', ({ text, basis, servingGrams, expect: want, check = [] }) => {
    const scan = parseLabel(text);
    expect(scan.basis).toBe(basis);
    expect(scan.servingGrams).toBe(servingGrams);
    const read = values(scan);
    for (const k of Object.keys(read) as NutrientKey[]) {
      if (k in want) {
        expect([k, read[k]]).toEqual([k, want[k]]);
        expect(scan.fields[k].status).toBe('read');
      } else {
        // Never a fabricated number: anything not on the label, or not readable, is blank.
        expect([k, read[k]]).toEqual([k, null]);
        expect(scan.fields[k].status).toBe(check.includes(k) ? 'check' : 'missing');
      }
    }
  });

  it('reads every expected value across the set, and flags rather than guesses the rest', () => {
    let expected = 0;
    let correct = 0;
    for (const c of LABELS) {
      const read = values(parseLabel(c.text));
      for (const [k, v] of Object.entries(c.expect)) {
        expected += 1;
        if (read[k] === v) correct += 1;
      }
    }
    expect(correct / expected).toBe(1);
  });
});

describe('parseLabel checks', () => {
  it('converts kJ and notes it', () => {
    const f = parseLabel(lines('Energy 836 kJ')).fields.energy_kcal;
    expect(f).toEqual({ value: 200, status: 'read', note: 'Converted from 836 kJ.' });
  });

  it('flags a value too high for the serving and a part larger than its total', () => {
    const scan = parseLabel(lines('Serving size 20g', 'Calories 80', 'Total Fat 3g', 'Saturated Fat 5g', 'Total Carbohydrate 30g'));
    expect(scan.fields.carbs_g.status).toBe('check');
    expect(scan.fields.sat_fat_g.status).toBe('check');
    expect(scan.fields.fat_g.value).toBe(3);
  });

  it('warns when calories do not match the macros', () => {
    const scan = parseLabel(lines('Calories 500', 'Total Fat 1g', 'Total Carbohydrate 10g', 'Protein 5g'));
    expect(scan.warnings.join(' ')).toMatch(/don't match/);
  });

  it('asks for grams when the serving is in ml, and warns about per 100 ml', () => {
    expect(parseLabel(lines('Serving size 250 ml', 'Calories 110')).warnings[0]).toMatch(/ml/);
    expect(parseLabel(lines('Per 100 ml', 'Energy 42 kcal')).warnings.join(' ')).toMatch(/per 100 ml/);
  });

  it('needs a unit for sodium', () => {
    expect(parseLabel(lines('Sodium 140')).fields.sodium_mg.status).toBe('check');
    expect(parseLabel(lines('Sodium 0.4 g')).fields.sodium_mg.value).toBe(400);
  });

  // Found in the QA sweep: each of these used to save a wrong number.
  const L = (text: string) => parseLabel(linesFromText(text));

  it('does not read "Calories from Fat" as fat or lose the calories', () => {
    const one = L('Serving Size 1 cup (240g)\nCalories 250 Calories from Fat 110\nTotal Fat 12g 18%');
    expect([one.fields.fat_g.value, one.fields.energy_kcal.value]).toEqual([12, 250]);
    expect(L('Serving Size 1 cup (240g)\nCalories 250\nCalories from Fat 110\nTotal Fat 12g').fields.fat_g.value).toBe(12);
  });

  it('keeps a US label per serving when a net weight mentions 100 g', () => {
    expect(L('Serving size 1 oz (28g)\nNet Wt 3.5 oz (100g)\nCalories 140').basis).toBe('serving');
    expect(L('Serving size 30g\nNet weight 1100g\nCalories 120').basis).toBe('serving');
    // Real headers still set per 100 g, in any wording.
    expect(L('Información nutricional por 100 g\nGrasas 3,5 g').basis).toBe('100g');
    expect(L('Nutrition information 100g 30g\nFat 4g 1.2g').basis).toBe('100g');
  });

  it('reads the 100 g column when a gram serving column comes first', () => {
    const scan = L('Per 30g Per 100g\nEnergy 450kJ/108kcal 1500kJ/360kcal\nFat 1.2g 4.0g');
    expect([scan.fields.fat_g.value, scan.fields.energy_kcal.value]).toEqual([4, 360]);
  });

  it('asks instead of guessing for thousands dots, one-column rows and ranges', () => {
    expect(L('Per 100g\nEnergy 1.046 kJ\nFat 12g').fields.energy_kcal.status).toBe('check');
    expect(L('Per serving (30g) Per 100g\nFat 1.2g').fields.fat_g.status).toBe('check');
    expect(L('Serving size 30g\nProtein 2-3g').fields.protein_g.status).toBe('check');
  });

  it('skips polyunsaturated fat and takes the serving size line over the header', () => {
    expect(L('Serving size 30g\nPolyunsaturated Fat 2g\nTotal Fat 4g').fields.fat_g.value).toBe(4);
    expect(L('Per 100g Per serving\nServing size 30g\nFat 4g 1.2g').servingGrams).toBe(30);
  });

  it('returns all unknown for text that is not a label', () => {
    const scan = parseLabel(lines('Hello world', 'Open 9 to 5'));
    expect(Object.values(scan.fields).every((f) => f.value === null && f.status === 'missing')).toBe(true);
  });
});

describe('labelToPer100g', () => {
  const v = { ...emptyNutrients(), energy_kcal: 230, fat_g: 8, sodium_mg: 160 };

  it('scales per-serving values by the serving weight and keeps unknown as unknown', () => {
    const out = labelToPer100g(v, 'serving', 50);
    expect(out).toEqual({ ...emptyNutrients(), energy_kcal: 460, fat_g: 16, sodium_mg: 320 });
  });

  it('needs a serving weight for per-serving values', () => {
    expect(labelToPer100g(v, 'serving', null)).toMatch(/serving size in grams/);
    expect(labelToPer100g(v, 'serving', 0)).toMatch(/serving size in grams/);
  });

  it('keeps per 100 g values', () => {
    expect(labelToPer100g(v, '100g', null)).toEqual(v);
  });
});

describe('toLines', () => {
  it('joins boxes on the same row left to right and keeps rows top to bottom', () => {
    const box = (text: string, x: number, y: number, confidence = 0.9) => ({ text, confidence, x, y, width: 0.2, height: 0.04 });
    const out = toLines([box('8g', 0.7, 0.301), box('Protein', 0.1, 0.4), box('Total Fat', 0.1, 0.3), box('3g', 0.7, 0.402, 0.4), box(' ', 0.5, 0.5)]);
    expect(out).toEqual([
      { text: 'Total Fat 8g', confidence: 0.9 },
      { text: 'Protein 3g', confidence: 0.4 },
    ]);
  });

  it('turns edited text back into lines', () => {
    expect(linesFromText(' Calories 100 \n\nProtein 3g')).toEqual(lines('Calories 100', 'Protein 3g').map((l) => ({ ...l, confidence: 1 })));
  });
});

describe('parseMenu', () => {
  it('lists dishes without prices and keeps descriptions as details', () => {
    const items = parseMenu([
      ...lines('STARTERS', 'Tomato Soup $6.50', 'roasted tomatoes, basil, cream', 'Caesar Salad 9.00', 'Romaine, parmesan, croutons and anchovy dressing with lemon', 'Chicken Burrito ......... 12.95', '12.95', 'Tomato Soup'),
      { text: 'Blurry Special', confidence: 0.2 },
    ]);
    expect(items).toEqual([
      { name: 'STARTERS', details: null },
      { name: 'Tomato Soup', details: 'roasted tomatoes, basil, cream' },
      { name: 'Caesar Salad', details: 'Romaine, parmesan, croutons and anchovy dressing with lemon' },
      { name: 'Chicken Burrito', details: null },
    ]);
  });

  it('keeps numbers that are part of a dish name', () => {
    expect(parseMenu(linesFromText('Chicken 65 $12\n7 Layer Dip 9.50\n2 Eggs Any Style 8\n1. Burger ..... 14')).map((i) => i.name)).toEqual(['Chicken 65', '7 Layer Dip', '2 Eggs Any Style', 'Burger']);
  });
});
