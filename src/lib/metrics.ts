import { lastNDates } from '@/lib/health/dates';
import { MAX_MANUAL_STEPS, type StepRow } from '@/lib/health/rules';
import { supabase } from '@/lib/supabase';

export type MetricRow = StepRow & { metric?: 'steps' };

const CAP_MESSAGE = "Steps can't be more than 80,000 in a day.";
const INVALID_MESSAGE = 'Steps must be a whole number of 0 or more.';
const GENERIC_MESSAGE = "Couldn't save your steps. Check your connection and try again.";

async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error('Sign in to save your steps.');
  return data.user.id;
}

// Upserts on (user_id, date, metric). Callers decide which rows to send (see planSync for the sync-vs-manual rule).
export async function upsertDailyMetrics(rows: MetricRow[]): Promise<void> {
  if (rows.length === 0) return;
  for (const r of rows) {
    if (!Number.isInteger(r.value) || r.value < 0) throw new Error(INVALID_MESSAGE);
    if (r.source === 'manual' && r.value > MAX_MANUAL_STEPS) throw new Error(CAP_MESSAGE);
  }
  const user_id = await currentUserId();
  const { error } = await supabase
    .from('daily_metrics')
    .upsert(rows.map((r) => ({ user_id, date: r.date, metric: r.metric ?? 'steps', value: r.value, source: r.source })), {
      onConflict: 'user_id,date,metric',
    });
  if (error) throw new Error(error.code === '23514' ? CAP_MESSAGE : GENERIC_MESSAGE);
}

// Removes the manual row for a day so the next HealthKit sync can fill it.
export async function deleteManualSteps(date: string): Promise<void> {
  const user_id = await currentUserId();
  const { error } = await supabase
    .from('daily_metrics')
    .delete()
    .eq('user_id', user_id)
    .eq('date', date)
    .eq('metric', 'steps')
    .eq('source', 'manual');
  if (error) throw new Error(GENERIC_MESSAGE);
}

// Last `days` local calendar days including today, oldest first. Days without a row are omitted.
export async function getMyRecentSteps(days: number, now: Date = new Date()): Promise<StepRow[]> {
  const user_id = await currentUserId();
  const { data, error } = await supabase
    .from('daily_metrics')
    .select('date, value, source')
    .eq('user_id', user_id)
    .eq('metric', 'steps')
    .gte('date', lastNDates(days, now)[0])
    .order('date');
  if (error) throw new Error("Couldn't load your steps. Pull down to try again.");
  return data.map((r) => ({ date: r.date, value: Number(r.value), source: r.source as StepRow['source'] }));
}
