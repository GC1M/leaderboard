import { Pressable, StyleSheet, Text, View } from 'react-native';

import { styles as ui } from '@/components/ui';
import { readingDateLabel } from '@/lib/health/dates';
import { sourceLabel } from '@/lib/workout-history';
import { type DistanceUnit, workoutSummary } from '@/lib/workout-form';
import type { Workout } from '@/lib/workouts';
import { useTheme } from '@/theme';

// One session in the list: what, when, where it came from, and the totals it recorded (distance and calories only
// when they were).
export function WorkoutRow({ w, unit, last, onPress, now }: { w: Workout; unit: DistanceUnit; last?: boolean; onPress: () => void; now?: Date }) {
  const c = useTheme();
  const when = readingDateLabel(new Date(w.started_at), now);
  const source = sourceLabel(w);
  const summary = workoutSummary(w, unit);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${w.activity_type}, ${when}, ${summary}, ${source}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line }, { opacity: pressed ? 0.6 : 1 }]}
    >
      <View style={styles.main}>
        <Text numberOfLines={1} style={[ui.body, { color: c.ink }]}>{w.activity_type}</Text>
        <Text style={[ui.caption, { color: c.inkSoft }]}>
          {when}
          {' · '}
          <Text style={{ color: w.source !== 'healthkit' ? c.manual : c.inkSoft }}>{source}</Text>
        </Text>
      </View>
      <Text style={[ui.body, { color: c.inkSoft, flexShrink: 1, textAlign: 'right' }]}>{summary}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 16, paddingVertical: 8 },
  main: { flexShrink: 1 },
});
