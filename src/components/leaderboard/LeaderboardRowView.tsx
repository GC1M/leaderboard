import { StyleSheet, Text, View } from 'react-native';

import { useLargeText } from '@/components/ui';
import { formatValue, hasNoData, type LeaderboardRow, type Metric } from '@/lib/leaderboard';
import { useTheme } from '@/theme';

type Props = {
  row: LeaderboardRow;
  rankLabel: string;
  metric: Metric;
  isYou: boolean;
  leader: number;
  source?: { text: string; manual: boolean };
};

// Race-board row: heavy rank numeral, name, score, and a lane bar filled relative to the leader.
export function LeaderboardRowView({ row, rankLabel, metric, isYou, leader, source }: Props) {
  const c = useTheme();
  // Names wrap at accessibility sizes instead of truncating to a few letters.
  const large = useLargeText();
  const noData = hasNoData(row);
  const valueText = row.value === null ? (row.state === 'not_shared' ? 'Not shared' : 'No data') : formatValue(metric, row.value);
  const fill = row.value === null || leader <= 0 ? 0 : Math.min(1, row.value / leader);
  const rankColor = noData ? c.inkSoft : (c.medal[row.rank - 1] ?? c.ink);
  return (
    <View
      accessible
      accessibilityLabel={`${noData ? 'Unranked' : `Rank ${rankLabel}`}, ${row.name}${isYou ? ', you' : ''}, ${valueText}${source ? `, ${source.text}` : ''}`}
      style={[styles.row, isYou ? { backgroundColor: c.youTint, borderRadius: 14 } : { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line }]}
    >
      <View style={styles.top}>
        <Text maxFontSizeMultiplier={1.3} style={[styles.rank, { color: rankColor }]}>
          {rankLabel}
        </Text>
        <View style={styles.main}>
          <View style={styles.name}>
            <Text numberOfLines={large ? undefined : 1} style={[styles.nameText, { color: c.ink }]}>
              {row.name}
            </Text>
            {isYou && <Text style={[styles.tag, { color: c.accent }]}>You</Text>}
          </View>
          {source && <Text style={[styles.source, { color: source.manual ? c.manual : c.inkSoft }]}>{source.text}</Text>}
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
  main: { flex: 1 },
  name: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  source: { fontSize: 13, lineHeight: 18, fontWeight: '500' },
  nameText: { flexShrink: 1, fontSize: 16, lineHeight: 24, fontWeight: '600' },
  tag: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
  score: { fontSize: 22, lineHeight: 28, fontWeight: '800', fontVariant: ['tabular-nums'] },
  none: { fontSize: 16, lineHeight: 24 },
  lane: { height: 4, borderRadius: 999 },
});
