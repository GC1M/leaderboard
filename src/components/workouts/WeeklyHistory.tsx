import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Segmented } from '@/components/history/Segmented';
import { Button, ErrorText, Section, Skeleton, styles as ui } from '@/components/ui';
import { dateFromKey } from '@/lib/health/format';
import {
  historyStart, totalsParts, WEEK_RANGES, type WeekRange, type WeekTotals, weekLabel, weeklyTotals, weeksSummary,
} from '@/lib/workout-history';
import type { DistanceUnit } from '@/lib/workout-form';
import type { Workout } from '@/lib/workouts';
import { useTheme } from '@/theme';

// 4/8/12-week history of workouts. `fetch` must be stable (module function or useCallback). A new `refresh` value
// refetches the current range. Weeks with no workouts draw a dashed outline, never a zero bar.
export function WeeklyHistory({ fetch, unit, refresh }: { fetch: (since: Date) => Promise<Workout[]>; unit: DistanceUnit; refresh?: unknown }) {
  const [weeks, setWeeks] = useState<WeekRange>(8);
  const [tries, setTries] = useState(0);
  // Keyed by range, so switching range shows the loading state until its own result arrives.
  const [res, setRes] = useState<{ weeks: number; rows?: Workout[]; error?: string } | null>(null);

  useEffect(() => {
    let live = true;
    fetch(historyStart(weeks)).then(
      (rows) => live && setRes({ weeks, rows }),
      (e) => live && setRes({ weeks, error: e instanceof Error ? e.message : "Couldn't load your workouts." }),
    );
    return () => { live = false; };
  }, [fetch, weeks, tries, refresh]);

  const current = res?.weeks === weeks ? res : null;
  return (
    <View style={{ gap: 12 }}>
      <Segmented
        label="Time range"
        options={WEEK_RANGES.map((r) => ({ value: r, label: `${r}W`, a11y: `${r} weeks` }))}
        value={weeks}
        onChange={setWeeks}
      />
      {current?.error ? (
        <View>
          <ErrorText>{current.error}</ErrorText>
          <Button plain label="Try Again" onPress={() => { setRes(null); setTries((t) => t + 1); }} />
        </View>
      ) : !current?.rows ? (
        <Skeleton label="Loading workout history" rows={2} />
      ) : (
        <WeeklyHistoryView totals={weeklyTotals(current.rows, weeks)} unit={unit} />
      )}
    </View>
  );
}

// Totals for the current week, bars of workouts per week, then one entry per week (newest first).
export function WeeklyHistoryView({ totals, unit, now = new Date() }: { totals: WeekTotals[]; unit: DistanceUnit; now?: Date }) {
  const c = useTheme();
  const current = totals[totals.length - 1];
  const parts = totalsParts(current, unit);
  const max = Math.max(0, ...totals.map((t) => t.count));
  const summary = weeksSummary(totals, now);
  const edge = dateFromKey(totals[0].weekStart).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  if (!totals.some((t) => t.count > 0)) {
    return <Text style={[ui.body, { color: c.inkSoft }]}>{`No workouts recorded in the last ${totals.length} weeks.`}</Text>;
  }
  return (
    <View style={{ gap: 12 }}>
      <View accessible accessibilityLabel={`This week: ${parts.length ? parts.join(', ') : 'no workouts yet'}`} style={{ gap: 4 }}>
        <Text style={[ui.caption, { color: c.inkSoft }]}>This week</Text>
        <Text maxFontSizeMultiplier={1.5} style={[styles.big, { color: parts.length ? c.ink : c.inkSoft }]}>{parts.length ? parts.slice(0, 2).join(', ') : 'No workouts yet'}</Text>
        {parts.slice(2).map((p) => (
          <Text key={p} style={[ui.caption, { color: c.inkSoft }]}>{p}</Text>
        ))}
      </View>
      <View accessible accessibilityRole="image" accessibilityLabel={summary} style={{ gap: 8 }}>
        <View style={[styles.chart, { gap: totals.length > 8 ? 2 : 6 }]}>
          {totals.map((t, i) => (
            <View key={t.weekStart} style={styles.track}>
              {t.count === 0 ? (
                <View style={[styles.gap, { borderColor: c.border }]} />
              ) : (
                <View style={{ height: `${Math.max(2, (t.count / max) * 100)}%`, borderRadius: 3, backgroundColor: i === totals.length - 1 ? c.accent : c.border }} />
              )}
            </View>
          ))}
        </View>
        <View style={styles.axis}>
          <Text style={[ui.caption, { color: c.inkSoft }]}>{`Week of ${edge}`}</Text>
          <Text style={[ui.caption, { color: c.inkSoft }]}>This week</Text>
        </View>
        <Text style={[ui.caption, { color: c.inkSoft }]}>{summary}</Text>
      </View>
      <Section footer="Distance and calories add up only the workouts that recorded them. Weeks start on Monday.">
        {[...totals].reverse().map((t, i, all) => {
          const p = totalsParts(t, unit);
          const from = [t.imported && `${t.imported} from Apple Health`, t.manual && `${t.manual} manual`, t.fromApps && `${t.fromApps} from other apps`].filter(Boolean).join(', ');
          return (
            <View
              key={t.weekStart}
              accessible
              accessibilityLabel={`${weekLabel(t.weekStart, now)}, ${p.length ? `${p.join(', ')}, ${from}` : 'no workouts'}`}
              style={[styles.week, i < all.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line }]}
            >
              <Text style={[ui.bodyStrong, { color: c.ink }]}>{weekLabel(t.weekStart, now)}</Text>
              <Text style={[ui.body, { color: p.length ? c.ink : c.inkSoft }]}>{p.length ? p.join(', ') : 'No workouts'}</Text>
              {from ? <Text style={[ui.caption, { color: c.inkSoft }]}>{from}</Text> : null}
            </View>
          );
        })}
      </Section>
    </View>
  );
}

const styles = StyleSheet.create({
  big: { fontSize: 34, lineHeight: 41, fontWeight: '800', fontVariant: ['tabular-nums'] },
  chart: { flexDirection: 'row', height: 120 },
  track: { flex: 1, justifyContent: 'flex-end' },
  gap: { height: 8, borderWidth: 1, borderStyle: 'dashed' },
  axis: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', columnGap: 12 },
  week: { paddingHorizontal: 16, paddingVertical: 12, gap: 2 },
});
