import { StyleSheet, Text, View } from 'react-native';

import { styles as ui } from '@/components/ui';
import type { StepRow } from '@/lib/health/rules';
import { useTheme } from '@/theme';

const weekday = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'narrow' });
};

// Seven bars, oldest first, today in the accent color. Plain Views: one chart doesn't earn a chart library.
export function WeekChart({ dates, rows }: { dates: string[]; rows: StepRow[] }) {
  const c = useTheme();
  const values = dates.map((d) => rows.find((r) => r.date === d)?.value ?? 0);
  const max = Math.max(...values);
  const total = values.reduce((a, b) => a + b, 0);
  const best = values.indexOf(max);
  const summary =
    max === 0
      ? 'Last 7 days: no steps yet'
      : `Last 7 days: ${total.toLocaleString()} steps, average ${Math.round(total / values.length).toLocaleString()} a day, best ${max.toLocaleString()} on ${new Date(dates[best]).toLocaleDateString(undefined, { weekday: 'long', timeZone: 'UTC' })}`;
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={summary} style={styles.chart}>
      {values.map((v, i) => (
        <View key={dates[i]} style={styles.col}>
          <View style={styles.track}>
            <View
              style={[
                styles.bar,
                { height: `${max ? Math.max(2, (v / max) * 100) : 2}%`, backgroundColor: i === values.length - 1 ? c.accent : c.border },
              ]}
            />
          </View>
          <Text style={[ui.caption, { color: c.inkSoft }]}>{weekday(dates[i])}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  chart: { flexDirection: 'row', gap: 8, height: 120 },
  col: { flex: 1, alignItems: 'center', gap: 4 },
  track: { flex: 1, width: '100%', justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: 4 },
});
