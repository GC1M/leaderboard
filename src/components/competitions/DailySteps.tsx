import { StyleSheet, Text, View } from 'react-native';
import { Card, styles as ui } from '@/components/ui';
import type { DailySteps } from '@/lib/competitions';
import { rounded, useTheme } from '@/theme';

const HEIGHT = 96;
const short = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

// Your own steps (or workout minutes, or workouts: `noun`) per competition day. Missing days get a dashed box, a recorded zero a thin solid sliver,
// entries this competition excludes an outline at their height, and days still to come stay empty.
// The reference line is the pace of the person you are chasing, from totals the group already shares.
// live is false once the competition has ended, so the last day is no longer called today.
export function DailyStepsCard({ days, today, live, pace, noun = 'steps' }: { days: DailySteps[]; today: string; live: boolean; pace: { name: string; perDay: number } | null; noun?: string }) {
  const c = useTheme();
  const total = days.reduce((s, d) => s + (d.value ?? 0), 0);
  const todays = live ? days.find((d) => d.day === today) : undefined;
  const recorded = days.filter((d) => d.value !== null);
  const missing = days.filter((d) => !d.future && !(live && d.day === today) && d.value === null && !d.excluded).length;
  const excluded = days.filter((d) => !d.future && d.value === null && d.excluded > 0).length;
  const best = recorded.reduce<DailySteps | null>((a, d) => (!a || d.value! > a.value! ? d : a), null);
  const max = Math.max(1, ...days.map((d) => Math.max(d.value ?? 0, d.excluded)), pace?.perDay ?? 0);
  const h = (v: number) => Math.max(2, Math.round((v / max) * HEIGHT));
  const summary = [
    `Your ${noun}, ${days.filter((d) => !d.future).length} of ${days.length} days.`,
    `Total ${total.toLocaleString()}.`,
    todays && !todays.future ? (todays.value === null ? `No ${noun} recorded today.` : `Today ${todays.value.toLocaleString()}.`) : '',
    best ? `Best day ${short(best.day)}, ${best.value!.toLocaleString()}.` : '',
    missing ? `${missing} ${missing === 1 ? 'day' : 'days'} with no data.` : '',
    excluded ? `${excluded} ${excluded === 1 ? 'day' : 'days'} only had entries this competition excludes.` : '',
    pace ? `${pace.name}'s pace ${pace.perDay.toLocaleString()} a day.` : '',
    recorded.length ? `Your average ${Math.round(total / recorded.length).toLocaleString()} a day.` : '',
  ].filter(Boolean).join(' ');
  return (
    <Card icon={{ ios: 'figure.walk', android: 'directions_walk', web: 'directions_walk' }} label={`Your ${noun}`} color={c.steps} meta="Only you see this">
      <View accessible accessibilityRole="image" accessibilityLabel={summary} style={{ gap: 12 }}>
        <View>
          <Text maxFontSizeMultiplier={1.5} style={[s.big, { color: c.ink }]}>
            {total.toLocaleString()}<Text style={[s.unit, { color: c.inkFaint }]}> {noun}</Text>
          </Text>
          {todays && !todays.future && <Text style={[ui.caption, { color: c.inkFaint }]}>{todays.value === null ? `No ${noun} recorded today` : `Today ${todays.value.toLocaleString()}`}</Text>}
        </View>
        {days.length > 1 && <>
          {pace && <Text style={[ui.caption, { color: c.inkSoft }]}>Line: {pace.name}&apos;s pace, {pace.perDay.toLocaleString()} a day</Text>}
          <View style={{ height: HEIGHT }}>
            <View style={s.columns}>
              {days.map((d) => {
                return (
                  <View key={d.day} style={s.slot}>
                    {d.future ? null : d.value !== null ? (
                      <View style={[s.bar, { height: d.value === 0 ? 2 : h(d.value), backgroundColor: c.steps }]} />
                    ) : d.excluded > 0 ? (
                      <View style={[s.bar, s.outline, { height: h(d.excluded), borderColor: c.steps }]} />
                    ) : (
                      <View style={[s.bar, s.gap, { borderColor: c.border }]} />
                    )}
                  </View>
                );
              })}
            </View>
            {pace && <View style={[s.pace, { bottom: h(pace.perDay), backgroundColor: c.inkSoft }]} />}
            <View style={[s.baseline, { backgroundColor: c.line }]} />
          </View>
          <View style={[s.columns, { flex: 0, height: 8 }]}>
            {days.map((d) => <View key={d.day} style={s.slot}>{live && d.day === today && <View style={[s.dot, { backgroundColor: c.inkSoft }]} />}</View>)}
          </View>
          <View style={s.axis}>
            <Text numberOfLines={1} style={[ui.caption, { color: c.inkFaint }]}>{short(days[0].day)}</Text>
            <Text numberOfLines={1} style={[ui.caption, { color: c.inkFaint }]}>{short(days[days.length - 1].day)}</Text>
          </View>
          {(missing > 0 || excluded > 0) && <Text style={[ui.caption, { color: c.inkFaint }]}>{[missing > 0 && 'Dashed: no data', excluded > 0 && 'Outline: excluded by the rules'].filter(Boolean).join('. ')}</Text>}
        </>}
      </View>
    </Card>
  );
}

const s = StyleSheet.create({
  big: { fontSize: 30, lineHeight: 36, fontWeight: '700', fontFamily: rounded, fontVariant: ['tabular-nums'] },
  unit: { fontSize: 15, fontWeight: '600' },
  columns: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, flex: 1 },
  slot: { flex: 1, maxWidth: 24, alignItems: 'center', justifyContent: 'flex-end', height: '100%' },
  bar: { width: '100%', borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  outline: { borderWidth: 1, borderBottomWidth: 0 },
  gap: { height: 12, borderWidth: 1, borderStyle: 'dashed', borderRadius: 4 },
  pace: { position: 'absolute', left: 0, right: 0, height: 2 },
  baseline: { position: 'absolute', left: 0, right: 0, bottom: 0, height: StyleSheet.hairlineWidth },
  dot: { width: 4, height: 4, borderRadius: 2, marginTop: 4 },
  axis: { flexDirection: 'row', justifyContent: 'space-between' },
});
