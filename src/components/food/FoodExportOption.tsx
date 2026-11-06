import { useCallback, useEffect, useRef, useState } from 'react';
import { Switch, Text, View } from 'react-native';

import { Button, styles } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { allowedFoodMask, deletedFoodIds, fetchRecentFoodRows, FOOD_KIND, FOOD_WRITE_TYPES, foodDeleteVersion, pendingFoodSaves } from '@/lib/health/food-export';
import { getHealthWriteAccess, isHealthAvailable } from '@/lib/health/healthkit';
import { useHealthExport } from '@/lib/health/sync';
import { secureStorage } from '@/lib/secure-storage';
import { useTheme } from '@/theme';

const DENIED = 'Health did not allow saving any nutrition. Turn it on in Settings, Health, Data Access & Devices, then try again.';
const NOTE = 'Saves each synced entry from the last 90 days to Health as a food, with its name and the nutrients we know for the amount you ate. Ingredients, recipes and photos stay in this app. Health only shows the nutrients you allow.';
const ON_NOTE = 'On. New and edited entries are saved to Health.';

// The "Save food to Apple Health" choice, remembered per account on this device. Turning it on asks Health for
// permission to write each nutrient type (the sheet lets the user allow any of them), and nothing else.
// sync() waits for the export queue to load, then queues the synced entries of the last 90 days that are not queued at
// their version, and queues a Health delete for exported entries the server no longer has. It runs when the switch
// turns on, and screens call it after the diary loads or a food is logged.
export function useFoodExport() {
  const { session } = useAuth();
  const exp = useHealthExport();
  const key = `health-export-${session?.user.id}-food`;
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
      // Before the queue has loaded its saved entries every row would look new and reset each entry's attempt version.
      if (!latest.current.on || !latest.current.ready) return;
      const rows = await fetchRecentFoodRows();
      const { entries, enqueue } = latest.current;
      for (const s of pendingFoodSaves(rows, entries, allowedFoodMask())) await enqueue(FOOD_KIND, s.id, 'save', s.payload, s.version);
      for (const id of await deletedFoodIds(rows, entries)) await enqueue(FOOD_KIND, id, 'delete', null, foodDeleteVersion(entries, id)!);
    })().catch(() => {}).finally(() => { running.current = null; }); // a failure retries on the next diary load
    return running.current;
  }, []);
  useEffect(() => { if (on && exp.ready) void sync(); }, [on, exp.ready, sync]);
  const set = async (next: boolean) => {
    setMessage(null);
    setBusy(true);
    try {
      if (next) {
        try { await exp.allowWrite(FOOD_WRITE_TYPES); } catch { /* the access check below reports it */ }
        if (!FOOD_WRITE_TYPES.some((t) => getHealthWriteAccess(t) === 'granted')) return setMessage(DENIED);
      } else {
        await exp.discard(FOOD_KIND);
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
      const version = foodDeleteVersion(latest.current.entries, id);
      if (version !== null) await latest.current.enqueue(FOOD_KIND, id, 'delete', null, version).catch(() => {});
    }, []),
  };
}

export function FoodExportOption({ choice }: { choice: ReturnType<typeof useFoodExport> }) {
  const c = useTheme();
  const exp = useHealthExport();
  if (!choice.eligible) return null;
  const failed = exp.entries.filter((e) => e.kind === FOOD_KIND && e.status === 'failed');
  const denied = failed.some((e) => e.reason === 'permission');
  // Entries stay on the phone until they save, so Retry never loses an entry.
  const retry = () => (denied ? exp.allowWrite(FOOD_WRITE_TYPES) : exp.retry());
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <Text style={[styles.bodyStrong, { color: c.ink, flex: 1 }]}>Save food to Apple Health</Text>
        <Switch accessibilityLabel="Save food to Apple Health" value={choice.on} disabled={choice.busy} onValueChange={(v) => void choice.set(v)} />
      </View>
      <Text accessibilityLiveRegion="polite" style={[styles.caption, { color: choice.message ? c.danger : c.inkSoft }]}>{choice.busy ? 'Waiting for Apple Health…' : choice.message ?? (choice.on ? ON_NOTE : NOTE)}</Text>
      {failed.length > 0 && (
        <View>
          <Text accessibilityLiveRegion="polite" style={[styles.caption, { color: c.danger }]}>
            {denied ? 'Not saved to Apple Health yet. Allow saving nutrition in Health, then retry. Your entries are kept here.' : "Couldn't save to Apple Health. Your entries are kept here."}
          </Text>
          <Button plain label="Retry Saving to Health" busy={exp.processing} onPress={() => void retry()} />
        </View>
      )}
    </View>
  );
}
