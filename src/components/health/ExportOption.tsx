import { useEffect, useState } from 'react';
import { Platform, Switch, Text, View } from 'react-native';

import { Button, styles } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { healthProviderName } from '@/lib/health-adapter/capabilities';
import { writeTypesFor } from '@/lib/health/export-queue';
import { getHealthWriteAccess, isHealthAvailable } from '@/lib/health/healthkit';
import { MANUAL_KINDS, type ManualType } from '@/lib/health/manual-export';
import { useHealthExport } from '@/lib/health/sync';
import { secureStorage } from '@/lib/secure-storage';
import { useTheme } from '@/theme';

const denied = () => Platform.OS === 'android' ? 'Health Connect did not allow saving this. Allow it in Health Connect, App permissions, Leaderboard, then try again.' : 'Health did not allow saving this. Turn it on in Settings, Health, Data Access & Devices, then try again.';
const writable = (type: ManualType) => writeTypesFor(MANUAL_KINDS[type]).some((t) => getHealthWriteAccess(t) === 'granted');

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
        try { await allowWrite(writeTypesFor(MANUAL_KINDS[type])); } catch { /* the access check below reports it */ }
        if (!writable(type)) return setMessage(denied());
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
  const provider = healthProviderName();
  // No writer for this type on this platform (steps on Health Connect): say so instead of offering a switch that cannot work.
  if (!writeTypesFor(MANUAL_KINDS[type]).length) return <Text style={[styles.caption, { color: c.inkSoft }]}>{`Saving ${type} to ${provider} isn't supported yet. Your entries stay in this app.`}</Text>;
  const failed = exp.entries.filter((e) => e.kind === MANUAL_KINDS[type] && e.status === 'failed');
  const denied = failed.some((e) => e.reason === 'permission');
  // Entries stay on the phone until they save, so Retry never loses an entry.
  const retry = () => (denied ? exp.allowWrite(writeTypesFor(MANUAL_KINDS[type])) : exp.retry());
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <Text style={[styles.bodyStrong, { color: c.ink, flex: 1 }]}>Also save to {provider}</Text>
        <Switch accessibilityLabel={`Also save to ${provider}`} value={choice.on} disabled={choice.busy} onValueChange={(v) => void choice.set(v)} />
      </View>
      {choice.busy && <Text accessibilityLiveRegion="polite" style={[styles.caption, { color: c.inkSoft }]}>Waiting for {provider}…</Text>}
      {(choice.message || note) && <Text style={[styles.caption, { color: choice.message ? c.danger : c.inkSoft }]}>{choice.message ?? note}</Text>}
      {failed.length > 0 && (
        <View>
          <Text accessibilityLiveRegion="polite" style={[styles.caption, { color: c.danger }]}>
            {denied ? `Not saved to ${provider} yet. Allow saving in Health, then retry. Your entry is kept here.` : `Couldn't save to ${provider}. Your entry is kept here.`}
          </Text>
          <Button plain label="Retry Saving to Health" busy={exp.processing} onPress={() => void retry()} />
        </View>
      )}
    </View>
  );
}
