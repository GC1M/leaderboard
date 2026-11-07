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

export async function getMyWeightHistory(userId: string, from: Date): Promise<{ id: string; kg: number; measuredAt: string; source: string }[]> {
  await assertHealthOwner(userId);
  const { data, error } = await supabase.from('weight_measurements').select('id,kg,measured_at,source')
    .eq('user_id', userId).gte('measured_at', from.toISOString()).order('measured_at');
  if (error) throw new Error("Couldn't load weight history. Try again.");
  return data.map((r) => ({ id: r.id, kg: Number(r.kg), measuredAt: r.measured_at, source: r.source }));
}

// Manual rows only: an imported reading is never edited or deleted here (and so never exported).
// Insert when `id` is omitted, otherwise edit that manual row. Returns the row id, which is the export record id.
export async function saveManualWeight(userId: string, input: { id?: string; kg: number; measuredAt: string }): Promise<string> {
  if (!Number.isFinite(input.kg) || input.kg <= 0 || input.kg >= 1000 || !Number.isFinite(Date.parse(input.measuredAt))) throw new Error('Invalid weight data.');
  await assertHealthOwner(userId);
  const row = { kg: input.kg, measured_at: input.measuredAt };
  const q = input.id
    ? supabase.from('weight_measurements').update(row).eq('id', input.id).eq('user_id', userId).eq('source', 'manual')
    : supabase.from('weight_measurements').insert({ ...row, user_id: userId, source: 'manual' });
  const { data, error } = await q.select('id').single();
  if (error) throw new Error(error.code === '23505' ? 'You already have a manual weight at that time.' : "Couldn't save weight. Try again.");
  return data.id;
}

export async function deleteManualWeight(userId: string, id: string): Promise<void> {
  await assertHealthOwner(userId);
  const { error } = await supabase.from('weight_measurements').delete().eq('id', id).eq('user_id', userId).eq('source', 'manual');
  if (error) throw new Error("Couldn't delete weight. Try again.");
}
