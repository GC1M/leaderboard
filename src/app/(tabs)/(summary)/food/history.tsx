import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Text } from 'react-native';

import { BarHistory } from '@/components/history/BarHistory';
import { Segmented } from '@/components/history/Segmented';
import { Screen, styles } from '@/components/ui';
import { getDailyTotals, hasFoodEntries, historyDays, SUMMARY_KEYS } from '@/lib/food/diary';
import { ESTIMATE_NOTE } from '@/lib/food/search';
import { lastNDates } from '@/lib/health/dates';
import { useTheme } from '@/theme';

type Key = (typeof SUMMARY_KEYS)[number];
const METRICS: { value: Key; label: string; noun: string; fmt: (v: number) => string }[] = [
  { value: 'energy_kcal', label: 'Calories', noun: 'calories', fmt: (v) => `${Math.round(v)} kcal` },
  { value: 'protein_g', label: 'Protein', noun: 'protein', fmt: (v) => `${Math.round(v * 10) / 10} g` },
  { value: 'carbs_g', label: 'Carbs', noun: 'carbs', fmt: (v) => `${Math.round(v * 10) / 10} g` },
  { value: 'fat_g', label: 'Fat', noun: 'fat', fmt: (v) => `${Math.round(v * 10) / 10} g` },
];

// Daily calories and macros for 7, 30 or 90 days. Days without logs are gaps, not zero bars.
export default function FoodHistory() {
  const c = useTheme();
  const router = useRouter();
  const [key, setKey] = useState<Key>('energy_kcal');
  const m = METRICS.find((x) => x.value === key)!;
  // BarHistory refetches when `fetch` changes, so it is made once per metric.
  const fetch = useMemo(() => async (days: number) => {
    const dates = lastNDates(days);
    return historyDays(await getDailyTotals(dates[0], dates[days - 1]), key);
  }, [key]);

  return (
    <Screen title="Nutrition History" back>
      <Segmented label="Nutrient" options={METRICS} value={key} onChange={setKey} />
      <BarHistory
        key={key}
        fetch={fetch}
        hasAny={hasFoodEntries}
        fmt={m.fmt}
        noun={m.noun}
        emptyAction={{ label: 'Log Food', onPress: () => router.push('/food') }}
      />
      <Text style={[styles.caption, { color: c.inkSoft }]}>Each bar is the total for one day of logged food. Days with unknown values may read low. Days without logs are left blank, not counted as zero.</Text>
      <Text style={[styles.caption, { color: c.inkSoft }]}>{ESTIMATE_NOTE}</Text>
    </Screen>
  );
}
