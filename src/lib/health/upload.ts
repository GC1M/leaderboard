import { supabase } from '@/lib/supabase';
import { assertHealthOwner } from './owner';
import type { HealthMetric } from './healthkit';
import type { HealthChanges } from './changes';

export async function uploadHealthChanges(userId: string, deviceId: string, metric: HealthMetric, changes: HealthChanges): Promise<void> {
  if (!changes.daily.length && !changes.removeDaily.length && !changes.weight.length && !changes.removeWeight.length) return;
  await assertHealthOwner(userId);
  const { error } = await supabase.rpc('apply_health_changes', {
    p_owner: userId, p_device: deviceId, p_metric: metric,
    p_daily: changes.daily.map((d) => ({ ...d })), p_remove_daily: changes.removeDaily,
    p_weight: changes.weight.map((w) => ({ ...w })), p_remove_weight: changes.removeWeight,
  });
  if (error) throw new Error("Couldn't upload Health changes. Your data is saved on this device; retry sync.");
}
