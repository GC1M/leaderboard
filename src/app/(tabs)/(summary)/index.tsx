import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { HealthSyncStatus } from '@/components/HealthSyncStatus';
import { Sparkline } from '@/components/Sparkline';
import { WeekChart } from '@/components/steps/WeekChart';
import { Button, ErrorText, Icon, Row, Screen, Section, Skeleton, glass, styles as ui, useLargeText } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { flushLocalLogs } from '@/lib/flush-logs';
import { getDailyTotals } from '@/lib/food/diary';
import { listMyGroups, type MyGroup } from '@/lib/groups';
import { lastNDates, localDateKey, readingDateLabel, startOfLocalDay } from '@/lib/health/dates';
import { dateFromKey, formatSleep, formatWeight } from '@/lib/health/format';
import type { StepRow } from '@/lib/health/rules';
import { useHealthSync } from '@/lib/health/sync';
import { formatValue, getLeaderboard, myStanding, type Standing } from '@/lib/leaderboard';
import { getMyRecentSteps } from '@/lib/metrics';
import { getMyRecentSleep } from '@/lib/sleep';
import { getMyLatestWeight, getMyWeightHistory } from '@/lib/weight';
import { useWeightUnit } from '@/lib/weight-unit';
import { historyStart, totalsParts, weeklyTotals, type WeekTotals } from '@/lib/workout-history';
import { useDistanceUnit } from '@/lib/distance-unit';
import { getWaterTotals } from '@/lib/water/entries';
import { formatWater, useWaterUnit } from '@/lib/water/units';
import { listWorkoutsSince } from '@/lib/workouts';
import { rounded, useTheme } from '@/theme';

type Card = MyGroup & { standing: Standing | null };
// Latest value of a metric: undefined while loading, null when there is none, 'error' when it failed to load.
type Latest<T> = T | null | undefined | 'error';
type Sleep = { date: string; value: number };
type Weight = { kg: number; measuredAt: string };
// Today's food: null when nothing is logged (not 0 kcal); kcal is null when no logged food had calories.
type Food = { kcal: number | null; atLeast: boolean };
// The last seven days of each tile's metric, oldest first, for its sparkline. Days without a value are null.
type Week = (number | null)[];
const week = (dates: string[], rows: { date: string; value: number | null }[]): Week => dates.map((d) => rows.find((r) => r.date === d)?.value ?? null);

export default function Summary() {
  const c = useTheme();
  const router = useRouter();
  const { session } = useAuth();
  const health = useHealthSync();
  const me = session?.user.id ?? '';
  const [steps, setSteps] = useState<StepRow[] | null>(null);
  const [sleep, setSleep] = useState<Latest<Sleep>>();
  const [weight, setWeight] = useState<Latest<Weight>>();
  const [workouts, setWorkouts] = useState<Latest<WeekTotals>>();
  const [food, setFood] = useState<Latest<Food>>();
  // Today's water in mL: null when nothing is logged (not 0 mL).
  const [water, setWater] = useState<Latest<number>>();
  const [sparks, setSparks] = useState<{ sleep: Week; weight: Week; food: Week; water: Week } | null>(null);
  const [waterUnit] = useWaterUnit();
  const [unit] = useWeightUnit();
  const [cards, setCards] = useState<Card[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const dates = lastNDates(7);
  const [distanceUnit] = useDistanceUnit();

  const load = useCallback(async () => {
    try {
      await flushLocalLogs(me);
      const [s, groups] = await Promise.all([getMyRecentSteps(7), listMyGroups()]);
      // ponytail: one leaderboard call per group; fine for a handful of groups, add a batched RPC if people join dozens.
      // One group failing (e.g. you were just removed) shouldn't blank the whole summary.
      const boards = await Promise.allSettled(groups.map((g) => getLeaderboard(g.id, 'steps', 'day')));
      // Sleep, weight and workouts fail on their own: an error shows on that card, not on the whole summary.
      const todayKey = localDateKey(new Date());
      // Food and water come back for the last seven days: today's tile value, and the week for its sparkline.
      const seven = lastNDates(7);
      const [sl, wt, wo, fd, wa, wh] = await Promise.allSettled([getMyRecentSleep(me, 30), getMyLatestWeight(me), listWorkoutsSince(historyStart(1)), getDailyTotals(seven[0], todayKey), getWaterTotals(seven[0], todayKey), getMyWeightHistory(me, startOfLocalDay(new Date(), 6))]);
      const todayFood = fd.status === 'fulfilled' ? fd.value.find((d) => d.date === todayKey) : undefined;
      const todayWater = wa.status === 'fulfilled' ? wa.value.find((d) => d.date === todayKey) : undefined;
      setSleep(sl.status === 'fulfilled' ? (sl.value[sl.value.length - 1] ?? null) : 'error');
      setWeight(wt.status === 'fulfilled' ? wt.value : 'error');
      setFood(fd.status === 'fulfilled' ? (todayFood ? { kcal: todayFood.energy_kcal, atLeast: todayFood.kcalIncomplete } : null) : 'error');
      setWater(wa.status === 'fulfilled' ? (todayWater?.totalMl ?? null) : 'error');
      setSparks({
        sleep: week(seven, sl.status === 'fulfilled' ? sl.value : []),
        // One dot per day, at the day's last reading.
        weight: week(seven, wh.status === 'fulfilled' ? wh.value.map((r) => ({ date: localDateKey(new Date(r.measuredAt)), value: r.kg })).reverse() : []),
        food: week(seven, fd.status === 'fulfilled' ? fd.value.map((d) => ({ date: d.date, value: d.energy_kcal })) : []),
        water: week(seven, wa.status === 'fulfilled' ? wa.value.map((d) => ({ date: d.date, value: d.totalMl })) : []),
      });
      setWorkouts(wo.status === 'fulfilled' ? weeklyTotals(wo.value, 1)[0] : 'error');
      setSteps(s);
      setCards(groups.map((g, i) => ({ ...g, standing: boards[i].status === 'fulfilled' ? myStanding(boards[i].value, me) : null })));
      setError(null);
    } catch {
      setError("Couldn't load your summary. Pull down to try again.");
    }
  }, [me]);

  const lastImport = Object.values(health.metrics).map((m) => `${m.status}:${m.lastSuccess ?? ''}`).join('|');
  useFocusEffect(useCallback(() => { if (!health.syncing && lastImport) void load(); }, [health.syncing, lastImport, load]));

  const refresh = async () => {
    setRefreshing(true);
    await health.sync();
    await load();
    setRefreshing(false);
  };

  const today = steps?.find((r) => r.date === localDateKey(new Date()));
  const large = useLargeText();
  const chevron = <Icon name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} color={c.inkFaint} size={14} />;

  return (
    <Screen title="Summary" subtitle={new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
      <HealthSyncStatus variant="summary" />
      <ErrorText>{error}</ErrorText>
      {!steps || !cards ? (
        !error && <Skeleton label="Loading summary" />
      ) : (
        <>
          {/* Standing first: where you are among friends is the point of the app. Your lane is teal in every row. */}
          {cards.length === 0 ? (
            <Section title="Groups" footer="Start a group for your friends, or join with a code someone sent you.">
              <View style={{ padding: 16, gap: 12 }}>
                <Button label="Create Group" onPress={() => router.push('/groups/new', { withAnchor: true })} />
                <Button label="Join with a Code" secondary onPress={() => router.push('/groups/join', { withAnchor: true })} />
              </View>
            </Section>
          ) : (
            <Section title="Today in your groups">
              {cards.map((g, i) => {
                const s = g.standing;
                const value = s?.value ?? null;
                const noData = value === null;
                const fill = !noData && s!.leader > 0 ? value / s!.leader : 0;
                return (
                  <Pressable
                    key={g.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${g.name}. ${noData ? 'No steps data yet today' : `You are ${s!.rankLabel} of ${s!.members}, ${formatValue('steps', value)} steps`}.`}
                    onPress={() => router.push(`/group/${g.id}`)}
                    style={({ pressed }) => [styles.race, i < cards.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line }, { opacity: pressed ? 0.7 : 1 }]}
                  >
                    <View style={styles.raceTop}>
                      <Text maxFontSizeMultiplier={1.3} style={[styles.rank, { color: noData ? c.inkFaint : (c.medal[Number(s!.rankLabel.replace('T', '')) - 1] ?? c.ink) }]}>
                        {noData ? '–' : s!.rankLabel}
                      </Text>
                      <Text numberOfLines={large ? undefined : 1} style={[ui.bodyStrong, { color: c.ink, flex: 1 }]}>{g.name}</Text>
                      <Text style={[styles.score, { color: noData ? c.inkFaint : c.ink }]}>{noData ? 'No data' : formatValue('steps', value)}</Text>
                      {chevron}
                    </View>
                    <View style={[styles.lane, { backgroundColor: c.lane }]}>
                      <View style={[styles.lane, { width: `${fill * 100}%`, backgroundColor: c.accent }]} />
                    </View>
                    <Text style={[ui.caption, { color: c.inkFaint }]}>{noData ? `Steps, ${g.memberCount} people` : `Steps, ${s!.rankLabel} of ${g.memberCount}`}</Text>
                  </Pressable>
                );
              })}
            </Section>
          )}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Steps today, ${today ? `${today.value.toLocaleString()}, from ${today.source === 'manual' ? 'manual entry' : 'Health'}` : 'no data yet'}. Opens My Steps.`}
            onPress={() => router.push('/steps')}
            style={({ pressed }) => [ui.card, glass(c), pressed && ui.pressed]}
          >
            <View style={styles.cardHead}>
              <Icon name={{ ios: 'figure.walk', android: 'directions_walk', web: 'directions_walk' }} color={c.steps} />
              <Text style={[styles.label, { color: c.steps, flex: 1 }]}>Steps</Text>
              <Text style={[ui.caption, { color: c.inkFaint }]}>Today</Text>
              {chevron}
            </View>
            <Text maxFontSizeMultiplier={1.5} style={[styles.big, { color: today ? c.ink : c.inkFaint }]}>{today ? today.value.toLocaleString() : 'No data'}</Text>
            {today?.source === 'manual' && <Text style={[ui.caption, { color: c.manual }]}>Manual</Text>}
            <WeekChart dates={dates} rows={steps} />
          </Pressable>

          <View style={styles.tiles}>
            <Tile
              title="Sleep"
              value={typeof sleep === 'object' && sleep ? formatSleep(sleep.value) : null}
              when={typeof sleep === 'object' && sleep ? readingDateLabel(dateFromKey(sleep.date)) : null}
              state={sleep === 'error' ? 'error' : sleep ? 'ok' : 'empty'}
              spark={sparks?.sleep}
              onPress={() => router.push('/sleep')}
            />
            <Tile
              title="Weight"
              value={typeof weight === 'object' && weight ? formatWeight(weight.kg, unit) : null}
              when={typeof weight === 'object' && weight ? readingDateLabel(new Date(weight.measuredAt)) : null}
              state={weight === 'error' ? 'error' : weight ? 'ok' : 'empty'}
              spark={sparks?.weight}
              dots
              onPress={() => router.push('/weight')}
            />
            <Tile
              title="Food"
              value={typeof food === 'object' && food ? (food.kcal === null ? 'Unknown' : `${food.atLeast ? 'At least ' : ''}${Math.round(food.kcal)} kcal`) : null}
              when="Today"
              empty="Nothing logged"
              state={food === 'error' ? 'error' : typeof food === 'object' && food ? 'ok' : 'empty'}
              spark={sparks?.food}
              onPress={() => router.push('/food/diary')}
            />
            <Tile
              title="Water"
              value={typeof water === 'number' ? formatWater(water, waterUnit) : null}
              when="Today"
              empty="Nothing logged"
              state={water === 'error' ? 'error' : typeof water === 'number' ? 'ok' : 'empty'}
              spark={sparks?.water}
              onPress={() => router.push('/water')}
            />
          </View>

          <Section>
            <Row
              icon={{ ios: 'dumbbell.fill', android: 'fitness_center', web: 'fitness_center' }}
              label="Workouts"
              value={workouts === 'error' ? "Couldn't load" : typeof workouts === 'object' && workouts?.count ? `${totalsParts(workouts, distanceUnit)[0]} this week, ${totalsParts(workouts, distanceUnit)[1]}` : 'None this week'}
              last
              onPress={() => router.push('/workouts')}
            />
          </Section>
        </>
      )}
    </Screen>
  );
}

// Half-width glass tile with the latest value. `when` says which day the value is from, so an old reading never
// reads as today's. The week's sparkline hints at the chart behind the tile. Tiles stack to one column at
// accessibility text sizes.
function Tile({ title, value, when, state, empty = 'No data', spark, dots, onPress }: {
  title: string;
  value: string | null;
  when: string | null;
  state: 'ok' | 'empty' | 'error';
  empty?: string;
  spark?: Week;
  dots?: boolean;
  onPress: () => void;
}) {
  const c = useTheme();
  const large = useLargeText();
  const text = state === 'error' ? "Couldn't load" : (value ?? empty);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${when ? `${when}, ` : ''}${text}. Opens My ${title}.`}
      onPress={onPress}
      style={({ pressed }) => [styles.tile, glass(c), large && { flexBasis: '100%' }, pressed && ui.pressed]}
    >
      <Text style={[styles.label, { color: c.inkSoft }]}>{title}</Text>
      <Text maxFontSizeMultiplier={1.5} numberOfLines={1} adjustsFontSizeToFit style={[state === 'ok' ? styles.tileValue : styles.tileEmpty, { color: state === 'ok' ? c.ink : state === 'error' ? c.danger : c.inkFaint }]}>{text}</Text>
      {when ? <Text style={[ui.caption, { color: c.inkFaint }]}>{when}</Text> : null}
      {spark && <Sparkline values={spark} dots={dots} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
  big: { fontSize: 40, lineHeight: 46, fontWeight: '700', fontFamily: rounded, fontVariant: ['tabular-nums'], letterSpacing: -0.5 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: { flexGrow: 1, flexBasis: '45%', minHeight: 108, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 14, gap: 2 },
  tileValue: { fontSize: 26, lineHeight: 32, fontWeight: '700', fontFamily: rounded, fontVariant: ['tabular-nums'], marginTop: 8 },
  tileEmpty: { fontSize: 17, lineHeight: 32, marginTop: 8 },
  race: { paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  raceTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rank: { minWidth: 36, fontSize: 28, lineHeight: 32, fontWeight: '700', fontFamily: rounded, fontVariant: ['tabular-nums'] },
  score: { fontSize: 22, lineHeight: 28, fontWeight: '700', fontFamily: rounded, fontVariant: ['tabular-nums'] },
  lane: { height: 6, borderRadius: 999 },
});
