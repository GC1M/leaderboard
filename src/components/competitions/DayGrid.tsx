import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Card, styles as ui } from '@/components/ui';
import { dayCountMetric, dayWinners, type DayGridRow } from '@/lib/competitions';
import { rounded, useTheme } from '@/theme';

const CELL = 38;
const GAP = 3;
const compact = (v: number) => (v >= 10_000 ? `${Math.round(v / 1000)}K` : v >= 1000 ? `${(v / 1000).toFixed(1)}K` : `${Math.round(v)}`);

// "Day by day": members down the side in standing order, competition days across. Darker means a bigger day compared
// within that day (lowest to best), a crown marks who won the day, a dashed box is a day with no data and a plain lane
// a day still to come. On/off metrics (water days, active days) show a check instead of an amount. Long competitions
// scroll sideways, starting at the end so today is in view.
export function DayGrid({ rows, days, elapsed, uid, metric, unit }: { rows: DayGridRow[]; days: string[]; elapsed: number; uid: string; metric: string; unit: string }) {
  const c = useTheme();
  if (rows.length < 2 || !elapsed) return null;
  const counts = dayCountMetric(metric);
  const past = rows.map((r) => r.cells.slice(0, elapsed));
  const winners = counts ? [] : dayWinners(rows.map((r, i) => ({ ...r, cells: past[i] })), elapsed);
  const range = Array.from({ length: elapsed }, (_, i) => {
    const v = rows.map((r) => r.cells[i]).filter((x): x is number => x !== null && x > 0);
    return { lo: Math.min(...v), hi: Math.max(...v) };
  });
  const shade = (v: number, i: number) => (counts ? (v ? 0.85 : 0) : v <= 0 ? 0 : range[i].hi === range[i].lo ? 0.9 : 0.18 + ((v - range[i].lo) / (range[i].hi - range[i].lo)) * 0.72);
  const name = (r: DayGridRow) => (r.user_id === uid ? 'You' : r.display_name);
  const won = (id: string) => winners.filter((w) => w.includes(id)).length;
  const summary = [
    `${unit} each day, ${elapsed} of ${days.length} days.`,
    ...rows.map((r, i) => counts
      ? `${name(r)}: ${past[i].filter((v) => v === 1).length} of ${elapsed} days.`
      : `${name(r)}: won ${won(r.user_id)} ${won(r.user_id) === 1 ? 'day' : 'days'}, ${past[i].filter((v) => v === null).length} without data.`),
  ].join(' ');
  return (
    <Card icon={{ ios: 'square.grid.3x3.fill', android: 'grid_on', web: 'grid_on' }} label="Day by day" color={c.steps}>
      <Text style={[ui.caption, { color: c.inkSoft }]}>{counts ? `Each day on target, ${elapsed} of ${days.length} days.` : `${unit} each day. Darker is a bigger day; the crown won it.`}</Text>
      <View accessible accessibilityRole="image" accessibilityLabel={summary} style={styles.wrap}>
        <View style={styles.names}>
          <View style={styles.head} />
          {rows.map((r) => (
            <View key={r.user_id} style={[styles.nameCell, r.user_id === uid && { backgroundColor: c.youTint }]}>
              <Text numberOfLines={1} style={[styles.name, { color: r.user_id === uid ? c.accent : c.ink }]}>{name(r)}</Text>
            </View>
          ))}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} ref={(s) => s?.scrollToEnd({ animated: false })}>
          <View style={{ gap: GAP }}>
            <View style={[styles.row, styles.head]}>
              {days.map((d, i) => (
                <Text key={d} style={[styles.day, { color: i === elapsed - 1 ? c.ink : c.inkFaint }]}>{i === elapsed - 1 && i < days.length - 1 ? 'Today' : `D${i + 1}`}</Text>
              ))}
            </View>
            {rows.map((r) => (
              <View key={r.user_id} style={[styles.row, r.user_id === uid && { backgroundColor: c.youTint, borderRadius: 8 }]}>
                {r.cells.map((v, i) => {
                  if (i >= elapsed) return <View key={i} style={[styles.cell, { backgroundColor: c.lane }]} />;
                  if (v === null) return <View key={i} style={[styles.cell, styles.missing, { borderColor: c.inkFaint }]} />;
                  const o = shade(v, i);
                  return (
                    <View key={i} style={[styles.cell, !o && { backgroundColor: c.lane }]}>
                      {o > 0 && <View style={[StyleSheet.absoluteFill, styles.fill, { backgroundColor: c.steps, opacity: o }]} />}
                      <Text style={[styles.value, { color: o > 0.55 ? c.bg : c.ink }]}>{counts ? (v ? '✓' : '') : compact(v)}</Text>
                      {winners[i]?.includes(r.user_id) && <Text style={styles.crown}>👑</Text>}
                    </View>
                  );
                })}
              </View>
            ))}
          </View>
        </ScrollView>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', gap: GAP, paddingTop: 6 },
  names: { gap: GAP, width: 64 },
  head: { height: 16 },
  nameCell: { height: CELL, justifyContent: 'center', paddingHorizontal: 4, borderRadius: 8 },
  name: { fontSize: 13, lineHeight: 16, fontWeight: '600' },
  row: { flexDirection: 'row', gap: GAP },
  day: { width: CELL, textAlign: 'center', fontSize: 11, lineHeight: 16, fontWeight: '600' },
  cell: { width: CELL, height: CELL, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  fill: { borderRadius: 8 },
  missing: { borderWidth: 1.5, borderStyle: 'dashed' },
  value: { fontSize: 11, fontWeight: '700', fontFamily: rounded, fontVariant: ['tabular-nums'] },
  crown: { position: 'absolute', top: -7, right: -3, fontSize: 12, lineHeight: 14 },
});
