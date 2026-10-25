import { StyleSheet, Text, useColorScheme, View } from 'react-native';

import { formatValue, hasNoData, type LeaderboardRow, type Metric } from '@/lib/leaderboard';

type Props = { row: LeaderboardRow; rankLabel: string; metric: Metric; isYou: boolean };

export function LeaderboardRowView({ row, rankLabel, metric, isYou }: Props) {
  const dark = useColorScheme() === 'dark';
  const noData = hasNoData(row);
  const fg = dark ? '#fff' : '#111';
  const valueText = noData ? 'no data yet' : formatValue(metric, row.value);
  const youBg = dark ? '#1e3a5f' : '#e6f0ff';
  return (
    <View
      accessible
      accessibilityLabel={`${noData ? 'unranked' : `rank ${rankLabel}`}, ${row.name}${isYou ? ', you' : ''}, ${valueText}`}
      style={[styles.row, isYou && { backgroundColor: youBg }, noData && styles.dim]}
    >
      <Text style={[styles.rank, { color: fg }]}>{rankLabel}</Text>
      <Text style={[styles.name, { color: fg }]} numberOfLines={1}>
        {row.name}
        {isYou ? ' (you)' : ''}
      </Text>
      <Text style={[styles.value, { color: fg }]}>{valueText}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingHorizontal: 16, gap: 12 },
  dim: { opacity: 0.5 },
  rank: { width: 36, fontSize: 16, fontWeight: '600' },
  name: { flex: 1, fontSize: 16 },
  value: { fontSize: 16, fontVariant: ['tabular-nums'] },
});
