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
