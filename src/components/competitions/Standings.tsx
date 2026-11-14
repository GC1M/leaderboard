import { StyleSheet, Text, View } from 'react-native';
import { Card, styles, useLargeText } from '@/components/ui';
import { LeaderboardRowView } from '@/components/leaderboard/LeaderboardRowView';
import { competitionGap, dayCountMetric, eligibilityLabel, metricUnit, standingValue, type CompetitionStanding } from '@/lib/competitions';
import { leaderValue, rankLabels, type LeaderboardRow } from '@/lib/leaderboard';
import { rounded, serif, useTheme } from '@/theme';
const entries = (n: number, kind: string) => `${n} ${kind} ${n === 1 ? 'entry' : 'entries'}`;
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
// Per-row freshness only when it is worth a look.
const STALE_MS = 6 * 3_600_000;

export function CompetitionStandings({ rows, metric, scoring, uid, meta, final, now }: { rows: CompetitionStanding[]; metric: string; scoring?: string; uid: string; meta?: string; final?: boolean; now?: Date }) {
  const c = useTheme();
  const icon = { ios: 'trophy', android: 'emoji_events', web: 'emoji_events' } as const;
  if (!rows.length) return <Card icon={icon} label="Standings" color={c.steps} meta={meta}><Text style={[styles.body, { color: c.inkSoft }]}>No one has joined yet. Share the invite to get people in.</Text></Card>;
  // Same race-board row as group leaderboards; rank 0 only stands in for unranked, which the row shows as "-".
  const board: LeaderboardRow[] = rows.map((r) => ({ userId: r.user_id, name: r.display_name, value: r.score, rank: r.rank ?? 0, state: r.score === null ? 'no_data' : 'recorded' }));
  const labels = rankLabels(board); const leader = leaderValue(board);
  const me = rows.find((r) => r.user_id === uid);
  // Gap to the leader under each ranked row, so the distance reads as a number as well as a lane.
  const ranked = rows.filter((r) => r.rank !== null && r.score !== null);
  const top = ranked.length > 1 ? ranked.reduce((a, b) => (b.score! > a.score! ? b : a)) : null;
  const amount = (n: number) => standingValue({ score: n, eligibility: 'eligible' }, metric, scoring);
  const notes = [labels.some((l) => l.startsWith('T')) && 'T marks a tie.', rows.some((r) => r.score === null) && 'Missing readings are unranked; recorded zeroes count.'].filter(Boolean).join(' ');
  return (
    <Card icon={icon} label={final ? 'Final standings' : 'Standings'} color={c.steps} meta={meta} footer={notes || undefined}>
      {me?.rank ? <Text accessibilityLabel={`You are ${ordinal(me.rank)} of ${rows.length}`} maxFontSizeMultiplier={1.5} style={[s.place, { color: c.ink }]}>{ordinal(me.rank)}<Text style={[s.of, { color: c.inkFaint }]}> of {rows.length}</Text></Text> : null}
      {rows.every((r) => r.score === null) && <Text style={[styles.body, { color: c.inkSoft }]}>No {metricUnit(metric)} recorded yet.</Text>}
      <View style={{ marginHorizontal: -12 }}>
        {rows.map((r, i) => <LeaderboardRowView key={r.user_id} row={board[i]} rankLabel={labels[i]} metric="steps" isYou={r.user_id === uid} leader={rows.length > 1 ? leader : 0} valueText={standingValue(r, metric, scoring)}
          source={r.score === null ? undefined : { text: `${entries(r.health_entries, 'Health')}, ${entries(r.manual_entries, 'manual')}`, manual: r.manual_entries > 0 }}>
          {top && r.rank !== null && r.score !== null && r.score < top.score! && <Text style={[styles.caption, { color: c.inkSoft }]}>{`${amount(top.score! - r.score)} behind ${top.user_id === uid ? 'you' : top.display_name}`}</Text>}
          {r.excluded_entries > 0 && <Text style={[styles.caption, { color: c.inkSoft }]}>{entries(r.excluded_entries, 'manual')} excluded by this competition&apos;s rules.</Text>}
          {r.score !== null && r.eligibility !== 'eligible' && <Text style={[styles.caption, { color: c.inkSoft }]}>{eligibilityLabel(r.eligibility)}</Text>}
          {r.updated_at && now && now.getTime() - Date.parse(r.updated_at) > STALE_MS && <Text style={[styles.caption, { color: c.inkSoft }]}>Data from {new Date(r.updated_at).toLocaleString()}</Text>}
        </LeaderboardRowView>)}
      </View>
    </Card>
  );
}

// One sentence on the race around you, then a strip from the person behind you to the person ahead.
// With `daysLeft` (today included) on a running total, it also says what it takes a day to pass the person ahead.
export function GapHighlight({ rows, metric, scoring, uid, daysLeft = 0 }: { rows: CompetitionStanding[]; metric: string; scoring?: string; uid: string; daysLeft?: number }) {
  const c = useTheme();
  const large = useLargeText();
  const gap = competitionGap(rows, uid, metric, scoring);
  const me = rows.find((r) => r.user_id === uid);
  if (!gap || !me || me.score === null) return null;
  const others = rows.filter((r) => r.user_id !== uid && r.score !== null);
  const above = others.filter((r) => r.score! > me.score!).sort((a, b) => a.score! - b.score!)[0];
  const below = others.filter((r) => r.score! < me.score!).sort((a, b) => b.score! - a.score!)[0];
  const amount = (n: number) => standingValue({ score: n, eligibility: 'eligible' }, metric, scoring);
  const behind = below ? `${below.display_name} is ${amount(me.score - below.score!)} behind you.` : null;
  const pass = above && daysLeft > 0 && (scoring ?? 'total') === 'total' && !dayCountMetric(metric)
    ? `To pass ${above.display_name}, beat them by about ${amount(Math.floor((above.score! - me.score) / daysLeft) + 1)} a day.` : null;
  const lo = below?.score ?? me.score; const hi = above?.score ?? me.score;
  const at = (v: number) => `${hi === lo ? 50 : ((v - lo) / (hi - lo)) * 100}%` as const;
  return (
    <Card icon={{ ios: 'sparkles', android: 'auto_awesome', web: 'auto_awesome' }} label="Your race" color={c.accent}>
      <Text accessibilityLabel={[gap, behind].filter(Boolean).join('. ')} style={[s.sentence, { color: c.ink }]}>
        {gap}.{behind ? ` ${behind}` : ''}
      </Text>
      {pass && <Text style={[styles.caption, { color: c.inkSoft }]}>{pass}</Text>}
      {hi > lo && <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={{ gap: 6 }}>
        <View style={s.strip}>
          <View style={[s.track, { backgroundColor: c.line }]} />
          {above && <View style={[s.segment, { left: at(me.score), right: 0, backgroundColor: c.border }]} />}
          {below && <View style={[s.dot, { left: at(below.score!), backgroundColor: c.border, borderColor: c.surface }]} />}
          {above && <View style={[s.dot, { left: at(above.score!), backgroundColor: c.border, borderColor: c.surface }]} />}
          <View style={[s.dot, { left: at(me.score), backgroundColor: c.accent, borderColor: c.surface }]} />
        </View>
        <View style={[s.names, large && { flexDirection: 'column' }]}>
          <Text style={[styles.caption, { color: c.inkFaint }]}>{below ? `${below.display_name} ${amount(below.score!)}` : 'You'}</Text>
          <Text style={[styles.caption, { color: c.inkFaint }]}>{above ? `${above.display_name} ${amount(above.score!)}` : 'You'}</Text>
        </View>
      </View>}
    </Card>
  );
}

const s = StyleSheet.create({
  sentence: { fontFamily: serif.text, fontSize: 20, lineHeight: 26 },
  place: { fontFamily: rounded, fontSize: 30, lineHeight: 36, fontWeight: '700', fontVariant: ['tabular-nums'] },
  of: { fontSize: 15, fontWeight: '600' },
  strip: { height: 14, justifyContent: 'center', marginHorizontal: 7 },
  track: { height: 4, borderRadius: 2 },
  segment: { position: 'absolute', height: 6, borderRadius: 3 },
  dot: { position: 'absolute', width: 14, height: 14, borderRadius: 7, borderWidth: 2, marginLeft: -7 },
  names: { flexDirection: 'row', justifyContent: 'space-between' },
});
