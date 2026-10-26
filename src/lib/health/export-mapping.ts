import { supabase } from '@/lib/supabase';
import { assertHealthOwner } from './owner';
import type { ExportMapping } from './export-queue';

// Server record of what this account exported (table health_exports). Holds ids and versions only, never Health values.
export function healthExportMapping(userId: string, deviceId: () => Promise<string>): ExportMapping {
  const fail = () => new Error("Couldn't reach your account. The export will retry.");
  return {
    async get(kind, recordId) {
      await assertHealthOwner(userId);
      const { data, error } = await supabase.from('health_exports').select('sync_version').eq('user_id', userId).eq('kind', kind).eq('record_id', recordId).maybeSingle();
      if (error) throw fail();
      return data ? { syncVersion: data.sync_version } : null;
    },
    async record(kind, recordId, sampleUuid, version) {
      await assertHealthOwner(userId);
      // A null sample uuid is valid server-side; the generated argument type just isn't nullable.
      const { error } = await supabase.rpc('record_health_export', { p_kind: kind, p_record_id: recordId, p_sample_uuid: sampleUuid as string, p_version: version, p_device: await deviceId() });
      if (error) throw fail();
    },
    async remove(kind, recordId) {
      await assertHealthOwner(userId);
      const { error } = await supabase.from('health_exports').delete().eq('user_id', userId).eq('kind', kind).eq('record_id', recordId);
      if (error) throw fail();
    },
  };
}
