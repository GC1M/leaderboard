import { Text, View } from 'react-native';
import { Section, styles } from '@/components/ui';
import { eligibilityLabel, standingValue, type CompetitionStanding } from '@/lib/competitions';
import { useTheme } from '@/theme';
const entries = (n: number, kind: string) => `${n} ${kind} ${n === 1 ? 'entry' : 'entries'}`;
export function CompetitionStandings({ rows, metric, uid }: { rows: CompetitionStanding[]; metric: string; uid: string }) {
  const c = useTheme();
  if (!rows.length) return <Text style={[styles.body, { color: c.inkSoft }]}>No participants yet. Group members must choose to join.</Text>;
  return <Section title="Standings" footer="Ties share a rank. Missing readings are unranked; recorded zeroes count. Sharing choices apply to live and final results.">
    {rows.map((r, i) => {
      const value = standingValue(r, metric);
      const source = r.score === null ? '' : `${entries(r.health_entries, 'Health')} · ${entries(r.manual_entries, 'manual')}`;
      return <View key={r.user_id} accessible accessibilityLabel={`${r.rank === null ? 'Unranked' : `Rank ${r.rank}`}, ${r.display_name}${r.user_id === uid ? ', you' : ''}, ${value}${source ? `, ${source}` : ''}`} style={{ padding: 16, gap: 6, borderBottomWidth: i < rows.length - 1 ? 0.5 : 0, borderBottomColor: c.line, backgroundColor: r.user_id === uid ? c.youTint : c.surface }}>
        <Text style={[styles.bodyStrong, { color: c.ink }]}>{`${r.rank === null ? '—' : `#${r.rank}`} ${r.display_name}${r.user_id === uid ? ' · You' : ''}`}</Text>
        <Text style={[styles.heading, { color: c.ink }]}>{value}</Text>
        {!!source && <Text style={[styles.caption, { color: c.inkSoft }]}>{source}</Text>}
        {r.excluded_entries > 0 && <Text style={[styles.caption, { color: c.inkSoft }]}>{entries(r.excluded_entries, 'manual')} excluded by this competition&apos;s rules.</Text>}
        {r.score !== null && r.eligibility !== 'eligible' && <Text style={[styles.caption, { color: c.inkSoft }]}>{eligibilityLabel(r.eligibility)}</Text>}
        {r.updated_at && <Text style={[styles.caption, { color: c.inkSoft }]}>Data updated {new Date(r.updated_at).toLocaleString()}</Text>}
      </View>;
    })}
  </Section>;
}
