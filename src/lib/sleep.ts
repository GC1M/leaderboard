import { lastNDates, localDateKey } from '@/lib/health/dates';
import { assertHealthOwner } from '@/lib/health/owner';
import type { SleepDay } from '@/lib/health/sleep';
import { supabase } from '@/lib/supabase';

export async function saveHealthSleep(userId: string, days: readonly SleepDay[]): Promise<void> {
  if (!days.length) return;
  if (days.some((d) => !Number.isFinite(d.value) || d.value < 0 || !Number.isFinite(Date.parse(d.windowStart)) ||
    !Number.isFinite(Date.parse(d.windowEnd)) || Date.parse(d.windowEnd) < Date.parse(d.windowStart))) throw new Error('Invalid sleep data.');
  await assertHealthOwner(userId);
  const { error } = await supabase.from('daily_metrics').upsert(days.map((d) => ({
    user_id: userId, metric: 'sleep_min', source: 'healthkit', date: d.date, value: d.value,
    window_start: d.windowStart, window_end: d.windowEnd,
  })), { onConflict: 'user_id,date,metric' });
  if (error) throw new Error("Couldn't save sleep. Try again.");
}

export async function getMyRecentSleep(userId: string, days: number, now = new Date()): Promise<SleepDay[]> {
  await assertHealthOwner(userId);
  const { data, error } = await supabase.from('daily_metrics').select('date,value,window_start,window_end,source')
    .eq('user_id', userId).eq('metric', 'sleep_min').gte('date', lastNDates(days, now)[0]).order('date');
  if (error) throw new Error("Couldn't load sleep. Try again.");
  return data.map((d) => ({ date: d.date, value: Number(d.value), source: d.source === 'manual' ? 'manual' : 'healthkit', windowStart: d.window_start!, windowEnd: d.window_end! }));
}

// Manual sleep is one row per wake-up date (the same row Health import fills, which it never overwrites once manual).
// Returns the date, which is the export record id.
export async function saveManualSleep(userId: string, start: Date, end: Date): Promise<string> {
  const minutes = (end.getTime() - start.getTime()) / 60000;
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 1440) throw new Error('Invalid sleep data.');
  await assertHealthOwner(userId);
  const date = localDateKey(end);
  const { error } = await supabase.from('daily_metrics').upsert({
    user_id: userId, metric: 'sleep_min', source: 'manual', date, value: minutes,
    window_start: start.toISOString(), window_end: end.toISOString(),
  }, { onConflict: 'user_id,date,metric' });
  if (error) throw new Error("Couldn't save sleep. Try again.");
  return date;
}

export async function deleteManualSleep(userId: string, date: string): Promise<void> {
  await assertHealthOwner(userId);
  const { error } = await supabase.from('daily_metrics').delete()
    .eq('user_id', userId).eq('metric', 'sleep_min').eq('date', date).eq('source', 'manual');
  if (error) throw new Error("Couldn't delete sleep. Try again.");
}

export async function getMyManualSleep(userId: string, days: number, now = new Date()): Promise<SleepDay[]> {
  await assertHealthOwner(userId);
  const { data, error } = await supabase.from('daily_metrics').select('date,value,window_start,window_end,source')
    .eq('user_id', userId).eq('metric', 'sleep_min').eq('source', 'manual').gte('date', lastNDates(days, now)[0]).order('date', { ascending: false });
  if (error) throw new Error("Couldn't load sleep. Try again.");
  return data.map((d) => ({ date: d.date, value: Number(d.value), source: d.source === 'manual' ? 'manual' : 'healthkit', windowStart: d.window_start!, windowEnd: d.window_end! }));
}
