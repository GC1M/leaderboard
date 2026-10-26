import { lastNDates } from '@/lib/health/dates';
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
  const { data, error } = await supabase.from('daily_metrics').select('date,value,window_start,window_end')
    .eq('user_id', userId).eq('metric', 'sleep_min').gte('date', lastNDates(days, now)[0]).order('date');
  if (error) throw new Error("Couldn't load sleep. Try again.");
  return data.map((d) => ({ date: d.date, value: Number(d.value), windowStart: d.window_start!, windowEnd: d.window_end! }));
}
