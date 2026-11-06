import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl, Text, View } from 'react-native';

import { EntryRow } from '@/components/food/EntryRow';
import { FoodExportOption, useFoodExport } from '@/components/food/FoodExportOption';
import { DateField } from '@/components/inputs';
import { Button, ErrorText, Row, Screen, Section, Skeleton, styles } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { groupDay, type Entry, loadDay, SUMMARY_KEYS } from '@/lib/food/diary';
import { formatNutrient } from '@/lib/food/format';
import { flushPending, takeNotices } from '@/lib/food/pending';
import { ESTIMATE_NOTE } from '@/lib/food/search';
import { localDateKey, startOfLocalDay } from '@/lib/health/dates';
import { dateFromKey } from '@/lib/health/format';
import type { NutrientKey, NutrientTotals } from '@/lib/food/nutrition';
import { useTheme } from '@/theme';

const LABELS: Record<(typeof SUMMARY_KEYS)[number], string> = { energy_kcal: 'Calories', protein_g: 'Protein', carbs_g: 'Carbs', fat_g: 'Fat' };
// A total built from some unknown values is a lower bound, so it says "At least".
const total = (t: NutrientTotals, k: NutrientKey) => `${t.incomplete.includes(k) && t.totals[k] !== null ? 'At least ' : ''}${formatNutrient(k, t.totals[k])}`;
const incomplete = (t: NutrientTotals) => SUMMARY_KEYS.some((k) => t.incomplete.includes(k));

// One day of food by meal, with totals. A day with no entries is "No food logged", never 0 kcal.
export default function Diary() {
  const c = useTheme();
  const router = useRouter();
  const { session } = useAuth();
  const uid = session?.user.id ?? '';
  const params = useLocalSearchParams<{ date?: string }>();
  const [date, setDate] = useState(() => (params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : localDateKey(new Date())));
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const foodExport = useFoodExport();
  const { sync } = foodExport;
  const load = useCallback(async () => {
    // Retry anything waiting to sync first, so the day shows what the server now has.
    await flushPending(uid);
    const dropped = takeNotices(uid);
    if (dropped.length) setNotice(dropped.join(' '));
    const r = await loadDay(uid, date);
    setEntries(r.entries);
    setError(r.error);
    void sync();
  }, [uid, date, sync]);
  useFocusEffect(useCallback(() => { setEntries(null); void load(); }, [load]));

  const retry = async () => {
    setRetrying(true);
    await load();
    setRetrying(false);
  };

  const day = entries ? groupDay(entries) : null;
  const waiting = entries?.filter((e) => e.pending) ?? [];
  const shift = (days: number) => setDate(localDateKey(startOfLocalDay(dateFromKey(date), -days)));
  const isToday = date === localDateKey(new Date());

  return (
    <Screen
      title="Food Diary"
      back
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
    >
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
        <Button plain label="Previous Day" onPress={() => shift(-1)} />
        <Button plain label="Next Day" disabled={isToday} onPress={() => shift(1)} />
        {!isToday && <Button plain label="Today" onPress={() => setDate(localDateKey(new Date()))} />}
      </View>
      <DateField label="Day" mode="date" value={dateFromKey(date)} onChange={(d) => setDate(localDateKey(d))} />
      <FoodExportOption choice={foodExport} />
      <ErrorText>{error}</ErrorText>
      {notice && <Text accessibilityLiveRegion="polite" style={[styles.caption, { color: c.inkSoft }]}>{notice}</Text>}
      {waiting.length > 0 && (
        <View style={{ gap: 4 }}>
          <Text accessibilityLiveRegion="polite" style={[styles.body, { color: c.danger }]}>
            {`${waiting.length} ${waiting.length === 1 ? 'change is' : 'changes are'} not synced yet. ${waiting.find((e) => e.syncError)?.syncError ?? ''}`.trim()}
          </Text>
          <Button plain label="Retry Sync" busy={retrying} onPress={retry} />
        </View>
      )}
      {!day ? (
        !error && <Skeleton label="Loading food diary" />
      ) : day.count === 0 ? (
        // If the load failed, an empty list says nothing about the day, so it must not read as "No food logged".
        error ? <Button plain label="Try Again" busy={retrying} onPress={retry} /> : <Text style={[styles.body, { color: c.inkSoft }]}>No food logged</Text>
      ) : (
        <>
          <Section title="Day total" footer={incomplete(day) ? 'Some foods have unknown values, so these totals are incomplete and may be low.' : undefined}>
            {SUMMARY_KEYS.map((k, i) => <Row key={k} label={LABELS[k]} value={total(day, k)} wrap last={i === SUMMARY_KEYS.length - 1} />)}
          </Section>
          {day.meals.map((m) => (
            <Section
              key={m.meal}
              title={`${m.label}, ${total(m, 'energy_kcal')}`}
              footer={`Protein ${total(m, 'protein_g')}, carbs ${total(m, 'carbs_g')}, fat ${total(m, 'fat_g')}${incomplete(m) ? '. Incomplete: some values are unknown.' : ''}`}
            >
              {m.entries.map((e, i) => (
                <EntryRow key={e.clientId} entry={e} last={i === m.entries.length - 1} onPress={() => router.push({ pathname: '/food/entry/[id]', params: { id: e.id ?? e.clientId } })} />
              ))}
            </Section>
          ))}
        </>
      )}
      <Button label="Log Food" onPress={() => router.push('/food')} />
      <Button plain label="History" onPress={() => router.push('/food/history')} />
      <Text style={[styles.caption, { color: c.inkSoft }]}>{ESTIMATE_NOTE}</Text>
    </Screen>
  );
}
