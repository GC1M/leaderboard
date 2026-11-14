import { StyleSheet, Text, View } from 'react-native';
import { Card, styles as ui, useLargeText } from '@/components/ui';
import type { RaceLine } from '@/lib/competitions';
import { rounded, useTheme } from '@/theme';

const HEIGHT = 72;

// "Race so far": one small panel per ranked member, in standing order, all on the same scale. Each panel is that
// member's running total day by day, with the front of the pack (the best other total that day) as a faint outline
// behind it, so the gap is visible without one tangled multi-line chart that would need a hue per person. Teal still
// means you. Plain Views draw the totals as rising columns; a line would need an SVG dependency.
// ponytail: columns, not the mock's polylines; swap in react-native-svg if lines are ever wanted elsewhere too.
export function RaceChart({ lines, uid, unit, dayCount }: { lines: RaceLine[]; uid: string; unit: string; dayCount: number }) {
  const c = useTheme();
  const large = useLargeText();
  if (lines.length < 2 || !lines[0].totals.length) return null;
  const elapsed = lines[0].totals.length;
  const max = Math.max(1, ...lines.flatMap((l) => l.totals));
  const h = (v: number) => Math.max(v > 0 ? 2 : 0, Math.round((v / max) * HEIGHT));
  const front = (self: RaceLine, i: number) => Math.max(0, ...lines.filter((l) => l !== self).map((l) => l.totals[i]));
  const me = lines.find((l) => l.user_id === uid);
  const leader = lines[0];
  const summary = [
    `${unit} added up day by day, ${elapsed} of ${dayCount} days.`,
    `${leader.user_id === uid ? 'You lead' : `${leader.display_name} leads`} with ${leader.score.toLocaleString()}.`,
    me && me !== leader ? `You are ${ordinal(me.rank)} with ${me.score.toLocaleString()}, ${(leader.score - me.score).toLocaleString()} behind.` : '',
  ].filter(Boolean).join(' ');
  return (
    <Card icon={{ ios: 'chart.xyaxis.line', android: 'show_chart', web: 'show_chart' }} label="Race so far" color={c.steps}>
      <Text style={[ui.caption, { color: c.inkSoft }]}>{`${unit} added up day by day, ${elapsed} of ${dayCount} days. Faint: the front of the pack.`}</Text>
      <View accessible accessibilityRole="image" accessibilityLabel={summary} style={styles.panels}>
        {lines.map((l) => {
          const you = l.user_id === uid;
          return (
            <View key={l.user_id} style={[styles.panel, large && { flexBasis: '100%' }]}>
              <View style={styles.head}>
                <Text numberOfLines={1} style={[styles.name, { color: c.ink, flex: 1 }]}>
                  <Text style={{ color: c.medal[l.rank - 1] ?? c.ink }}>{l.rank}</Text> {you ? 'You' : l.display_name}
                </Text>
                <Text style={[styles.score, { color: c.ink }]}>{l.score.toLocaleString()}</Text>
              </View>
              <View style={styles.columns}>
                {l.totals.map((v, i) => (
                  <View key={i} style={styles.slot}>
                    <View style={[styles.ghost, { height: h(front(l, i)), borderColor: c.border }]} />
                    <View style={[styles.bar, { height: h(v), backgroundColor: you ? c.accent : c.inkSoft }]} />
                  </View>
                ))}
              </View>
              <View style={[styles.baseline, { backgroundColor: c.line }]} />
            </View>
          );
        })}
      </View>
    </Card>
  );
}

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;

const styles = StyleSheet.create({
  panels: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  panel: { flexGrow: 1, flexBasis: '45%', gap: 6 },
  head: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  name: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
  score: { fontSize: 15, lineHeight: 20, fontWeight: '700', fontFamily: rounded, fontVariant: ['tabular-nums'] },
  columns: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: HEIGHT },
  slot: { flex: 1, justifyContent: 'flex-end' },
  ghost: { position: 'absolute', left: 0, right: 0, bottom: 0, borderWidth: 1, borderBottomWidth: 0, borderTopLeftRadius: 3, borderTopRightRadius: 3, opacity: 0.6 },
  bar: { marginHorizontal: 2, borderTopLeftRadius: 3, borderTopRightRadius: 3 },
  baseline: { height: StyleSheet.hairlineWidth, marginTop: -6 },
});
