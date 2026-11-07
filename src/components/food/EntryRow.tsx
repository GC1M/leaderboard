import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon, styles as ui } from '@/components/ui';
import type { Entry } from '@/lib/food/diary';
import { entryTags, formatAmount, formatNutrient } from '@/lib/food/format';
import { useTheme } from '@/theme';

// One diary entry. Tags follow the leaderboard's "Manual" tag: small text in the manual color.
export function EntryRow({ entry, onPress, last }: { entry: Entry; onPress: () => void; last?: boolean }) {
  const c = useTheme();
  const tags = entryTags(entry);
  const kcal = formatNutrient('energy_kcal', entry.nutrients.energy_kcal);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[entry.name, formatAmount(entry), kcal, ...tags].join(', ')}
      onPress={onPress}
      style={({ pressed }) => [ui.row, { opacity: pressed ? 0.6 : 1 }]}
    >
      <View style={[ui.rowBody, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line }]}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[ui.body, { color: c.ink }]}>{entry.name}</Text>
          <Text style={[ui.caption, { color: c.inkSoft }]}>{`${formatAmount(entry)} · ${kcal}`}</Text>
          {tags.length > 0 && (
            <Text style={[ui.caption, { color: entry.pending ? c.danger : c.manual }]}>{tags.join(' · ')}</Text>
          )}
        </View>
        <Icon name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} color={c.inkSoft} size={14} />
      </View>
    </Pressable>
  );
}
