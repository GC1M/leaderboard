import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Switch, Text, View } from 'react-native';

import { Button, styles } from '@/components/ui';
import { alert } from '@/lib/alert';
import { useAuth } from '@/lib/auth';
import { healthProviderName } from '@/lib/health-adapter/capabilities';
import { writeTypesFor } from '@/lib/health/export-queue';
import { getHealthWriteAccess, isHealthAvailable } from '@/lib/health/healthkit';
import { useHealthExport } from '@/lib/health/sync';
import { deletedWaterIds, exportedWater, fetchRecentWaterRows, pendingWaterSaves, settleWaterExport, WATER_KIND, waterDeleteVersion, waterSyncGeneration } from '@/lib/health/water-export';
import { secureStorage } from '@/lib/secure-storage';
import { useTheme } from '@/theme';

const denied = () => Platform.OS === 'android' ? 'Health Connect did not allow saving water. Allow it in Health Connect, App permissions, Leaderboard, then try again.' : 'Health did not allow saving water. Turn it on in Settings, Health, Data Access & Devices, then try again.';
const NOTE = 'Saves each synced water entry you logged in the last 90 days to Health. Water imported from Health is not saved back.';
const ON_NOTE = 'On. New and edited entries are saved to Health.';

// The "Save water to Apple Health" choice, remembered per account on this device, like useFoodExport. Turning it on asks
// Health for permission to write water only. sync() queues the synced manual entries of the last 90 days not queued at
// their version, and a Health delete for exported entries the server no longer has. Screens call it after loads and logs.
export function useWaterExport() {
  const { session } = useAuth();
  const exp = useHealthExport();
  const key = `health-export-${session?.user.id}-water`;
  const [on, setOn] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const latest = useRef({ on, ready: exp.ready, entries: exp.entries, enqueue: exp.enqueue });
  useEffect(() => { latest.current = { on, ready: exp.ready, entries: exp.entries, enqueue: exp.enqueue }; });
  const running = useRef<Promise<void> | null>(null);
  useEffect(() => {
    let live = true;
    secureStorage.getItem(key).then((v) => live && setOn(v === '1'), () => {});
    return () => { live = false; };
  }, [key]);
  const sync = useCallback(() => {
    running.current ??= (async () => {
      // Before the queue has loaded its saved entries every row would look new.
      if (!latest.current.on || !latest.current.ready) return;
      // Water deleted or settled meanwhile (see settleWaterExport): what was read is stale, so queue nothing from it.
      const gen = waterSyncGeneration();
      const rows = await fetchRecentWaterRows();
      const { entries, enqueue } = latest.current;
      const gone = await deletedWaterIds(rows, entries);
      if (gen !== waterSyncGeneration()) return;
      for (const s of pendingWaterSaves(rows, entries)) await enqueue(WATER_KIND, s.id, 'save', s.payload, s.version);
      for (const id of gone) await enqueue(WATER_KIND, id, 'delete', null, waterDeleteVersion(entries, id)!);
    })().catch(() => {}).finally(() => { running.current = null; }); // a failure retries on the next load
    return running.current;
  }, []);
  useEffect(() => { if (on && exp.ready) void sync(); }, [on, exp.ready, sync]);
  const turnOff = (fromHealth: boolean) => {
    setBusy(true);
    settleWaterExport(exp, fromHealth).then(() => apply(false), (e: Error) => setMessage(e.message)).finally(() => setBusy(false));
  };
  const set = async (next: boolean) => {
    const n = exportedWater(exp.getEntries()).length;
    if (!next && n > 0) {
      return alert('Turn off saving water to Health?', `${n} ${n === 1 ? 'entry was' : 'entries were'} saved to ${healthProviderName()}. Choose whether to remove ${n === 1 ? 'it' : 'them'} from Health. Your water in this app stays either way.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Turn Off and Remove from Health', style: 'destructive', onPress: () => turnOff(true) },
        { text: 'Turn Off, Keep in Health', onPress: () => turnOff(false) },
      ]);
    }
    await apply(next);
  };
  const apply = async (next: boolean) => {
    setMessage(null);
    setBusy(true);
    try {
      if (next) {
        try { await exp.allowWrite(writeTypesFor(WATER_KIND)); } catch { /* the access check below reports it */ }
        if (!writeTypesFor(WATER_KIND).some((t) => getHealthWriteAccess(t) === 'granted')) return setMessage(denied());
      } else {
        await exp.discard(WATER_KIND);
      }
      setOn(next);
      try { await secureStorage.setItem(key, next ? '1' : '0'); } catch { /* applies until the screen closes */ }
    } finally {
      setBusy(false);
    }
  };
  return {
    eligible: isHealthAvailable(), on, message, busy, set, sync,
    // After the server deleted an entry: one this device exported leaves Health too, whatever the clock says.
    deleted: useCallback(async (id: string) => {
      const version = waterDeleteVersion(latest.current.entries, id);
      if (version !== null) await latest.current.enqueue(WATER_KIND, id, 'delete', null, version).catch(() => {});
    }, []),
  };
}

export function WaterExportOption({ choice }: { choice: ReturnType<typeof useWaterExport> }) {
  const c = useTheme();
  const exp = useHealthExport();
  const provider = healthProviderName();
  if (!choice.eligible) return null;
  const failed = exp.entries.filter((e) => e.kind === WATER_KIND && e.status === 'failed');
  const denied = failed.some((e) => e.reason === 'permission');
  const waiting = exp.entries.some((e) => e.kind === WATER_KIND && e.status === 'pending');
  // Entries stay on the phone until they save, so Retry never loses an entry.
  const retry = () => (denied ? exp.allowWrite(writeTypesFor(WATER_KIND)) : exp.retry());
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <Text style={[styles.bodyStrong, { color: c.ink, flex: 1 }]}>{`Save water to ${provider}`}</Text>
        <Switch accessibilityLabel={`Save water to ${provider}`} value={choice.on} disabled={choice.busy} onValueChange={(v) => void choice.set(v)} />
      </View>
      <Text accessibilityLiveRegion="polite" style={[styles.caption, { color: choice.message ? c.danger : c.inkSoft }]}>
        {choice.busy ? `Waiting for ${provider}…` : choice.message ?? (choice.on ? (waiting && !failed.length ? `Saving to ${provider}…` : ON_NOTE) : NOTE)}
      </Text>
      {failed.length > 0 && (
        <View>
          <Text accessibilityLiveRegion="polite" style={[styles.caption, { color: c.danger }]}>
            {denied ? `Not saved to ${provider} yet. Allow saving water in Health, then retry. Your entries are kept here and waiting.` : `Couldn't save to ${provider}. Your entries are kept here.`}
          </Text>
          <Button plain label="Retry Saving to Health" busy={exp.processing} onPress={() => void retry()} />
        </View>
      )}
    </View>
  );
}
