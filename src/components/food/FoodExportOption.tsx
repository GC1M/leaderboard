import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Switch, Text, View } from 'react-native';

import { Button, styles } from '@/components/ui';
import { alert } from '@/lib/alert';
import { useAuth } from '@/lib/auth';
import { healthProviderName } from '@/lib/health-adapter/capabilities';
import { writeTypesFor } from '@/lib/health/export-queue';
import { allowedFoodMask, bumpFoodSyncGeneration, deletedFoodIds, fetchRecentFoodRows, FOOD_KIND, exportedFood, foodSyncGeneration, pendingFoodSaves, removeFoodExport, settleFoodExport } from '@/lib/health/food-export';
import { getHealthWriteAccess, isHealthAvailable } from '@/lib/health/healthkit';
import { useHealthExport } from '@/lib/health/sync';
import { secureStorage } from '@/lib/secure-storage';
import { useTheme } from '@/theme';

const denied = () => Platform.OS === 'android' ? 'Health Connect did not allow saving this. Allow it in Health Connect, App permissions, Leaderboard, then try again.' : 'Health did not allow saving any nutrition. Turn it on in Settings, Health, Data Access & Devices, then try again.';
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
  const fresh = () => ({ on, ready: exp.ready, entries: exp.entries, getEntries: exp.getEntries, enqueue: exp.enqueue, forget: exp.forget });
  const latest = useRef(fresh());
  useEffect(() => { latest.current = fresh(); });
  const running = useRef<Promise<void> | null>(null);
  // Set from the moment the user turns the option off until it is on again: `on` only changes after the discard.
  const stopping = useRef(false);
  useEffect(() => {
    let live = true;
    secureStorage.getItem(key).then((v) => live && setOn(v === '1'), () => {});
    return () => { live = false; };
  }, [key]);
  const sync = useCallback(() => {
    running.current ??= (async () => {
      // Before the queue has loaded its saved entries every row would look new and reset each entry's attempt version.
      if (stopping.current || !latest.current.on || !latest.current.ready) return;
      // Food deleted or settled meanwhile (see settleFoodExport): what was read is stale, so queue nothing from it.
      const gen = foodSyncGeneration();
      const rows = await fetchRecentFoodRows();
      const { entries, enqueue } = latest.current;
      const gone = await deletedFoodIds(rows, entries);
      // Checked before and after every enqueue: each one waits for its Health write, and a settle, history deletion
      // or switch-off can start during that wait. A save queued after one started is taken back out of Health.
      const stale = () => stopping.current || gen !== foodSyncGeneration();
      for (const s of pendingFoodSaves(rows, entries, allowedFoodMask())) {
        if (stale()) return;
        await enqueue(FOOD_KIND, s.id, 'save', s.payload, s.version);
        if (stale()) return void (await removeFoodExport(latest.current, s.id));
      }
      for (const id of gone) { if (stale()) return; await removeFoodExport(latest.current, id); }
    })().catch(() => {}).finally(() => { running.current = null; }); // a failure retries on the next diary load
    return running.current;
  }, []);
  useEffect(() => { if (on && exp.ready) void sync(); }, [on, exp.ready, sync]);
  // Turning the switch off with food already in Health: the user chooses whether it stays (see settleFoodExport).
  const turnOff = (fromHealth: boolean) => {
    setBusy(true);
    stopping.current = true;
    settleFoodExport(exp, fromHealth).then(() => apply(false), (e: Error) => { stopping.current = false; setMessage(e.message); }).finally(() => setBusy(false));
  };
  const set = async (next: boolean) => {
    const n = exportedFood(exp.getEntries()).length;
    if (!next && n > 0) {
      return alert('Turn off saving food to Health?', `${n} ${n === 1 ? 'entry was' : 'entries were'} saved to ${healthProviderName()}. Choose whether to remove ${n === 1 ? 'it' : 'them'} from Health. Your food in this app stays either way.`, [
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
        stopping.current = false;
        try { await exp.allowWrite(writeTypesFor(FOOD_KIND)); } catch { /* the access check below reports it */ }
        if (!writeTypesFor(FOOD_KIND).some((t) => getHealthWriteAccess(t) === 'granted')) return setMessage(denied());
      } else {
        stopping.current = true;
        bumpFoodSyncGeneration(); // a sync in flight stops queuing saves
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
      await removeFoodExport(latest.current, id).catch(() => {});
    }, []),
  };
}

export function FoodExportOption({ choice }: { choice: ReturnType<typeof useFoodExport> }) {
  const c = useTheme();
  const exp = useHealthExport();
  if (!choice.eligible) return null;
  const provider = healthProviderName();
  const failed = exp.entries.filter((e) => e.kind === FOOD_KIND && e.status === 'failed');
  const denied = failed.some((e) => e.reason === 'permission');
  // Entries stay on the phone until they save, so Retry never loses an entry.
  const retry = () => (denied ? exp.allowWrite(writeTypesFor(FOOD_KIND)) : exp.retry());
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <Text style={[styles.bodyStrong, { color: c.ink, flex: 1 }]}>Save food to {provider}</Text>
        <Switch accessibilityLabel={`Save food to ${provider}`} value={choice.on} disabled={choice.busy} onValueChange={(v) => void choice.set(v)} />
      </View>
      <Text accessibilityLiveRegion="polite" style={[styles.caption, { color: choice.message ? c.danger : c.inkSoft }]}>{choice.busy ? `Waiting for ${provider}…` : choice.message ?? (choice.on ? ON_NOTE : NOTE)}</Text>
      {failed.length > 0 && (
        <View>
          <Text accessibilityLiveRegion="polite" style={[styles.caption, { color: c.danger }]}>
            {denied ? `Not saved to ${provider} yet. Allow saving nutrition in Health, then retry. Your entries are kept here.` : `Couldn't save to ${provider}. Your entries are kept here.`}
          </Text>
          <Button plain label="Retry Saving to Health" busy={exp.processing} onPress={() => void retry()} />
        </View>
      )}
    </View>
  );
}
