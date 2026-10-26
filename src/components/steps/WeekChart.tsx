import { StyleSheet, Text, View } from 'react-native';

import { styles as ui } from '@/components/ui';
import type { StepRow } from '@/lib/health/rules';
import { useTheme } from '@/theme';

const weekday = (date: string, style: 'narrow' | 'long') => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: style });
};

// Total and average over the days that have a reading. Missing days are not zeros.
export function weekStats(values: (number | null)[]) {
  const recorded = values.filter((v): v is number => v !== null);
  const total = recorded.reduce((a, b) => a + b, 0);
  return { total, days: recorded.length, average: recorded.length ? Math.round(total / recorded.length) : null, max: Math.max(0, ...recorded) };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Seven bars, oldest first, today in the accent color. Plain Views: one chart doesn't earn a chart library.
// Days without a reading draw a dashed outline instead of a bar, so a gap never looks like a zero.
export function WeekChart({ dates, rows }: { dates: string[]; rows: StepRow[] }) {
  const c = useTheme();
  const values = dates.map((d) => rows.find((r) => r.date === d)?.value ?? null);
  const { total, days, average, max } = weekStats(values);
  const missing = values.length - days;
  const caption =
    average === null
      ? 'No step data in the last 7 days'
      : `Average ${average.toLocaleString()} a day over ${plural(days, 'day')} with data${missing ? `, ${missing} without` : ''}`;
  const summary =
    average === null
      ? 'Last 7 days: no step data'
      : `Last 7 days: ${total.toLocaleString()} steps on ${plural(days, 'day')} with data, average ${average.toLocaleString()} a day` +
        (missing ? `, no data on ${plural(missing, 'day')}` : '') +
        (max > 0 ? `, best ${max.toLocaleString()} on ${weekday(dates[values.indexOf(max)], 'long')}` : '');
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={summary} style={{ gap: 8 }}>
      <View style={styles.chart}>
        {values.map((v, i) => (
          <View key={dates[i]} style={styles.col}>
            <View style={styles.track}>
              {v === null ? (
                <View style={[styles.bar, styles.gap, { borderColor: c.border }]} />
              ) : (
                <View
                  style={[
                    styles.bar,
                    { height: `${max ? Math.max(2, (v / max) * 100) : 2}%`, backgroundColor: i === values.length - 1 ? c.accent : c.border },
                  ]}
                />
              )}
            </View>
            <Text style={[ui.caption, { color: c.inkSoft }]}>{weekday(dates[i], 'narrow')}</Text>
          </View>
        ))}
      </View>
      <Text style={[ui.caption, { color: c.inkSoft }]}>{caption}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chart: { flexDirection: 'row', gap: 8, height: 120 },
  col: { flex: 1, alignItems: 'center', gap: 4 },
  track: { flex: 1, width: '100%', justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: 4 },
  gap: { height: 12, borderWidth: 1, borderStyle: 'dashed' },
});
