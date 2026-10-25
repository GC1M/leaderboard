export const MAX_STEPS = 80000;

export type StepsValidation = { ok: true; value: number } | { ok: false; message: string };

// Manual entry: whole number 0..80000 (the DB check rejects above).
export function validateSteps(input: string): StepsValidation {
  const text = input.replace(/[,\s]/g, '');
  if (!/^\d+$/.test(text)) return { ok: false, message: 'Enter a whole number of steps.' };
  const value = Number(text);
  if (value > MAX_STEPS) return { ok: false, message: "Steps can't be more than 80,000 in a day." };
  return { ok: true, value };
}

// HealthKit values are trusted but still rounded and capped so one odd day can't fail the whole batch.
export function clampSteps(n: number): number {
  return Math.min(MAX_STEPS, Math.max(0, Math.round(n)));
}

export type StepRow = { date: string; value: number; source: 'healthkit' | 'manual' };

// Merge rule: a manual entry is an explicit user edit, so sync never overwrites it.
// A manual save does replace a healthkit row (the UI warns first). "Use Health data" deletes the manual row so the next sync fills it.
export function planSync(health: { date: string; value: number }[], existing: StepRow[]): StepRow[] {
  const manualDays = new Set(existing.filter((r) => r.source === 'manual').map((r) => r.date));
  return health
    .filter((h) => !manualDays.has(h.date))
    .map((h) => ({ date: h.date, value: clampSteps(h.value), source: 'healthkit' as const }));
}
