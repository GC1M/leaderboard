// Food photo assistance (#51 to #53). Text is read on the device (modules/leaderboard-text-recognizer) and this
// file turns it into suggestions the user reviews before anything is saved. Pure, no I/O.
// A value we cannot read with confidence is left blank with a note, never guessed, and a missing nutrient stays
// unknown, never 0.
import { emptyNutrients, kjToKcal, NUTRIENT_KEYS, type NutrientKey, type Nutrients } from './nutrition';

export type TextBox = { text: string; confidence: number; x: number; y: number; width: number; height: number };
export type ScanLine = { text: string; confidence: number };

// Vision confidence below this is treated as unreadable.
export const LOW_CONFIDENCE = 0.5;

// Vision returns one box per run of text, and a label row is often split into a name box and a value box.
// Boxes whose vertical centres are within half a box height of the row form one line, read left to right.
export function toLines(boxes: readonly TextBox[]): ScanLine[] {
  const sorted = boxes
    .filter((b) => b.text.trim() !== '')
    .map((b) => ({ ...b, cy: b.y + b.height / 2 }))
    .sort((a, b) => a.cy - b.cy);
  const rows: (typeof sorted)[] = [];
  for (const b of sorted) {
    const row = rows[rows.length - 1];
    const cy = row ? row.reduce((s, r) => s + r.cy, 0) / row.length : 0;
    const h = row ? Math.min(b.height, ...row.map((r) => r.height)) : 0;
    if (row && Math.abs(cy - b.cy) < h / 2) row.push(b);
    else rows.push([b]);
  }
  return rows.map((row) => {
    row.sort((a, b) => a.x - b.x);
    return { text: row.map((b) => b.text.trim()).join(' '), confidence: Math.min(...row.map((b) => b.confidence)) };
  });
}

// Edited text from the review screen back into lines. Typed text counts as fully confident.
export const linesFromText = (text: string): ScanLine[] =>
  text.split('\n').map((t) => t.trim()).filter(Boolean).map((t) => ({ text: t, confidence: 1 }));

export type FieldStatus = 'read' | 'check' | 'missing';
export type LabelField = { value: number | null; status: FieldStatus; note: string | null };
// 'serving': values are for one serving (US labels). '100g': values are per 100 g or 100 ml (EU labels).
export type Basis = 'serving' | '100g';
export type LabelScan = {
  basis: Basis;
  servingGrams: number | null;
  servingText: string | null;
  fields: Record<NutrientKey, LabelField>;
  warnings: string[];
};

type Token = { raw: string; value: number | null; unit: string; less: boolean; ambiguous: boolean };

// Numbers with an optional unit. Percent values (% Daily Value) are dropped by the caller.
const NUMBER = /(<|less than\s*)?(\d+(?:[.,]\d+)*)\s*(kcal|kj|cal|mg|mcg|µg|g)?\b(\s*%)?/gi;

// "3,5" is a decimal comma. "1,046" could be 1046 or 1.046, so it is only trusted for energy, where it is a
// thousands separator; anywhere else it needs the user.
function parseNumber(raw: string, energy: boolean): { value: number | null; ambiguous: boolean } {
  if (/^\d{1,3}(,\d{3})+$/.test(raw)) return energy ? { value: Number(raw.replace(/,/g, '')), ambiguous: false } : { value: null, ambiguous: true };
  // "1.046" is a thousands dot on many EU labels, not 1.046.
  if (/[.,].*[.,]/.test(raw) || /^[1-9]\d{0,2}\.\d{3}$/.test(raw)) return { value: null, ambiguous: true };
  const n = Number(raw.replace(',', '.'));
  return Number.isFinite(n) ? { value: n, ambiguous: false } : { value: null, ambiguous: true };
}

function tokens(text: string, energy = false): Token[] {
  // OCR often reads 0 as O next to digits ("1O g").
  const fixed = text.replace(/(\d)[oO]/g, (_, d: string) => `${d}0`).replace(/[oO](\d)/g, (_, d: string) => `0${d}`);
  const out: Token[] = [];
  for (const m of fixed.matchAll(NUMBER)) {
    if (m[4]) continue;
    const { value, ambiguous } = parseNumber(m[2], energy);
    // Either end of a range ("2-3g") is not the value.
    const end = (m.index ?? 0) + m[0].length;
    const range = (!m[3] && /^\s*[-–]\s*\d/.test(fixed.slice(end))) || /\d\s*[-–]\s*$/.test(fixed.slice(0, m.index));
    out.push({ raw: m[0].trim(), value, unit: (m[3] ?? '').toLowerCase(), less: !!m[1], ambiguous: ambiguous || range || fixed !== text });
  }
  return out;
}

// Order matters: the more specific name is checked first ("Saturated Fat" before "Fat").
const NUTRIENT_NAMES: [Exclude<NutrientKey, 'energy_kcal'>, RegExp][] = [
  ['sat_fat_g', /\b(saturated( fat)?|sat\.? fat|saturates)\b/i],
  ['fat_g', /\b(total fat|fat)\b/i],
  ['sugars_g', /\b(total sugars?|sugars?)\b/i],
  ['fiber_g', /\b(dietary fib(er|re)|fib(er|re))\b/i],
  ['carbs_g', /\b(total carb(ohydrate)?s?\.?|carbohydrates?|carbs?)\b/i],
  ['protein_g', /\bprotein\b/i],
  ['sodium_mg', /\bsodium\b/i],
];
// Lines that name a nutrient we do not store, or a sub-amount that would be misread as the total.
const SKIP = /\b(trans|added|poly\w*|mono\w*|cholesterol|potassium|calcium|iron|vitamin|daily value|diet|from fat)\b/i;

const field = (value: number | null, status: FieldStatus, note: string | null = null): LabelField => ({ value, status, note });
const missing = () => field(null, 'missing');

const HUNDRED = /(^|[^\d.,])100\s*(g|ml)\b/i;
// A row that names a nutrient is a value row, not the column header.
const NAMED = /(calorie|energy|kcal|\bkj\b|\bsalt\b)/i;

// The column to read when a label has a per 100 g and a per serving column. Only a header ("Per 100g",
// "Typical values 100g") sets the basis, never a net weight such as "Net Wt 3.5 oz (100g)".
function columns(lines: readonly ScanLine[]): { basis: Basis; column: number; per100ml: boolean } {
  const header = lines.find((l) => HUNDRED.test(l.text) && !NAMED.test(l.text) && !NUTRIENT_NAMES.some(([, re]) => re.test(l.text)) && !/net\s*(wt|weight)|(serving|portion) size/i.test(l.text));
  if (!header) return { basis: 'serving', column: 0, per100ml: false };
  const t = header.text.toLowerCase();
  // A serving column ("Per bar", "Per 30g") before the 100 g one puts the per 100 g values second.
  const before = t.slice(0, t.search(HUNDRED));
  return { basis: '100g', column: /serving|portion|pack|bar|piece|\d\s*(g|ml)\b/.test(before) ? 1 : 0, per100ml: /100\s*ml\b/.test(t) && !/100\s*g\b/.test(t) };
}

function readNutrient(key: Exclude<NutrientKey, 'energy_kcal'>, line: ScanLine, after: string, column: number): LabelField {
  const found = tokens(after);
  if (found.length === 0) return missing();
  const tok = found[column];
  if (!tok) return field(null, 'check', `Label shows "${found[0].raw}" in one column only. Enter the value per 100 g.`);
  const shown = `Label shows "${tok.raw}".`;
  if (line.confidence < LOW_CONFIDENCE || tok.ambiguous || tok.value == null) return field(null, 'check', `${shown} Enter the value.`);
  if (tok.less) return field(null, 'check', `Label says less than ${tok.value} ${tok.unit || 'g'}. Enter the value or leave it blank.`);
  if (key === 'sodium_mg') {
    if (tok.unit === 'mg') return field(tok.value, 'read');
    if (tok.unit === 'g') return field(tok.value * 1000, 'read', 'Converted from grams.');
    return field(null, 'check', `${shown} Enter sodium in mg.`);
  }
  if (tok.unit === 'g' || tok.unit === '') return field(tok.value, 'read');
  if (tok.unit === 'mg') return field(tok.value / 1000, 'read', 'Converted from mg.');
  return field(null, 'check', `${shown} Enter the value in grams.`);
}

function readEnergy(lines: readonly ScanLine[], column: number): LabelField {
  // "Calories 250 Calories from Fat 110": only the part before "from fat" is the energy.
  const energyLines = lines
    .map((l) => ({ ...l, text: l.text.replace(/\b(calories\s+)?from fat.*$/i, '') }))
    .filter((l) => /(calorie|energy|kcal|\bkj\b)/i.test(l.text) && !/(diet|daily)/i.test(l.text));
  if (energyLines.length === 0) return missing();
  const all = energyLines.flatMap((l) => tokens(l.text, true).map((t) => ({ ...t, low: l.confidence < LOW_CONFIDENCE })));
  const kcal = all.filter((t) => t.unit === 'kcal' || t.unit === 'cal');
  const kj = all.filter((t) => t.unit === 'kj');
  const bare = energyLines.filter((l) => /calories/i.test(l.text)).flatMap((l) => tokens(l.text, true).filter((t) => t.unit === '').map((t) => ({ ...t, low: l.confidence < LOW_CONFIDENCE })));
  const tok = kcal[column] ?? kj[column] ?? bare[column];
  if (!tok) return field(null, 'check', 'Calories were not readable. Enter them.');
  if (tok.low || tok.ambiguous || tok.value == null || tok.less) return field(null, 'check', `Label shows "${tok.raw}". Enter calories in kcal.`);
  if (tok.unit === 'kj') {
    const kcalValue = Math.round(kjToKcal(tok.value));
    if (kcalValue === 0 && tok.value > 0) return field(null, 'check', `Label shows "${tok.raw}". Enter calories in kcal.`);
    return field(kcalValue, 'read', `Converted from ${tok.value} kJ.`);
  }
  return field(tok.value, 'read');
}

const SERVING = /(serving|portion) size|per (serving|portion|pack|bar|piece)|serving/i;

// The serving weight. On a header such as "Per 100g Per 30g serving" the 100 g column is skipped; a weight in
// brackets ("1 cup (240g)") wins.
function servingSize(lines: readonly ScanLine[]): { grams: number | null; text: string | null; warning: string | null } {
  const line = lines.find((l) => /(serving|portion) size/i.test(l.text)) ?? lines.find((l) => SERVING.test(l.text) && !/servings per/i.test(l.text));
  if (!line) return { grams: null, text: null, warning: null };
  const found = [...line.text.matchAll(/(\()?\s*(\d+(?:[.,]\d+)?)\s*(g|ml)\b/gi)].map((m) => ({ bracket: !!m[1], value: Number(m[2].replace(',', '.')), ml: m[3].toLowerCase() === 'ml' }));
  const m = found.find((f) => f.bracket) ?? found.find((f) => f.value !== 100 || found.length === 1);
  if (!m) return { grams: null, text: line.text, warning: null };
  if (m.ml) return { grams: null, text: line.text, warning: 'The serving is in ml. Enter its weight in grams if you know it.' };
  return { grams: line.confidence < LOW_CONFIDENCE ? null : m.value, text: line.text, warning: null };
}

// Reads a nutrition label. Values are in the label's basis; labelToPer100g converts after the user reviews them.
export function parseLabel(lines: readonly ScanLine[]): LabelScan {
  const { basis, column, per100ml } = columns(lines);
  const fields = Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, missing()])) as Record<NutrientKey, LabelField>;
  const warnings: string[] = [];
  fields.energy_kcal = readEnergy(lines, column);
  let salt: { line: ScanLine; after: string } | null = null;
  for (const line of lines) {
    if (SKIP.test(line.text)) continue;
    if (/\bsalt\b/i.test(line.text)) salt = { line, after: line.text.slice(line.text.search(/\bsalt\b/i) + 4) };
    for (const [key, re] of NUTRIENT_NAMES) {
      const m = line.text.match(re);
      if (!m || m.index === undefined) continue;
      if (fields[key].status === 'missing') fields[key] = readNutrient(key, line, line.text.slice(m.index + m[0].length), column);
      break;
    }
  }
  // EU labels give salt instead of sodium. 1 g salt is 400 mg sodium (salt = sodium x 2.5).
  if (fields.sodium_mg.status === 'missing' && salt) {
    const s = readNutrient('fat_g', salt.line, salt.after, column);
    fields.sodium_mg = s.value == null ? field(null, s.status === 'missing' ? 'missing' : 'check', s.note) : field(Math.round(s.value * 400), 'read', `Worked out from ${s.value} g salt.`);
  }
  const serving = servingSize(lines);
  if (serving.warning) warnings.push(serving.warning);
  if (per100ml) warnings.push('Values are per 100 ml. They are saved as per 100 g, so check this suits the food.');
  checkPlausible(fields, basis === '100g' ? 100 : serving.grams, warnings);
  return { basis, servingGrams: serving.grams, servingText: serving.text, fields, warnings };
}

const MAX_PER_100G: Record<NutrientKey, number> = { energy_kcal: 900, protein_g: 100, carbs_g: 100, fat_g: 100, fiber_g: 100, sugars_g: 100, sat_fat_g: 100, sodium_mg: 40000 };

// Flags values that cannot be right instead of saving them: more than 100 g of something per 100 g, a part larger
// than its total, or calories far from what protein, carbs and fat add up to.
function checkPlausible(fields: Record<NutrientKey, LabelField>, grams: number | null, warnings: string[]) {
  const flag = (k: NutrientKey, why: string) => {
    fields[k] = field(null, 'check', `${why} Enter the value from the label.`);
  };
  if (grams && grams > 0) {
    for (const k of NUTRIENT_KEYS) {
      const v = fields[k].value;
      if (v != null && (v * 100) / grams > MAX_PER_100G[k]) flag(k, `Read ${v}, which is too high for this amount.`);
    }
  }
  for (const [part, whole] of [['sat_fat_g', 'fat_g'], ['sugars_g', 'carbs_g'], ['fiber_g', 'carbs_g']] as const) {
    const p = fields[part].value;
    const w = fields[whole].value;
    if (p != null && w != null && p > w) flag(part, `Read ${p}, more than the total of ${w}.`);
  }
  const { energy_kcal: e, protein_g: p, carbs_g: c, fat_g: f } = fields;
  if (e.value != null && p.value != null && c.value != null && f.value != null) {
    const sum = 4 * p.value + 4 * c.value + 9 * f.value;
    if (Math.abs(e.value - sum) > Math.max(20, e.value * 0.25)) warnings.push(`Calories (${e.value}) don't match protein, carbs and fat (about ${Math.round(sum)} kcal). Check the values.`);
  }
}

// Reviewed values to per 100 g, the basis custom foods are stored in. Returns an error message when the serving
// weight needed for the conversion is missing.
export function labelToPer100g(values: Nutrients, basis: Basis, servingGrams: number | null): Nutrients | string {
  if (basis === '100g') return { ...values };
  if (servingGrams == null || !Number.isFinite(servingGrams) || servingGrams <= 0) return 'Enter the serving size in grams, so the values can be saved per 100 g.';
  const out = emptyNutrients();
  for (const k of NUTRIENT_KEYS) out[k] = values[k] == null ? null : (values[k] * 100) / servingGrams;
  return out;
}

export type MenuItem = { name: string; details: string | null };

const PRICE = /([$€£]\s*\d+(?:[.,]\d{1,2})?|\b\d+[.,]\d{2}\b)/g;
const LETTER = /[a-zà-ÿ]/gi;

// Menu text to a list of dishes the user can pick from. A long or lower-case line under a dish is its
// description, shown as the listed ingredients. Nothing here estimates nutrition: the user picks the closest
// food and the amount, and the entry is marked as an estimate.
export function parseMenu(lines: readonly ScanLine[]): MenuItem[] {
  const items: MenuItem[] = [];
  for (const line of lines) {
    if (line.confidence < LOW_CONFIDENCE) continue;
    const unpriced = line.text.replace(PRICE, ' ');
    const trimEnd = (t: string) => t.replace(/[^a-z0-9à-ÿ)]+$/i, '');
    // Numbers can be part of a name ("Chicken 65", "7 Layer Dip"). A bare trailing number is only taken as the
    // price when the line has no other price; a leading "1." or "2)" is a list marker.
    let text = trimEnd(unpriced.replace(/\s+/g, ' ').trim().replace(/^(\d{1,2}[.)]\s+|[^a-z0-9à-ÿ]+)/i, ''));
    if (unpriced === line.text) text = trimEnd(text.replace(/\s\d+$/, ''));
    if ((text.match(LETTER) ?? []).length < 3) continue;
    const last = items[items.length - 1];
    if (last && (/^[a-zà-ÿ]/.test(text) || text.split(' ').length > 6)) {
      last.details = last.details ? `${last.details} ${text}` : text;
      continue;
    }
    if (!items.some((i) => i.name.toLowerCase() === text.toLowerCase())) items.push({ name: text.slice(0, 80), details: null });
  }
  return items;
}

export const MENU_NOTE =
  'Menu dishes vary in portion size and recipe, so this is an estimate. Pick the closest food, enter how much you ate, and change the amount if you know better.';
