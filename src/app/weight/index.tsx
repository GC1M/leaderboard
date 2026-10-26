import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { Segmented } from '@/components/history/Segmented';
import { WeightChart } from '@/components/history/WeightChart';
import { Button, ErrorText, Screen, Skeleton, styles } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { readingDateLabel, startOfLocalDay } from '@/lib/health/dates';
import { formatWeight, RANGES, type Range } from '@/lib/health/format';
import { useWeightUnit } from '@/lib/weight-unit';
import { getMyLatestWeight, getMyWeightHistory } from '@/lib/weight';
import { useTheme } from '@/theme';

type Reading = { kg: number; measuredAt: string };
type Result = { days: number; rows?: Reading[]; latest?: Reading | null; error?: string };

export default function Weight() {
  const c = useTheme();
  const { session } = useAuth();
  const me = session?.user.id ?? '';
  const [unit, setUnit] = useWeightUnit();
  const [days, setDays] = useState<Range>(30);
  const [tries, setTries] = useState(0);
  // Keyed by range, so switching range shows the loading state until its own result arrives.
  const [res, setRes] = useState<Result | null>(null);

  useEffect(() => {
    let live = true;
    const now = new Date();
    Promise.all([getMyWeightHistory(me, startOfLocalDay(now, days - 1)), getMyLatestWeight(me)]).then(
      ([rows, latest]) => live && setRes({ days, rows, latest }),
      (e) => live && setRes({ days, error: e instanceof Error ? e.message : "Couldn't load your weight." }),
    );
    return () => { live = false; };
  }, [me, days, tries]);

  const current = res?.days === days ? res : null;
  const latest = current?.latest;

  return (
    <Screen title="My Weight" back>
      <Segmented
        label="Weight unit"
        options={[{ value: 'kg', label: 'kg' }, { value: 'lb', label: 'lb' }] as const}
        value={unit}
        onChange={setUnit}
      />
      {latest && (
        <View>
          <Text style={[styles.caption, { color: c.inkSoft }]}>Latest, {readingDateLabel(new Date(latest.measuredAt))}</Text>
          <Text style={[styles.heading, { color: c.ink }]}>{formatWeight(latest.kg, unit)}</Text>
        </View>
      )}
      <Segmented
        label="Time range"
        options={RANGES.map((r) => ({ value: r, label: `${r}D`, a11y: `${r} days` }))}
        value={days}
        onChange={setDays}
      />
      {current?.error ? (
        <View>
          <ErrorText>{current.error}</ErrorText>
          <Button plain label="Try Again" onPress={() => { setRes(null); setTries((t) => t + 1); }} />
        </View>
      ) : !current ? (
        <Skeleton label="Loading weight" rows={2} />
      ) : !latest ? (
        <Text style={[styles.body, { color: c.inkSoft }]}>No weight recorded yet. Readings imported from Apple Health appear here.</Text>
      ) : (
        <WeightChart readings={current.rows ?? []} days={days} to={new Date()} unit={unit} />
      )}
      <Text style={[styles.caption, { color: c.inkSoft }]}>Readings are plotted at the time they were taken. Only you can see this.</Text>
    </Screen>
  );
}
