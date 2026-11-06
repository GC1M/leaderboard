import { useEffect, useState } from 'react';
import { Switch, Text, View } from 'react-native';

import { Button, styles } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import type { Entry } from '@/lib/food/diary';
import { canExportFood, FOOD_KIND, FOOD_WRITE_TYPES, foodPayload } from '@/lib/health/food-export';
import { getHealthWriteAccess, isHealthAvailable } from '@/lib/health/healthkit';
import { useHealthExport } from '@/lib/health/sync';
import { secureStorage } from '@/lib/secure-storage';
import { useTheme } from '@/theme';

const DENIED = 'Health did not allow saving any nutrition. Turn it on in Settings, Health, Data Access & Devices, then try again.';
const NOTE = 'Saves each synced entry to Health as a food with the nutrients we know, for the amount you ate. Ingredients, recipes and photos stay in this app. Health only shows the nutrients you allow.';

// The "Save food to Apple Health" choice, remembered per account on this device. Turning it on asks Health for
// permission to write each nutrient type (the sheet lets the user allow any of them), and nothing else.
// Pass the entries on screen: each synced one is exported, and an edit (a new row version) replaces it.
export function useFoodExport(entries?: readonly Entry[] | null) {
  const { session } = useAuth();
  const exp = useHealthExport();
  const key = `health-export-${session?.user.id}-food`;
  const [on, setOn] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    secureStorage.getItem(key).then((v) => live && setOn(v === '1'), () => {});
    return () => { live = false; };
  }, [key]);
  const send = (id: string, op: 'save' | 'delete', payload: unknown, version?: number) => exp.enqueue(FOOD_KIND, id, op, payload, version).catch(() => {});
  useEffect(() => {
    if (!on || !entries) return;
    for (const e of entries) {
      // The row's updated_at is the export version, so the same row never re-exports and an edit always does.
      const version = e.updatedAt ? Date.parse(e.updatedAt) : NaN;
      if (e.id && canExportFood(e) && Number.isFinite(version) && !exp.entries.some((x) => x.kind === FOOD_KIND && x.recordId === e.id && x.op === 'save' && x.version >= version)) {
        void send(e.id, 'save', foodPayload(e), version);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, entries]);
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
    eligible: isHealthAvailable(), on, message, busy, set,
    // After a diary delete: an entry this device exported leaves Health too.
    deleted: (id: string) => (exp.entries.some((e) => e.kind === FOOD_KIND && e.recordId === id && e.op === 'save') ? send(id, 'delete', null) : undefined),
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
      <Text accessibilityLiveRegion="polite" style={[styles.caption, { color: choice.message ? c.danger : c.inkSoft }]}>{choice.busy ? 'Waiting for Apple Health…' : choice.message ?? NOTE}</Text>
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
