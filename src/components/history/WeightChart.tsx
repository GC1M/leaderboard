import { StyleSheet, Text, View } from 'react-native';

import { styles as ui } from '@/components/ui';
import { formatWeight, weightPoints, type WeightUnit } from '@/lib/health/format';
import { readingDateLabel, startOfLocalDay } from '@/lib/health/dates';
import { useTheme } from '@/theme';

const DOT = 10;

// Dots at each reading's real time (x) and weight (y). Readings are irregular, so no bars and no line across the gaps.
// Plain Views, like WeekChart.
export function WeightChart({ readings, days, to, unit }: {
  readings: { kg: number; measuredAt: string }[];
  days: number;
  to: Date;
  unit: WeightUnit;
}) {
  const c = useTheme();
  const from = startOfLocalDay(to, days - 1);
  const { points, min, max } = weightPoints(readings, from, to);
  const inRange = readings.filter((r) => Date.parse(r.measuredAt) >= from.getTime() && Date.parse(r.measuredAt) <= to.getTime());
  const last = inRange[inRange.length - 1];
  const summary = points.length
    ? `Last ${days} days: ${points.length} ${points.length === 1 ? 'reading' : 'readings'} from ${formatWeight(min, unit)} to ${formatWeight(max, unit)}. Latest ${formatWeight(last!.kg, unit)}, ${readingDateLabel(new Date(last!.measuredAt), to)}`
    : `Last ${days} days: no readings`;
  const edge = from.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={summary} style={{ gap: 8 }}>
      <View style={styles.plot}>
        <View style={styles.scale}>
          <Text style={[ui.caption, { color: c.inkSoft }]}>{points.length ? formatWeight(max, unit) : ''}</Text>
          <Text style={[ui.caption, { color: c.inkSoft }]}>{points.length ? formatWeight(min, unit) : ''}</Text>
        </View>
        <View style={[styles.area, { borderColor: c.line }]}>
          {points.map((p) => (
            <View
              key={p.x}
              style={[styles.dot, { left: `${p.x * 100}%`, bottom: `${p.y * 100}%`, backgroundColor: c.accent }]}
            />
          ))}
        </View>
      </View>
      <View style={styles.axis}>
        <Text style={[ui.caption, { color: c.inkSoft }]}>{edge}</Text>
        <Text style={[ui.caption, { color: c.inkSoft }]}>Today</Text>
      </View>
      <Text style={[ui.caption, { color: c.inkSoft }]}>{summary}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  plot: { flexDirection: 'row', height: 160, gap: 8 },
  scale: { justifyContent: 'space-between' },
  // Dots are centered on their point, so the plot area is inset by half a dot to keep edge readings inside it.
  area: { flex: 1, marginHorizontal: DOT / 2, borderLeftWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
  dot: { position: 'absolute', width: DOT, height: DOT, borderRadius: DOT / 2, marginLeft: -DOT / 2, marginBottom: -DOT / 2 },
  axis: { flexDirection: 'row', justifyContent: 'space-between' },
});
