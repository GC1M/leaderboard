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
import { ESTIMATE_NOTE, FDC_ATTRIBUTION } from '@/lib/food/search';
import { localDateKey, startOfLocalDay } from '@/lib/health/dates';
import { dateFromKey } from '@/lib/health/format';
import type { NutrientKey, NutrientTotals } from '@/lib/food/nutrition';
import { useTheme } from '@/theme';

const LABELS: Record<(typeof SUMMARY_KEYS)[number], string> = { energy_kcal: 'Calories', protein_g: 'Protein', carbs_g: 'Carbs', fat_g: 'Fat' };
// A total built from some unknown values is a lower bound, so it says "At least".
const total = (t: NutrientTotals, k: NutrientKey) => `${t.incomplete.includes(k) && t.totals[k] !== null ? 'At least ' : ''}${formatNutrient(k, t.totals[k])}`;
const incomplete = (t: NutrientTotals) => SUMMARY_KEYS.some((k) => t.incomplete.includes(k));
// Mid-sentence, "Unknown" and "At least" start lower case.
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

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
  const [waiting, setWaiting] = useState<{ count: number; error: string | null }>({ count: 0, error: null });
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
    setWaiting(r.waiting);
    void sync();
  }, [uid, date, sync]);
  useFocusEffect(useCallback(() => { setEntries(null); void load(); }, [load]));

  const retry = async () => {
    setRetrying(true);
    await load();
    setRetrying(false);
  };

  const day = entries ? groupDay(entries) : null;
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
      {waiting.count > 0 && (
        <View style={{ gap: 4 }}>
          <Text accessibilityLiveRegion="polite" style={[styles.body, { color: c.danger }]}>
            {`${waiting.count} ${waiting.count === 1 ? 'change is' : 'changes are'} not synced yet. ${waiting.error ?? ''}`.trim()}
          </Text>
          <Button plain label="Retry Sync" busy={retrying} onPress={retry} />
        </View>
      )}
      {!day ? (
        !error && <Skeleton label="Loading food diary" />
      ) : error ? (
        // The day's synced entries are unknown, so no totals: they would leave those entries out and read low.
        // Only the entries saved on this device show. An empty list must not read as "No food logged" either.
        <>
          {day.count > 0 && (
            <Section title="Saved on this iPhone" footer="Day totals show once your food loads.">
              {entries!.map((e, i) => (
                <EntryRow key={e.clientId} entry={e} last={i === entries!.length - 1} onPress={() => router.push({ pathname: '/food/entry/[id]', params: { id: e.id ?? e.clientId } })} />
              ))}
            </Section>
          )}
          <Button plain label="Try Again" busy={retrying} onPress={retry} />
        </>
      ) : day.count === 0 ? (
        <Text style={[styles.body, { color: c.inkSoft }]}>No food logged</Text>
      ) : (
        <>
          <Section title="Day total" footer={incomplete(day) ? 'Some foods have unknown values, so these totals are incomplete and may be low.' : undefined}>
            {SUMMARY_KEYS.map((k, i) => <Row key={k} label={LABELS[k]} value={total(day, k)} wrap last={i === SUMMARY_KEYS.length - 1} />)}
          </Section>
          {day.meals.map((m) => (
            <Section
              key={m.meal}
              title={`${m.label}, ${total(m, 'energy_kcal')}`}
              footer={`Protein ${lower(total(m, 'protein_g'))}, carbs ${lower(total(m, 'carbs_g'))}, fat ${lower(total(m, 'fat_g'))}${incomplete(m) ? '. Incomplete: some values are unknown.' : ''}`}
            >
              {m.entries.map((e, i) => (
                <EntryRow key={e.clientId} entry={e} last={i === m.entries.length - 1} onPress={() => router.push({ pathname: '/food/entry/[id]', params: { id: e.id ?? e.clientId } })} />
              ))}
            </Section>
          ))}
        </>
      )}
      <Button label="Log Food" onPress={() => router.push('/food')} />
      <Button plain label="Recipes and Meals" onPress={() => router.push('/food/recipes')} />
      <Button plain label="History" onPress={() => router.push('/food/history')} />
      <Text style={[styles.caption, { color: c.inkSoft }]}>{ESTIMATE_NOTE}</Text>
      {entries?.some((e) => e.provider === 'usda_fdc') && <Text style={[styles.caption, { color: c.inkSoft }]}>{FDC_ATTRIBUTION}</Text>}
    </Screen>
  );
}
