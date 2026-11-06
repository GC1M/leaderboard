// The food diary (#47): a day of entries grouped by meal with totals, editing and deleting entries, and daily
// totals for the history. No entries for a day means no data, never 0 kcal. Entries and edits that have not
// synced come from the pending queue (./pending) and are shown on top of what the server has.
import type { Tables } from '@/lib/database.types';
import { localDateKey } from '@/lib/health/dates';
import { supabase } from '@/lib/supabase';
import { deviceTimezone } from '@/lib/timezone';

import { amountMessage, MEALS, type Meal, type Quantity, resolveQuantity } from './log';
import { emptyNutrients, NUTRIENT_KEYS, type NutrientKey, type NutrientTotals, type Nutrients, scaleNutrients, sumNutrients } from './nutrition';
import { discard, enqueue, flushPending, loadPending, type PendingOp } from './pending';
import { getFood, type Food } from './search';

export type Entry = {
  id: string | null; // null until the server has it
  clientId: string;
  foodId: string | null;
  meal: Meal;
  consumedAt: string;
  timezone: string;
  localDate: string;
  grams: number;
  portionLabel: string | null;
  portionCount: number | null;
  isEstimated: boolean;
  name: string;
  brand: string | null;
  provider: 'usda_fdc' | 'custom';
  providerId: string | null;
  sourceDataType: string | null;
  sourceVersion: string | null;
  nutrients: Nutrients;
  // Not on the server yet: a new entry or an edit waiting to sync, with why the last try failed.
  pending: 'log' | 'edit' | null;
  syncError: string | null;
  updatedAt: string | null; // server row version, used as the Apple Health export version
};

type Row = Partial<Tables<'food_entries'>>;
const num = (v: unknown): number | null => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));

export function entryFromRow(r: Row, pending: Entry['pending'] = null, syncError: string | null = null): Entry {
  const nutrients = emptyNutrients();
  for (const k of NUTRIENT_KEYS) nutrients[k] = num(r[k]);
  return {
    id: r.id ?? null,
    clientId: r.client_id ?? '',
    foodId: r.food_id ?? null,
    meal: r.meal as Meal,
    consumedAt: r.consumed_at as string,
    timezone: r.timezone as string,
    // The server sets local_date from the entry's timezone; an unsynced entry is in this device's.
    localDate: pending ? localDateKey(new Date(r.consumed_at as string)) : (r.local_date as string),
    grams: Number(r.grams),
    portionLabel: r.portion_label ?? null,
    portionCount: num(r.portion_count),
    isEstimated: r.is_estimated === true,
    name: r.food_name as string,
    brand: r.food_brand ?? null,
    provider: r.provider as Entry['provider'],
    providerId: r.provider_id ?? null,
    sourceDataType: r.source_data_type ?? null,
    sourceVersion: r.source_version ?? null,
    nutrients,
    pending,
    syncError,
    updatedAt: r.updated_at ?? null,
  };
}

// Server rows with the queued edits applied, plus queued new entries the server does not have yet.
export function mergePending(rows: Row[], ops: PendingOp[]): Entry[] {
  const out = rows.map((r) => {
    const op = ops.find((o) => o.kind === 'edit' && o.id === r.id);
    return op?.kind === 'edit' ? entryFromRow({ ...r, ...op.patch }, 'edit', op.error ?? null) : entryFromRow(r);
  });
  const have = new Set(rows.map((r) => r.client_id));
  for (const op of ops) if (op.kind === 'log' && !have.has(op.clientId)) out.push(entryFromRow(op.row as Row, 'log', op.error ?? null));
  return out.sort((a, b) => a.consumedAt.localeCompare(b.consumedAt));
}

export type MealGroup = { meal: Meal; label: string; entries: Entry[] } & NutrientTotals;
export type Day = { meals: MealGroup[]; count: number } & NutrientTotals;

// Meals that have entries, in order, each with totals. Totals keep unknown nutrients as incomplete, never 0.
export function groupDay(entries: readonly Entry[]): Day {
  const meals = MEALS.map((m) => {
    const list = entries.filter((e) => e.meal === m.value);
    return { meal: m.value, label: m.label, entries: list, ...sumNutrients(list.map((e) => e.nutrients)) };
  }).filter((m) => m.entries.length > 0);
  return { meals, count: entries.length, ...sumNutrients(entries.map((e) => e.nutrients)) };
}

export const SUMMARY_KEYS = ['energy_kcal', 'protein_g', 'carbs_g', 'fat_g'] as const satisfies readonly NutrientKey[];

// The snapshot of an entry whose food is gone, scaled to a new amount. Unknown stays unknown.
export function scaleSnapshot(n: Nutrients, from: number, to: number): Nutrients {
  const out = emptyNutrients();
  for (const k of NUTRIENT_KEYS) out[k] = n[k] == null ? null : (n[k] * to) / from;
  return out;
}

export type EditInput = { quantity?: Quantity; meal?: Meal; consumedAt?: Date; isEstimated?: boolean };

// The columns to UPDATE. A new amount recomputes grams, portion and every nutrient together: from the source
// food when it still exists, otherwise by scaling the stored snapshot.
export function buildEdit(entry: Entry, input: EditInput, food: Food | null): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (input.quantity) {
    const r = resolveQuantity(input.quantity);
    if (!r) throw new Error(amountMessage(input.quantity.mode));
    Object.assign(patch, { grams: r.grams, portion_label: r.portionLabel, portion_count: r.portionCount }, food ? scaleNutrients(food.per100g, r.grams) : scaleSnapshot(entry.nutrients, entry.grams, r.grams));
  }
  if (input.meal && input.meal !== entry.meal) patch.meal = input.meal;
  if (input.consumedAt) {
    if (!Number.isFinite(input.consumedAt.getTime())) throw new Error('Choose a valid time.');
    // The picked time is on this device's clock, so the entry takes this device's timezone (the server then sets local_date).
    if (input.consumedAt.toISOString() !== new Date(entry.consumedAt).toISOString()) Object.assign(patch, { consumed_at: input.consumedAt.toISOString(), timezone: deviceTimezone() });
  }
  if (input.isEstimated !== undefined && input.isEstimated !== entry.isEstimated) patch.is_estimated = input.isEstimated;
  return patch;
}

// Saves an edit on this device first, then syncs. Resolves to true when the server has it.
export async function saveEdit(uid: string, entry: Entry, input: EditInput): Promise<boolean> {
  // The source food gives exact nutrients; if it cannot be read (offline, or deleted) the snapshot is scaled instead.
  const food = input.quantity && entry.foodId ? await getFood(entry.foodId).catch(() => null) : null;
  const patch = buildEdit(entry, input, food);
  if (Object.keys(patch).length === 0) return true;
  if (entry.id) await enqueue(uid, { kind: 'edit', id: entry.id, patch });
  else {
    const op = (await loadPending(uid)).find((o) => o.kind === 'log' && o.clientId === entry.clientId);
    if (op?.kind === 'log') await enqueue(uid, { ...op, row: { ...op.row, ...patch } });
  }
  return (await flushPending(uid)) === 0;
}

// Deleting is a confirmed online action. An entry that never synced is just dropped from the queue.
export async function removeEntry(uid: string, entry: Entry): Promise<void> {
  if (!entry.id) return discard(uid, { kind: 'log', clientId: entry.clientId, row: {} });
  const { error } = await supabase.from('food_entries').delete().eq('id', entry.id);
  if (error) throw new Error("Couldn't delete that entry. Try again.");
  await discard(uid, { kind: 'edit', id: entry.id, patch: {} });
}

export async function discardPending(uid: string, entry: Entry): Promise<void> {
  await (entry.id ? discard(uid, { kind: 'edit', id: entry.id, patch: {} }) : discard(uid, { kind: 'log', clientId: entry.clientId, row: {} }));
}

// One day's entries. If the server cannot be reached the queued entries still show, with an error.
export async function loadDay(uid: string, date: string): Promise<{ entries: Entry[]; error: string | null }> {
  const ops = await loadPending(uid);
  const { data, error } = await supabase.from('food_entries').select('*').eq('local_date', date).order('consumed_at');
  const entries = mergePending(error ? [] : (data ?? []), ops).filter((e) => e.localDate === date);
  return { entries, error: error ? "Couldn't load your food. Pull down to try again." : null };
}

// One entry by id, or by client id for one that has not synced (or has synced since the link was made).
export async function getEntry(uid: string, key: string): Promise<Entry | null> {
  const ops = await loadPending(uid);
  const queued = ops.find((o) => o.kind === 'log' && o.clientId === key);
  if (queued?.kind === 'log') return entryFromRow(queued.row as Row, 'log', queued.error ?? null);
  const byId = await supabase.from('food_entries').select('*').eq('id', key).maybeSingle();
  const found = byId.data ?? (await supabase.from('food_entries').select('*').eq('client_id', key).maybeSingle()).data;
  if (byId.error && !found) throw new Error("Couldn't load that entry. Try again.");
  return found ? mergePending([found], ops)[0] : null;
}

export type DayTotal = { date: string; entries: number; incomplete: boolean; kcalIncomplete: boolean } & Record<(typeof SUMMARY_KEYS)[number], number | null>;

// Daily totals from the server, which groups by each entry's own local_date. Days with no entries are absent.
export async function getDailyTotals(from: string, to: string): Promise<DayTotal[]> {
  const { data, error } = await supabase.rpc('food_daily_totals', { p_from: from, p_to: to });
  if (error) throw new Error("Couldn't load your nutrition history. Try again.");
  return data.map((d) => ({
    date: d.local_date,
    entries: d.entries,
    energy_kcal: num(d.energy_kcal),
    protein_g: num(d.protein_g),
    carbs_g: num(d.carbs_g),
    fat_g: num(d.fat_g),
    kcalIncomplete: d.energy_kcal_incomplete,
    incomplete: d.energy_kcal_incomplete || d.protein_g_incomplete || d.carbs_g_incomplete || d.fat_g_incomplete,
  }));
}

export async function hasFoodEntries(): Promise<boolean> {
  const { data, error } = await supabase.from('food_entries').select('id').limit(1);
  if (error) throw new Error("Couldn't load your nutrition history. Try again.");
  return data.length > 0;
}

// The chart's values: one per day that has a known total. A day with no entries, or with the nutrient unknown in every entry, is a gap.
export const historyDays = (rows: readonly DayTotal[], key: (typeof SUMMARY_KEYS)[number]) =>
  rows.flatMap((r) => (r[key] === null ? [] : [{ date: r.date, value: r[key] as number }]));
