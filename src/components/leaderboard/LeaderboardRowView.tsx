import { StyleSheet, Text, View } from 'react-native';

import { formatValue, hasNoData, type LeaderboardRow, type Metric } from '@/lib/leaderboard';
import { useTheme } from '@/theme';

type Props = { row: LeaderboardRow; rankLabel: string; metric: Metric; isYou: boolean; leader: number };

// Race-board row: heavy rank numeral, name, score, and a lane bar filled relative to the leader.
export function LeaderboardRowView({ row, rankLabel, metric, isYou, leader }: Props) {
  const c = useTheme();
  const noData = hasNoData(row);
  const valueText = noData ? 'No data' : formatValue(metric, row.value);
  const fill = noData || leader <= 0 ? 0 : Math.min(1, row.value / leader);
  return (
    <View
      accessible
      accessibilityLabel={`${noData ? 'Unranked' : `Rank ${rankLabel}`}, ${row.name}${isYou ? ', you' : ''}, ${valueText}`}
      style={[styles.row, isYou ? { backgroundColor: c.youTint, borderRadius: 14 } : { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line }]}
    >
      <View style={styles.top}>
        <Text maxFontSizeMultiplier={1.3} style={[styles.rank, { color: noData ? c.inkSoft : c.ink }]}>
          {rankLabel}
        </Text>
        <View style={styles.name}>
          <Text numberOfLines={1} style={[styles.nameText, { color: c.ink }]}>
            {row.name}
          </Text>
          {isYou && <Text style={[styles.tag, { color: c.accent }]}>You</Text>}
        </View>
        <Text maxFontSizeMultiplier={1.3} style={[noData ? styles.none : styles.score, { color: noData ? c.inkSoft : c.ink }]}>
          {valueText}
        </Text>
      </View>
      <View style={[styles.lane, { backgroundColor: c.lane }]}>
        <View style={[styles.lane, { width: `${fill * 100}%`, backgroundColor: isYou ? c.accent : c.border }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 64, paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rank: { minWidth: 44, fontSize: 28, lineHeight: 32, fontWeight: '800', fontVariant: ['tabular-nums'] },
  name: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  nameText: { flexShrink: 1, fontSize: 16, lineHeight: 24, fontWeight: '600' },
  tag: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
  score: { fontSize: 22, lineHeight: 28, fontWeight: '800', fontVariant: ['tabular-nums'] },
  none: { fontSize: 16, lineHeight: 24 },
  lane: { height: 4, borderRadius: 999 },
});
