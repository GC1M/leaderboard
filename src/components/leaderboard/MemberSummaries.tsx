import { StyleSheet, Text, View } from 'react-native';

import { styles as ui } from '@/components/ui';
import { sleepText, weightText, workoutsText, type MemberSummary } from '@/lib/group-summaries';
import type { WeightUnit } from '@/lib/health/format';
import { useTheme } from '@/theme';

// Plain latest values, no ranking: sleep and weight are not competitions.
export function MemberSummaries({ items, me, unit }: { items: MemberSummary[]; me?: string; unit: WeightUnit }) {
  const c = useTheme();
  return (
    <View style={styles.wrap}>
      <Text accessibilityRole="header" style={[ui.bodyStrong, { color: c.ink }]}>
        Sleep, weight and workouts
      </Text>
      {items.map((m) => {
        const sleep = `Sleep: ${sleepText(m.sleep)}`;
        const weight = `Weight: ${weightText(m.weight, unit)}`;
        const workouts = `Workouts: ${workoutsText(m.workouts)}`;
        const name = m.userId === me ? `${m.name}, you` : m.name;
        return (
          <View
            key={m.userId}
            accessible
            accessibilityLabel={`${name}. ${sleep}. ${weight}. ${workouts}`}
            style={[styles.row, { borderBottomColor: c.line }]}
          >
            <Text numberOfLines={1} style={[ui.bodyStrong, { color: c.ink }]}>
              {name}
            </Text>
            <Text style={[ui.caption, { color: c.inkSoft }]}>{sleep}</Text>
            <Text style={[ui.caption, { color: c.inkSoft }]}>{weight}</Text>
            <Text style={[ui.caption, { color: c.inkSoft }]}>{workouts}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingTop: 24, gap: 4 },
  row: { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
});
