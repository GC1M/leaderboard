import { useEffect, useState } from 'react';
import { Switch, Text, View } from 'react-native';

import { Button, styles } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { getHealthWriteAccess, HEALTH_TYPES, isHealthAvailable } from '@/lib/health/healthkit';
import { MANUAL_KINDS, type ManualType } from '@/lib/health/manual-export';
import { useHealthExport } from '@/lib/health/sync';
import { secureStorage } from '@/lib/secure-storage';
import { useTheme } from '@/theme';

const DENIED = 'Health did not allow saving this. Turn it on in Settings, Health, Data Access & Devices, then try again.';

// The per-type "Also save to Apple Health" choice, remembered per account on this device. Turning it on is what
// asks Health for write access, and only for this type.
export function useExportChoice(type: ManualType) {
  const { session } = useAuth();
  const { allowWrite, discard } = useHealthExport();
  const key = `health-export-${session?.user.id}-${type}`;
  const [on, setOn] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    secureStorage.getItem(key).then((v) => live && setOn(v === '1'), () => {});
    return () => { live = false; };
  }, [key]);
  const set = async (next: boolean) => {
    setMessage(null);
    setBusy(true);
    try {
      if (next) {
        try { await allowWrite([HEALTH_TYPES[type]]); } catch { /* the access check below reports it */ }
        if (getHealthWriteAccess(HEALTH_TYPES[type]) !== 'granted') return setMessage(DENIED);
      } else {
        await discard(MANUAL_KINDS[type]);
      }
      setOn(next);
      try { await secureStorage.setItem(key, next ? '1' : '0'); } catch { /* applies until the screen closes */ }
    } finally {
      setBusy(false);
    }
  };
  return { on, message, busy, set };
}

export function ExportOption({ type, choice, note }: { type: ManualType; choice: ReturnType<typeof useExportChoice>; note?: string }) {
  const c = useTheme();
  const exp = useHealthExport();
  if (!isHealthAvailable()) return null;
  const failed = exp.entries.filter((e) => e.kind === MANUAL_KINDS[type] && e.status === 'failed');
  const denied = failed.some((e) => e.reason === 'permission');
  // Entries stay on the phone until they save, so Retry never loses an entry.
  const retry = () => (denied ? exp.allowWrite([HEALTH_TYPES[type]]) : exp.retry());
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <Text style={[styles.bodyStrong, { color: c.ink, flex: 1 }]}>Also save to Apple Health</Text>
        <Switch accessibilityLabel="Also save to Apple Health" value={choice.on} disabled={choice.busy} onValueChange={(v) => void choice.set(v)} />
      </View>
      {choice.busy && <Text accessibilityLiveRegion="polite" style={[styles.caption, { color: c.inkSoft }]}>Waiting for Apple Health…</Text>}
      {(choice.message || note) && <Text style={[styles.caption, { color: choice.message ? c.danger : c.inkSoft }]}>{choice.message ?? note}</Text>}
      {failed.length > 0 && (
        <View>
          <Text accessibilityLiveRegion="polite" style={[styles.caption, { color: c.danger }]}>
            {denied ? 'Not saved to Apple Health yet. Allow saving in Health, then retry. Your entry is kept here.' : "Couldn't save to Apple Health. Your entry is kept here."}
          </Text>
          <Button plain label="Retry Saving to Health" busy={exp.processing} onPress={() => void retry()} />
        </View>
      )}
    </View>
  );
}
