import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl, Text, View } from 'react-native';

import { describeHealthSync } from '@/components/HealthSyncStatus';
import { Segmented } from '@/components/history/Segmented';
import { DateField, NumberField } from '@/components/inputs';
import { Button, ErrorText, Row, Screen, Section, Skeleton, styles } from '@/components/ui';
import { useWaterExport, WaterExportOption } from '@/components/water/WaterExportOption';
import { useAuth } from '@/lib/auth';
import { localDateKey, startOfLocalDay } from '@/lib/health/dates';
import { dateFromKey } from '@/lib/health/format';
import { useHealthSync } from '@/lib/health/sync';
import { decimalValue } from '@/lib/numeric-input';
import { dayTotal, getWaterTarget, loadWaterDay, logWater, setWaterTarget, sourceLabel, waterQueue, type WaterEntry } from '@/lib/water/entries';
import { amountError, entryMl, formatWater, mlFromUnit, QUICK_ADD, unitFromMl, useWaterUnit, type WaterUnit } from '@/lib/water/units';
import { useTheme } from '@/theme';

const UNITS = [{ value: 'ml', label: 'mL' }, { value: 'floz', label: 'fl oz', a11y: 'fluid ounces' }] as const;
const time = (e: WaterEntry) => new Date(e.consumedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const amountText = (ml: number, unit: WaterUnit) => String(Math.round(unitFromMl(ml, unit) * 10) / 10);

// One day of water. A day with no entries is "No water logged", never 0 mL. A target shows only if the user set one.
export default function Water() {
  const c = useTheme();
  const router = useRouter();
  const uid = useAuth().session?.user.id ?? '';
  const health = useHealthSync();
  const params = useLocalSearchParams<{ date?: string }>();
  const [date, setDate] = useState(() => (params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : localDateKey(new Date())));
  const [unit, setUnit] = useWaterUnit();
  const [entries, setEntries] = useState<WaterEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<{ count: number; error: string | null }>({ count: 0, error: null });
  const [target, setTarget] = useState<number | null>(null);
  const [amount, setAmount] = useState('');
  const [at, setAt] = useState<Date | null>(null); // null: now
  const [formError, setFormError] = useState<string | null>(null);
  const [targetText, setTargetText] = useState<string | null>(null); // non-null while editing the target
  const [targetError, setTargetError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const choice = useWaterExport();
  const { sync } = choice;
  const load = useCallback(async () => {
    await waterQueue.flushPending(uid).catch(() => 0);
    const r = await loadWaterDay(uid, date);
    setEntries(r.entries);
    setError(r.error);
    setWaiting(r.waiting);
    getWaterTarget().then(setTarget, () => {});
    void sync();
  }, [uid, date, sync]);
  useFocusEffect(useCallback(() => { setEntries(null); void load(); }, [load]));

  const isToday = date === localDateKey(new Date());
  const shift = (days: number) => { setAt(null); setDate(localDateKey(startOfLocalDay(dateFromKey(date), -days))); };
  // Another day's entries default to the same clock time on that day.
  const when = () => {
    if (at) return at;
    const now = new Date();
    if (isToday) return now;
    const d = dateFromKey(date);
    d.setHours(now.getHours(), now.getMinutes(), 0, 0);
    return d;
  };

  const log = async (ml: number | null) => {
    if (busy) return;
    if (ml === null) return setFormError(amountError(unit));
    setBusy(true);
    setFormError(null);
    try {
      await logWater(ml, when());
      setAmount('');
      setAt(null);
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Couldn't log water. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const customMl = () => { const v = decimalValue(amount); return v === null ? null : entryMl(v, unit); };

  const saveTarget = async (ml: number | null) => {
    setTargetError(null);
    try {
      await setWaterTarget(uid, ml);
      setTarget(ml);
      setTargetText(null);
    } catch (e) {
      setTargetError(e instanceof Error ? e.message : "Couldn't save your target. Try again.");
    }
  };

  const total = entries && !error ? dayTotal(entries) : null;
  const m = health.metrics.water;

  return (
    <Screen
      title="Water"
      back
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await health.sync(); await load(); setRefreshing(false); }} />}
    >
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
        <Button plain label="Previous Day" onPress={() => shift(-1)} />
        <Button plain label="Next Day" disabled={isToday} onPress={() => shift(1)} />
        {!isToday && <Button plain label="Today" onPress={() => { setAt(null); setDate(localDateKey(new Date())); }} />}
      </View>
      <DateField label="Day" mode="date" value={dateFromKey(date)} onChange={(d) => { setAt(null); setDate(localDateKey(d)); }} />
      <ErrorText>{error}</ErrorText>
      {waiting.count > 0 && (
        <View style={{ gap: 4 }}>
          <Text accessibilityLiveRegion="polite" style={[styles.body, { color: c.danger }]}>
            {`${waiting.count} ${waiting.count === 1 ? 'change is' : 'changes are'} not synced yet. ${waiting.error ?? ''}`.trim()}
          </Text>
          <Button plain label="Retry Sync" busy={refreshing} onPress={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />
        </View>
      )}
      {!entries ? (
        !error && <Skeleton label="Loading water" rows={2} />
      ) : (
        <>
          {error && <Button plain label="Try Again" onPress={() => void load()} />}
          {/* With a load error only the entries saved on this iPhone are known, so no total: it would read low. */}
          {!error && (
            <View accessible accessibilityLabel={total === null ? 'No water logged' : `${isToday ? 'Today' : 'Day total'}, ${formatWater(total, unit)}${target ? ` of ${formatWater(target, unit)} target` : ''}`} style={{ gap: 8 }}>
              <Text maxFontSizeMultiplier={1.5} style={[styles.heading, { color: total === null ? c.inkSoft : c.ink }]}>
                {total === null ? `No water logged${isToday ? ' today' : ''}` : formatWater(total, unit)}
              </Text>
              {target !== null && (
                <>
                  <Text style={[styles.caption, { color: c.inkSoft }]}>{`Your target: ${formatWater(target, unit)}${total !== null ? `, ${Math.round((total / target) * 100)}%` : ''}`}</Text>
                  <View style={{ height: 4, borderRadius: 999, backgroundColor: c.lane }}>
                    <View style={{ height: 4, borderRadius: 999, width: `${Math.min(1, (total ?? 0) / target) * 100}%`, backgroundColor: c.accent }} />
                  </View>
                </>
              )}
            </View>
          )}
          {entries.length > 0 && (
            <Section title={error ? 'Saved on this iPhone' : 'Entries'} footer={entries.some((e) => e.source !== 'manual') ? 'Water from other apps can be changed in the Health app.' : undefined}>
              {entries.map((e, i) => (
                <Row
                  key={e.id ?? e.clientId}
                  wrap
                  label={formatWater(e.ml, unit)}
                  value={[time(e), sourceLabel(e), e.pending && 'Not synced'].filter(Boolean).join(' · ')}
                  last={i === entries.length - 1}
                  onPress={() => router.push({ pathname: '/water/entry/[id]', params: { id: (e.id ?? e.clientId)!, date } })}
                />
              ))}
            </Section>
          )}
        </>
      )}

      <Text accessibilityRole="header" style={[styles.heading, { color: c.ink }]}>Add water</Text>
      <Segmented label="Water unit" options={UNITS} value={unit} onChange={(u) => { setUnit(u); setAmount(''); setFormError(null); }} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {QUICK_ADD[unit].map((v) => {
          const label = formatWater(entryMl(v, unit)!, unit);
          return <View key={v} style={{ flexGrow: 1 }}><Button secondary label={`Add ${label}`} disabled={busy} onPress={() => void log(entryMl(v, unit))} /></View>;
        })}
      </View>
      <NumberField label={`Amount (${unit === 'ml' ? 'mL' : 'fl oz'})`} value={amount} onChangeText={(v) => { setAmount(v); setFormError(null); }} error={formError} />
      <DateField label="When" value={when()} onChange={setAt} />
      <Button label="Log Water" busy={busy} disabled={!amount.trim()} onPress={() => void log(customMl())} />

      <Section title="Daily target" footer="Optional. Set your own target if you have one. The app does not suggest an amount.">
        {targetText === null ? (
          <Row label={target === null ? 'Set a Target' : 'Target'} value={target === null ? undefined : formatWater(target, unit)} last onPress={() => setTargetText(target === null ? '' : amountText(target, unit))} />
        ) : (
          <View style={{ padding: 16, gap: 12 }}>
            <NumberField label={`Daily target (${unit === 'ml' ? 'mL' : 'fl oz'})`} value={targetText} onChangeText={setTargetText} error={targetError} />
            <Button label="Save Target" disabled={decimalValue(targetText) === null} onPress={() => { const v = decimalValue(targetText); if (v !== null) void saveTarget(Math.round(mlFromUnit(v, unit) * 10) / 10); }} />
            {target !== null && <Button plain danger label="Clear Target" onPress={() => void saveTarget(null)} />}
            <Button plain label="Cancel" onPress={() => { setTargetText(null); setTargetError(null); }} />
          </View>
        )}
      </Section>

      <WaterExportOption choice={choice} />
      {health.connected && m && (
        <View accessibilityLiveRegion="polite">
          <Text style={[styles.caption, { color: m.status === 'error' ? c.danger : c.inkSoft }]}>{`Apple Health: ${describeHealthSync(m)}`}</Text>
          {m.lastSuccess && <Text style={[styles.caption, { color: c.inkSoft }]}>{`Last completed import: ${new Date(m.lastSuccess).toLocaleString()}`}</Text>}
        </View>
      )}
      <Button plain label="History" onPress={() => router.push('/water/history')} />
      <Text style={[styles.caption, { color: c.inkSoft }]}>Only you can see your water. Group sharing of daily totals is controlled in Group Info.</Text>
    </Screen>
  );
}
