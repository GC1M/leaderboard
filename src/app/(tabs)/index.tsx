import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { HealthSyncStatus } from '@/components/HealthSyncStatus';
import { WeekChart } from '@/components/steps/WeekChart';
import { Button, ErrorText, Icon, Screen, Section, Skeleton, styles as ui } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { listMyGroups, type MyGroup } from '@/lib/groups';
import { lastNDates, localDateKey } from '@/lib/health/dates';
import type { StepRow } from '@/lib/health/rules';
import { useHealthSync } from '@/lib/health/sync';
import { formatValue, getLeaderboard, myStanding, type Standing } from '@/lib/leaderboard';
import { getMyRecentSteps } from '@/lib/metrics';
import { useTheme } from '@/theme';

type Card = MyGroup & { standing: Standing | null };

export default function Summary() {
  const c = useTheme();
  const router = useRouter();
  const { session } = useAuth();
  const health = useHealthSync();
  const me = session?.user.id ?? '';
  const [steps, setSteps] = useState<StepRow[] | null>(null);
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

const styles = StyleSheet.create({
  card: { borderRadius: 12, padding: 16, gap: 8 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  big: { fontSize: 34, lineHeight: 41, fontWeight: '800', fontVariant: ['tabular-nums'] },
  standing: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  rank: { fontSize: 28, lineHeight: 34, fontWeight: '800', fontVariant: ['tabular-nums'] },
  score: { fontSize: 22, lineHeight: 28, fontWeight: '800', fontVariant: ['tabular-nums'] },
  lane: { height: 4, borderRadius: 999 },
});
