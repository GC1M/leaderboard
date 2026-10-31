import { supabase } from './supabase';
// One row suffices; a recorded zero is still a row. No lookback cutoff or value > 0 filter.
export async function hasMetricHistory(metric: 'steps' | 'sleep_min'): Promise<boolean> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('Sign in to view history.');
  const { data, error } = await supabase.from('daily_metrics').select('date').eq('user_id', auth.user.id).eq('metric', metric).limit(1);
  if (error) throw new Error('Could not load history. Try again.');
  return data.length > 0;
}
export const hasStepHistory = () => hasMetricHistory('steps');
export const hasSleepHistory = () => hasMetricHistory('sleep_min');
