import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Segmented } from '@/components/history/Segmented';
import { Button, ErrorText, Skeleton, styles as ui } from '@/components/ui';
import { dateFromKey, barSummary, RANGES, type Range } from '@/lib/health/format';
import { lastNDates, readingDateLabel } from '@/lib/health/dates';
import { useTheme } from '@/theme';

type Day = { date: string; value: number };

// 7/30/90-day bars for a daily metric (steps, sleep minutes). `fetch` must be stable (module function or useCallback).
// Days without a row draw a dashed outline, never a zero bar; the summary averages recorded days only.
export function BarHistory({ fetch, fmt, noun }: { fetch: (days: number) => Promise<Day[]>; fmt: (v: number) => string; noun: string }) {
  const c = useTheme();
  const [days, setDays] = useState<Range>(7);
  const [tries, setTries] = useState(0);
  // Keyed by range, so switching range shows the loading state until its own result arrives.
  const [res, setRes] = useState<{ days: number; rows?: Day[]; error?: string } | null>(null);

  useEffect(() => {
    let live = true;
    fetch(days).then(
      (rows) => live && setRes({ days, rows }),
      (e) => live && setRes({ days, error: e instanceof Error ? e.message : `Couldn't load your ${noun}.` }),
    );
    return () => { live = false; };
  }, [fetch, days, noun, tries]);

  const current = res?.days === days ? res : null;
  const rows = current?.rows ?? null;
  const error = current?.error ?? null;

  const now = new Date();
  const dates = lastNDates(days, now);
  const values = dates.map((d) => rows?.find((r) => r.date === d)?.value ?? null);
  const max = Math.max(0, ...values.map((v) => v ?? 0));
  const summary = barSummary(dates, values, fmt, noun, now, readingDateLabel);
  const edge = (d: string) => dateFromKey(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  return (
    <View style={{ gap: 12 }}>
      <Segmented
        label="Time range"
        options={RANGES.map((r) => ({ value: r, label: `${r}D`, a11y: `${r} days` }))}
        value={days}
        onChange={setDays}
      />
      {error ? (
        <View>
          <ErrorText>{error}</ErrorText>
          <Button plain label="Try Again" onPress={() => { setRes(null); setTries((t) => t + 1); }} />
        </View>
      ) : !rows ? (
        <Skeleton label={`Loading ${noun}`} rows={2} />
      ) : !rows.length ? (
        <Text style={[ui.body, { color: c.inkSoft }]}>{`No ${noun} recorded in the last ${days} days.`}</Text>
      ) : (
        <View accessible accessibilityRole="image" accessibilityLabel={summary} style={{ gap: 8 }}>
          <View style={[styles.chart, { gap: days === 7 ? 8 : days === 30 ? 2 : 1 }]}>
            {values.map((v, i) => (
              <View key={dates[i]} style={styles.track}>
                {v === null ? (
                  <View style={[styles.gap, { borderColor: c.border }]} />
                ) : (
                  <View
                    style={{
                      height: `${max ? Math.max(2, (v / max) * 100) : 2}%`,
                      borderRadius: days === 7 ? 4 : 1,
                      backgroundColor: i === values.length - 1 ? c.accent : c.border,
                    }}
                  />
                )}
              </View>
            ))}
          </View>
          <View style={styles.axis}>
            <Text style={[ui.caption, { color: c.inkSoft }]}>{edge(dates[0])}</Text>
            <Text style={[ui.caption, { color: c.inkSoft }]}>Today</Text>
          </View>
          <Text style={[ui.caption, { color: c.inkSoft }]}>{summary}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  chart: { flexDirection: 'row', height: 140 },
  track: { flex: 1, justifyContent: 'flex-end' },
  gap: { height: 8, borderWidth: 1, borderStyle: 'dashed' },
  axis: { flexDirection: 'row', justifyContent: 'space-between' },
});
