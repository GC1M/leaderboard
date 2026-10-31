import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Segmented } from '@/components/history/Segmented';
import { Button, ErrorText, Skeleton, styles as ui } from '@/components/ui';
import { dateFromKey, barSummary, RANGES, type Range } from '@/lib/health/format';
import { lastNDates, readingDateLabel } from '@/lib/health/dates';
import { useTheme } from '@/theme';

type Day = { date: string; value: number };

// 7/30/90-day bars for a daily metric (steps, sleep minutes). `fetch` must be stable (module function or useCallback).
// A new `refresh` value refetches the current range, e.g. after the screen's own reload.
// Days without a row draw a dashed outline, never a zero bar; the summary averages recorded days only.
export function BarHistory({ fetch, fmt, noun, refresh, hasAny, emptyAction }: { hasAny?: () => Promise<boolean>; emptyAction?: { label: string; onPress: () => void }; fetch: (days: number) => Promise<Day[]>; fmt: (v: number) => string; noun: string; refresh?: unknown }) {
  const c = useTheme();
  const [days, setDays] = useState<Range>(7);
  const [tries, setTries] = useState(0);
  // Keyed by range, so switching range shows the loading state until its own result arrives.
  const [res, setRes] = useState<{ days: number; rows?: Day[]; any?: boolean; error?: string } | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([fetch(days), hasAny ? hasAny() : Promise.resolve(true)]).then(
      ([rows, any]) => live && setRes({ days, rows, any }),
      (e) => live && setRes({ days, error: e instanceof Error ? e.message : `Couldn't load your ${noun}.` }),
    );
    return () => { live = false; };
  }, [fetch, hasAny, days, noun, tries, refresh]);

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
      {current?.any && <Segmented
        label="Time range"
        options={RANGES.map((r) => ({ value: r, label: `${r}D`, a11y: `${r} days` }))}
        value={days}
        onChange={setDays}
      />}
      {error ? (
        <View>
          <ErrorText>{error}</ErrorText>
          <Button plain label="Try Again" onPress={() => { setRes(null); setTries((t) => t + 1); }} />
        </View>
      ) : !rows ? (
        <Skeleton label={`Loading ${noun}`} rows={2} />
      ) : current?.any === false ? (
        <View style={{ gap: 12 }}><Text style={[ui.body, { color: c.inkSoft }]}>{`No ${noun} recorded yet.`}</Text>{emptyAction && <Button label={emptyAction.label} onPress={emptyAction.onPress} />}</View>
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
