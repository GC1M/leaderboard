import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import type { SymbolViewProps } from 'expo-symbols';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { HealthSyncStatus } from '@/components/HealthSyncStatus';
import { WeekChart } from '@/components/steps/WeekChart';
import { Button, ErrorText, Icon, Screen, Section, Skeleton, styles as ui } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { listMyGroups, type MyGroup } from '@/lib/groups';
import { lastNDates, localDateKey, readingDateLabel } from '@/lib/health/dates';
import { dateFromKey, formatSleep, formatWeight } from '@/lib/health/format';
import type { StepRow } from '@/lib/health/rules';
import { useHealthSync } from '@/lib/health/sync';
import { formatValue, getLeaderboard, myStanding, type Standing } from '@/lib/leaderboard';
import { getMyRecentSteps } from '@/lib/metrics';
import { getMyRecentSleep } from '@/lib/sleep';
import { getMyLatestWeight } from '@/lib/weight';
import { useWeightUnit } from '@/lib/weight-unit';
import { useTheme } from '@/theme';

type Card = MyGroup & { standing: Standing | null };
// Latest value of a metric: undefined while loading, null when there is none, 'error' when it failed to load.
type Latest<T> = T | null | undefined | 'error';
type Sleep = { date: string; value: number };
type Weight = { kg: number; measuredAt: string };

export default function Summary() {
  const c = useTheme();
  const router = useRouter();
  const { session } = useAuth();
  const health = useHealthSync();
  const me = session?.user.id ?? '';
  const [steps, setSteps] = useState<StepRow[] | null>(null);
  const [sleep, setSleep] = useState<Latest<Sleep>>();
  const [weight, setWeight] = useState<Latest<Weight>>();
  const [unit] = useWeightUnit();
  const [cards, setCards] = useState<Card[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const dates = lastNDates(7);

  const load = useCallback(async () => {
    try {
      const [s, groups] = await Promise.all([getMyRecentSteps(7), listMyGroups()]);
      // ponytail: one leaderboard call per group; fine for a handful of groups, add a batched RPC if people join dozens.
      // One group failing (e.g. you were just removed) shouldn't blank the whole summary.
      const boards = await Promise.allSettled(groups.map((g) => getLeaderboard(g.id, 'steps', 'day')));
      // Sleep and weight fail on their own: an error shows on that card, not on the whole summary.
      const [sl, wt] = await Promise.allSettled([getMyRecentSleep(me, 30), getMyLatestWeight(me)]);
      setSleep(sl.status === 'fulfilled' ? (sl.value[sl.value.length - 1] ?? null) : 'error');
      setWeight(wt.status === 'fulfilled' ? wt.value : 'error');
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

  return (
    <Screen title="Summary" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
      <HealthSyncStatus />
      <ErrorText>{error}</ErrorText>
      {!steps || !cards ? (
        !error && <Skeleton label="Loading summary" />
      ) : (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Steps today, ${today ? `${today.value.toLocaleString()}, from ${today.source === 'manual' ? 'manual entry' : 'Health'}` : 'no data yet'}. Opens My Steps.`}
            onPress={() => router.push('/steps')}
            style={({ pressed }) => [styles.card, { backgroundColor: c.surface, opacity: pressed ? 0.8 : 1 }]}
          >
            <View style={styles.cardHead}>
              <Icon name={{ ios: 'figure.walk', android: 'directions_walk', web: 'directions_walk' }} color={c.accent} />
              <Text style={[ui.bodyStrong, { color: c.accent, flex: 1 }]}>Steps</Text>
              <Icon name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} color={c.inkSoft} size={14} />
            </View>
            <Text style={[ui.caption, { color: c.inkSoft }]}>Today</Text>
            <Text style={[styles.big, { color: today ? c.ink : c.inkSoft }]}>{today ? today.value.toLocaleString() : 'No data'}</Text>
            {today?.source === 'manual' && <Text style={[ui.caption, { color: c.manual }]}>Manual</Text>}
            <WeekChart dates={dates} rows={steps} />
          </Pressable>

          <MetricCard
            title="Sleep"
            icon={{ ios: 'bed.double.fill', android: 'bedtime', web: 'bedtime' }}
            value={typeof sleep === 'object' && sleep ? formatSleep(sleep.value) : null}
            when={typeof sleep === 'object' && sleep ? readingDateLabel(dateFromKey(sleep.date)) : null}
            state={sleep === 'error' ? 'error' : sleep ? 'ok' : 'empty'}
            onPress={() => router.push('/sleep')}
          />
          <MetricCard
            title="Weight"
            icon={{ ios: 'scalemass.fill', android: 'monitor_weight', web: 'monitor_weight' }}
            value={typeof weight === 'object' && weight ? formatWeight(weight.kg, unit) : null}
            when={typeof weight === 'object' && weight ? readingDateLabel(new Date(weight.measuredAt)) : null}
            state={weight === 'error' ? 'error' : weight ? 'ok' : 'empty'}
            onPress={() => router.push('/weight')}
          />

          {cards.length === 0 ? (
            <Section title="Groups" footer="Start a group for your friends, or join with a code someone sent you.">
              <View style={{ padding: 16, gap: 12 }}>
                <Button label="Create Group" onPress={() => router.push('/groups/new')} />
                <Button label="Join with a Code" secondary onPress={() => router.push('/groups/join')} />
              </View>
            </Section>
          ) : (
            <View style={{ gap: 12 }}>
              <Text style={[ui.heading, { color: c.ink }]}>Today in your groups</Text>
              {cards.map((g) => {
                const s = g.standing;
                const value = s?.value ?? null;
                const noData = value === null;
                const fill = !noData && s!.leader > 0 ? value / s!.leader : 0;
                return (
                  <Pressable
                    key={g.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${g.name}. ${noData ? 'No steps data yet today' : `You are ${s!.rankLabel} of ${s!.members}, ${formatValue('steps', value)} steps`}.`}
                    onPress={() => router.push(`/groups/${g.id}`)}
                    style={({ pressed }) => [styles.card, { backgroundColor: c.surface, opacity: pressed ? 0.8 : 1 }]}
                  >
                    <View style={styles.cardHead}>
                      <Text numberOfLines={1} style={[ui.bodyStrong, { color: c.ink, flex: 1 }]}>
                        {g.name}
                      </Text>
                      <Icon name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} color={c.inkSoft} size={14} />
                    </View>
                    <View style={styles.standing}>
                      <Text style={[styles.rank, { color: noData ? c.inkSoft : (c.medal[Number(s!.rankLabel.replace('T', '')) - 1] ?? c.ink) }]}>
                        {noData ? '-' : s!.rankLabel}
                      </Text>
                      <Text style={[ui.body, { color: c.inkSoft, flex: 1 }]}>of {g.memberCount}</Text>
                      <Text style={[styles.score, { color: noData ? c.inkSoft : c.ink }]}>
                        {noData ? 'No data' : formatValue('steps', value)}
                      </Text>
                    </View>
                    <View style={[styles.lane, { backgroundColor: c.lane }]}>
                      <View style={[styles.lane, { width: `${fill * 100}%`, backgroundColor: c.accent }]} />
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}
        </>
      )}
    </Screen>
  );
}

// Latest-value card for sleep and weight. `when` says which day the value is from, so an old reading never reads as today's.
function MetricCard({ title, icon, value, when, state, onPress }: {
  title: string;
  icon: SymbolViewProps['name'];
  value: string | null;
  when: string | null;
  state: 'ok' | 'empty' | 'error';
  onPress: () => void;
}) {
  const c = useTheme();
  const text = state === 'error' ? "Couldn't load" : (value ?? 'No data');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${when ? `${when}, ` : ''}${text}. Opens My ${title}.`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, { backgroundColor: c.surface, opacity: pressed ? 0.8 : 1 }]}
    >
      <View style={styles.cardHead}>
        <Icon name={icon} color={c.accent} />
        <Text style={[ui.bodyStrong, { color: c.accent, flex: 1 }]}>{title}</Text>
        <Icon name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} color={c.inkSoft} size={14} />
      </View>
      {when && <Text style={[ui.caption, { color: c.inkSoft }]}>{when}</Text>}
      <Text style={[styles.big, { color: state === 'ok' ? c.ink : state === 'error' ? c.danger : c.inkSoft }]}>{text}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, padding: 16, gap: 8 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  big: { fontSize: 34, lineHeight: 41, fontWeight: '800', fontVariant: ['tabular-nums'] },
  standing: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  rank: { fontSize: 28, lineHeight: 34, fontWeight: '800', fontVariant: ['tabular-nums'] },
  score: { fontSize: 22, lineHeight: 28, fontWeight: '800', fontVariant: ['tabular-nums'] },
  lane: { height: 4, borderRadius: 999 },
});
