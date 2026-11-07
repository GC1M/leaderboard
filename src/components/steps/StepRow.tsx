import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { StepRow as Row } from '@/lib/health/rules';

import { useLargeText } from '@/components/ui';
import { useTheme } from '@/theme';

const dayLabel = (date: string, today: string) => {
  if (date === today) return 'Today';
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
};

export function StepRow({ date, today, row, onUseHealth, onPress }: { onPress?: () => void; date: string; today: string; row?: Row; onUseHealth?: () => void }) {
  const t = useTheme();
  const large = useLargeText();
  const label = dayLabel(date, today);
  const source = row?.source === 'manual' ? 'Manual' : 'Health';
  const a11y = row ? `${label}, ${row.value.toLocaleString()} steps, ${source}` : `${label}, no data`;
  if (onPress) return <Pressable accessibilityRole="button" accessibilityLabel={a11y} onPress={onPress} style={[styles.row, large && styles.stacked, { borderBottomColor: t.line }]}>
    <View style={styles.main}><Text style={[styles.day, { color: t.ink }]}>{label}</Text><Text style={[styles.tag, { color: t.inkSoft }]}>{source}</Text></View>
    <Text style={[styles.value, { color: t.ink }]}>{row?.value.toLocaleString()} steps</Text>
  </Pressable>;
  return (
    <View accessible={!onUseHealth || row?.source !== 'manual'} accessibilityLabel={a11y} style={[styles.row, large && styles.stacked, { borderBottomColor: t.line }]}>
      <View style={styles.main}>
        <Text style={[styles.day, { color: t.ink }]}>{label}</Text>
        {row && <Text style={[styles.tag, { color: row.source === 'manual' ? t.manual : t.inkSoft }]}>{source}</Text>}
        {row?.source === 'manual' && onUseHealth && (
          <Pressable onPress={onUseHealth} accessibilityRole="button" accessibilityLabel={`Use Health data for ${label}`} style={styles.link}>
            <Text style={{ color: t.accent, fontSize: 13, fontWeight: '600' }}>Use Health data</Text>
          </Pressable>
        )}
      </View>
      <Text style={[styles.value, { color: row ? t.ink : t.inkSoft }]}>{row ? row.value.toLocaleString() : 'No data'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 64, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  stacked: { flexDirection: 'column', alignItems: 'flex-start' },
  main: { flexShrink: 1 },
  day: { fontSize: 16, fontWeight: '600' },
  link: { minHeight: 44, justifyContent: 'center' },
  tag: { fontSize: 13, fontWeight: '500' },
  value: { fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] },
});
