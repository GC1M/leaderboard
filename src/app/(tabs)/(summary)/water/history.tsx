import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Text } from 'react-native';

import { BarHistory } from '@/components/history/BarHistory';
import { Screen, styles } from '@/components/ui';
import { lastNDates } from '@/lib/health/dates';
import { getWaterTarget, getWaterTotals, hasWaterEntries, type WaterDayTotal } from '@/lib/water/entries';
import { formatWater, useWaterUnit } from '@/lib/water/units';
import { useTheme } from '@/theme';

const latest = (xs: (string | null)[]) => xs.reduce<string | null>((a, b) => (b && (!a || b > a) ? b : a), null);

// Daily water totals for 7, 30 or 90 days. Days without entries are gaps, not zero bars.
export default function WaterHistory() {
  const c = useTheme();
  const router = useRouter();
  const [unit] = useWaterUnit();
  const [target, setTarget] = useState<number | null>(null);
  const [totals, setTotals] = useState<WaterDayTotal[]>([]);
  useEffect(() => { getWaterTarget().then(setTarget, () => {}); }, []);
  // BarHistory refetches when `fetch` changes, so it is made once.
  const fetch = useMemo(() => async (days: number) => {
    const dates = lastNDates(days);
    const rows = await getWaterTotals(dates[0], dates[days - 1]);
    setTotals(rows);
    return rows.map((r) => ({ date: r.date, value: r.totalMl }));
  }, []);

  const manual = totals.reduce((s, r) => s + r.manualMl, 0);
  const fromHealth = totals.reduce((s, r) => s + r.healthMl, 0);
  const lastEntry = latest(totals.map((r) => r.lastEntryAt));
  const lastHealth = latest(totals.map((r) => r.healthReceivedAt));

  return (
    <Screen title="Water History" back>
      <BarHistory
        key={unit}
        fetch={fetch}
        hasAny={hasWaterEntries}
        fmt={(v) => formatWater(v, unit)}
        noun="water"
        target={target}
        emptyAction={{ label: 'Log Water', onPress: () => router.push('/water') }}
      />
      {totals.length > 0 && (
        <Text style={[styles.caption, { color: c.inkSoft }]}>
          {`In this range: ${formatWater(manual, unit)} added here, ${formatWater(fromHealth, unit)} from Apple Health.${lastEntry ? ` Last entry ${new Date(lastEntry).toLocaleString()}.` : ''}${lastHealth ? ` Last received from Health ${new Date(lastHealth).toLocaleString()}.` : ''}`}
        </Text>
      )}
      <Text style={[styles.caption, { color: c.inkSoft }]}>
        {`Each bar is the total for one day.${target ? ' The line across the bars is your target.' : ''} Days without entries are left blank, not counted as zero.`}
      </Text>
    </Screen>
  );
}
