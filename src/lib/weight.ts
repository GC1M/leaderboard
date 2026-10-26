import { assertHealthOwner } from '@/lib/health/owner';
import type { WeightReading } from '@/lib/health/weight';
import { supabase } from '@/lib/supabase';

export async function saveHealthWeight(userId: string, readings: readonly WeightReading[]): Promise<void> {
  if (!readings.length) return;
  if (readings.some((r) => !Number.isFinite(r.kg) || r.kg <= 0 || r.kg >= 1000 || !Number.isFinite(Date.parse(r.measuredAt)))) throw new Error('Invalid weight data.');
  await assertHealthOwner(userId);
  const { error } = await supabase.from('weight_measurements').upsert(readings.map((r) => ({
    user_id: userId, measured_at: r.measuredAt, kg: r.kg, source: 'healthkit',
  })), { onConflict: 'user_id,measured_at,source' });
  if (error) throw new Error("Couldn't save weight. Try again.");
}

export async function getMyLatestWeight(userId: string): Promise<{ kg: number; measuredAt: string; source: string } | null> {
  await assertHealthOwner(userId);
  const { data, error } = await supabase.from('latest_weight').select('kg,measured_at,source').eq('user_id', userId).maybeSingle();
  if (error) throw new Error("Couldn't load weight. Try again.");
  return data ? { kg: Number(data.kg), measuredAt: data.measured_at, source: data.source } : null;
}

export async function getMyWeightHistory(userId: string, from: Date): Promise<{ kg: number; measuredAt: string; source: string }[]> {
  await assertHealthOwner(userId);
  const { data, error } = await supabase.from('weight_measurements').select('kg,measured_at,source')
    .eq('user_id', userId).gte('measured_at', from.toISOString()).order('measured_at');
  if (error) throw new Error("Couldn't load weight history. Try again.");
  return data.map((r) => ({ kg: Number(r.kg), measuredAt: r.measured_at, source: r.source }));
}
