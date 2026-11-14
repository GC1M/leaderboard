import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme';

// Seven tiny marks under a tile's number, so the tile signals the chart behind it. Decorative: the tile's own
// label says what the value is, and the full chart on the next screen has the accessible summary.
// Bars rise from zero (sleep, food, water). Dots sit between the week's low and high (weight, where zero is meaningless).
// Days without a value leave a gap. Plain Views, like the other charts.
export function Sparkline({ values, dots }: { values: (number | null)[]; dots?: boolean }) {
  const c = useTheme();
  const known = values.filter((v): v is number => v !== null);
  if (known.length < 2) return <View style={styles.row} />;
  const max = Math.max(...known);
  const min = dots ? Math.min(...known) : 0;
  const scale = (v: number) => (max === min ? 0.5 : (v - min) / (max - min));
  return (
    <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={styles.row}>
      {values.map((v, i) => (
        <View key={i} style={styles.slot}>
          {v === null ? null : dots ? (
            <View style={[styles.dot, { bottom: `${scale(v) * 100}%`, backgroundColor: i === values.length - 1 ? c.accent : c.border }]} />
          ) : (
            <View style={[styles.bar, { height: `${Math.max(8, scale(v) * 100)}%`, backgroundColor: i === values.length - 1 ? c.accent : c.border }]} />
          )}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 22, marginTop: 6 },
  slot: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: 2 },
  dot: { position: 'absolute', alignSelf: 'center', width: 5, height: 5, borderRadius: 3, marginBottom: -2 },
});
