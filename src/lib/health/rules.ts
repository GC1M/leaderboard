import { kgFromDisplay } from './weight';

// Manual entry only. Health totals are measurements and are never capped.
export const MAX_MANUAL_STEPS = 80000;

export type StepsValidation = { ok: true; value: number } | { ok: false; message: string };

// Manual entry: whole number 0..80000 (the DB check rejects manual rows above).
export function validateSteps(input: string): StepsValidation {
  const text = input.replace(/[,\s]/g, '');
  if (!/^\d+$/.test(text)) return { ok: false, message: 'Enter a whole number of steps.' };
  const value = Number(text);
  if (value > MAX_MANUAL_STEPS) return { ok: false, message: "Steps can't be more than 80,000 in a day." };
  return { ok: true, value };
}

export type StepRow = { date: string; value: number; source: 'healthkit' | 'manual' };

export type SyncPlan = { rows: StepRow[]; skipped: { date: string; value: number }[] };

// Merge rule: a manual entry is an explicit user edit, so sync never overwrites it.
// A manual save does replace a healthkit row (the UI warns first). "Use Health data" deletes the manual row so the next sync fills it.
// Health totals are rounded, never capped. A negative or non-finite total is skipped (and reported), never replaced by an invented value.
export function planSync(health: { date: string; value: number }[], existing: StepRow[]): SyncPlan {
  const manualDays = new Set(existing.filter((r) => r.source === 'manual').map((r) => r.date));
  const plan: SyncPlan = { rows: [], skipped: [] };
  for (const h of health) {
    if (manualDays.has(h.date)) continue;
    if (!Number.isFinite(h.value) || h.value < 0) plan.skipped.push(h);
    else plan.rows.push({ date: h.date, value: Math.round(h.value), source: 'healthkit' });
  }
  return plan;
}

// Manual weight: a positive number in the display unit. The DB accepts kg above 0 and below 1000.
export type WeightValidation = { ok: true; kg: number } | { ok: false; message: string };
export function validateWeight(input: string, unit: 'kg' | 'lb'): WeightValidation {
  const value = Number(input.trim().replace(',', '.'));
  const kg = Math.round(kgFromDisplay(value, unit) * 1000) / 1000;
  if (!/^\d+([.,]\d+)?$/.test(input.trim()) || !(kg > 0 && kg < 1000)) return { ok: false, message: `Enter your weight in ${unit}.` };
  return { ok: true, kg };
}

// Manual sleep: one interval that ends after it starts and lasts at most 24 hours. Counted on the day it ends.
export function validateSleep(start: Date | null, end: Date | null): { ok: true } | { ok: false; message: string } {
  if (!start || !end) return { ok: false, message: 'Enter times as YYYY-MM-DD HH:mm.' };
  if (end <= start) return { ok: false, message: 'Wake time must be after bedtime.' };
  if (end.getTime() - start.getTime() > 24 * 3600 * 1000) return { ok: false, message: "Sleep can't be longer than 24 hours." };
  if (end.getTime() > Date.now()) return { ok: false, message: "Wake time can't be in the future." };
  return { ok: true };
}
