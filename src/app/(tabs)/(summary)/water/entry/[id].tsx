import { useLocalSearchParams, useRouter } from 'expo-router';
import { healthProviderName } from '@/lib/health-adapter/capabilities';
import { useEffect, useState } from 'react';
import { Platform, Text, View } from 'react-native';

import { DateField, NumberField } from '@/components/inputs';
import { Button, ErrorText, Row, Screen, Section, Skeleton, styles } from '@/components/ui';
import { useWaterExport } from '@/components/water/WaterExportOption';
import { alert } from '@/lib/alert';
import { useAuth } from '@/lib/auth';
import { decimalValue } from '@/lib/numeric-input';
import { discardPendingWater, loadWaterDay, removeWater, saveWaterEdit, sourceLabel, type WaterEntry } from '@/lib/water/entries';
import { amountError, entryMl, formatWater, unitFromMl, useWaterUnit } from '@/lib/water/units';
import { useTheme } from '@/theme';

// One water entry. Entries added here can be edited or deleted; imported ones are read-only.
export default function WaterEntryDetail() {
  const c = useTheme();
  const router = useRouter();
  const uid = useAuth().session?.user.id ?? '';
  const choice = useWaterExport();
  const [unit] = useWaterUnit();
  const { id, date } = useLocalSearchParams<{ id: string; date: string }>();
  const [entry, setEntry] = useState<WaterEntry | null | undefined>();
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  const [amount, setAmount] = useState('');
  const [at, setAt] = useState(() => new Date());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    loadWaterDay(uid, date).then((r) => {
      if (!live) return;
      const e = r.entries.find((x) => x.id === id || x.clientId === id) ?? null;
      // Not found because the day failed to load is an error, not a deleted entry.
      if (!e && r.error) return setLoadError(r.error);
      setEntry(e);
      if (e) { setAmount(String(Math.round(unitFromMl(e.ml, unit) * 10) / 10)); setAt(new Date(e.consumedAt)); }
      setLoadError(null);
    }, () => live && setLoadError("Couldn't load that entry. Try again."));
    return () => { live = false; };
    // The amount text is set once per load, in the unit shown then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, id, date, tries]);

  if (loadError || entry === null) {
    return (
      <Screen title="Water" back>
        <ErrorText>{loadError ?? 'That entry is no longer available.'}</ErrorText>
        {loadError && <Button plain label="Try Again" onPress={() => { setLoadError(null); setTries((t) => t + 1); }} />}
      </Screen>
    );
  }
  if (!entry) return <Screen title="Water" back><Skeleton label="Loading entry" rows={2} /></Screen>;

  const details = (
    <Section title="Details">
      <Row label="Amount" value={formatWater(entry.ml, unit)} wrap />
      <Row label="When" value={`${new Date(entry.consumedAt).toLocaleString()} (${entry.timezone})`} wrap />
      <Row label="Source" value={sourceLabel(entry)} wrap last />
    </Section>
  );
  if (entry.source !== 'manual') {
    return (
      <Screen title="Water" back>
        {details}
        <Text style={[styles.body, { color: c.inkSoft }]}>{`This water came from ${healthProviderName()}. To change or delete it, use ${Platform.OS === 'android' ? 'Health Connect' : 'the Health app'} or the app that recorded it.`}</Text>
      </Screen>
    );
  }

  const save = async () => {
    const v = decimalValue(amount);
    const ml = v === null ? null : entryMl(v, unit);
    // An unchanged amount keeps the stored mL, so a round trip through fl oz does not drift. Compared as numbers, so
    // "8.50" matches "8.5", and before validation, so a tiny stored amount that shows as 0 can still be re-saved.
    const same = v !== null && v === Math.round(unitFromMl(entry.ml, unit) * 10) / 10;
    if (!same && ml === null) return setError(amountError(unit));
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await saveWaterEdit(uid, entry, { ml: same ? undefined : ml!, consumedAt: at });
      void choice.sync();
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that entry. Try again.");
      setBusy(false);
    }
  };
  const remove = () =>
    alert('Delete this entry?', `${formatWater(entry.ml, unit)} is removed from your water for good.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          if (busy) return;
          setBusy(true);
          try {
            await removeWater(uid, entry, choice.deleted);
            router.back();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Couldn't delete that entry. Try again.");
            setBusy(false);
          }
        },
      },
    ]);

  return (
    <Screen title="Edit Water" back>
      {entry.pending && (
        <View style={{ gap: 4 }}>
          <Text accessibilityLiveRegion="polite" style={[styles.body, { color: c.danger }]}>{`Not synced. ${entry.syncError ?? 'Open Water to retry.'}`}</Text>
          {entry.pending === 'edit' && (
            <Button plain danger label="Discard Unsynced Edit" onPress={async () => { await discardPendingWater(uid, entry); setTries((t) => t + 1); }} />
          )}
        </View>
      )}
      {details}
      <NumberField label={`Amount (${unit === 'ml' ? 'mL' : 'fl oz'})`} value={amount} onChangeText={(v) => { setAmount(v); setError(null); }} />
      <DateField label="When" value={at} onChange={setAt} />
      <ErrorText>{error}</ErrorText>
      <Button label="Save Changes" busy={busy} disabled={!amount.trim()} onPress={() => void save()} />
      <Button plain danger label="Delete Entry" disabled={busy} onPress={remove} />
    </Screen>
  );
}
