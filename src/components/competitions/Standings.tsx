import { Text, View } from 'react-native';
import { Section, styles } from '@/components/ui';
import { LeaderboardRowView } from '@/components/leaderboard/LeaderboardRowView';
import { competitionGap, eligibilityLabel, standingValue, type CompetitionStanding } from '@/lib/competitions';
import { leaderValue, rankLabels, type LeaderboardRow } from '@/lib/leaderboard';
import { useTheme } from '@/theme';
const entries = (n: number, kind: string) => `${n} ${kind} ${n === 1 ? 'entry' : 'entries'}`;
export function CompetitionStandings({ rows, metric, uid }: { rows: CompetitionStanding[]; metric: string; uid: string }) {
  const c = useTheme();
  if (!rows.length) return <Text style={[styles.body, { color: c.inkSoft }]}>No participants yet. Group members must choose to join.</Text>;
  // Same race-board row as group leaderboards; rank 0 only stands in for unranked, which the row shows as "-".
  const board: LeaderboardRow[] = rows.map((r) => ({ userId: r.user_id, name: r.display_name, value: r.score, rank: r.rank ?? 0, state: r.score === null ? 'no_data' : 'recorded' }));
  const labels = rankLabels(board); const leader = leaderValue(board); const gap = competitionGap(rows, uid, metric);
  return <View style={{ gap: 12 }}>
    {gap && <Text accessibilityLiveRegion="polite" style={[styles.heading, { color: c.ink }]}>{gap}</Text>}
    <Section title="Standings" footer="T marks a tie. Missing readings are unranked; recorded zeroes count. Sharing choices apply to live and final results.">
      {rows.map((r, i) => <LeaderboardRowView key={r.user_id} row={board[i]} rankLabel={labels[i]} metric="steps" isYou={r.user_id === uid} leader={leader} valueText={standingValue(r, metric)}
        source={r.score === null ? undefined : { text: `${entries(r.health_entries, 'Health')} · ${entries(r.manual_entries, 'manual')}`, manual: r.manual_entries > 0 }}>
        {r.excluded_entries > 0 && <Text style={[styles.caption, { color: c.inkSoft }]}>{entries(r.excluded_entries, 'manual')} excluded by this competition&apos;s rules.</Text>}
        {r.score !== null && r.eligibility !== 'eligible' && <Text style={[styles.caption, { color: c.inkSoft }]}>{eligibilityLabel(r.eligibility)}</Text>}
        {r.updated_at && <Text style={[styles.caption, { color: c.inkSoft }]}>Data updated {new Date(r.updated_at).toLocaleString()}</Text>}
      </LeaderboardRowView>)}
    </Section>
  </View>;
}
