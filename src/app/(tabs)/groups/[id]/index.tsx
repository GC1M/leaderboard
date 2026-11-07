import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { FlatList, Platform, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, ErrorText, Skeleton, styles as ui, useLargeText } from '@/components/ui';
import { LeaderboardRowView } from '@/components/leaderboard/LeaderboardRowView';
import { MemberSummaries } from '@/components/leaderboard/MemberSummaries';
import { useAuth } from '@/lib/auth';
import { buildMemberSummaries, type MemberSummary } from '@/lib/group-summaries';
import { getGroupFood, getGroupShares, getGroupSleep, getGroupWeights, getGroupWorkouts, isNotMember, isValidGroupId, listMembers } from '@/lib/groups';
import { useWeightUnit } from '@/lib/weight-unit';
import {
  formatValue,
  getLeaderboard,
  getManualDays,
  hasNoData,
  leaderValue,
  rankLabels,
  sourceLabel,
  type LeaderboardRow,
  type Metric,
  type Period,
} from '@/lib/leaderboard';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/theme';

// Metric picker comes later; the screen is already parameterised on it.
const METRIC: Metric = 'steps';
const PERIODS: { key: Period; label: string }[] = [
  { key: 'day', label: 'Today' },
  { key: 'week', label: 'This Week' },
];

type Group = { name: string };

export default function GroupDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const c = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const large = useLargeText();
  const [group, setGroup] = useState<Group | null>(null);
  const [period, setPeriod] = useState<Period>('day');
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [manual, setManual] = useState<Record<string, number>>({});
  const [summaries, setSummaries] = useState<MemberSummary[] | null>(null);
  const [unit] = useWeightUnit();
  const [visible, setVisible] = useState<string[] | null>(null);
  const list = useRef<FlatList<LeaderboardRow>>(null);
  const focused = useRef(false);
  const me = session?.user.id;

  const load = useCallback(
    () =>
      Promise.resolve().then(() => {
        if (!isValidGroupId(id)) throw new Error('not a member of this group');
        return Promise.all([supabase.from('groups').select('name').eq('id', id).maybeSingle(), getLeaderboard(id, METRIC, period)]);
      })
        .then(([g, r]) => {
          if (g.error) throw g.error;
          if (!g.data) throw new Error('not a member of this group');
          setGroup(g.data);
          setRows(r);
          setError(null);
          // Source captions are extra; a failure here shouldn't hide the board.
          return Promise.all([
            getManualDays(id, period).then(setManual, () => setManual({})),
            // Same for the sleep, weight, workout and food summaries, except that losing access must leave the screen.
            Promise.all([listMembers(id), getGroupShares(id), getGroupSleep(id), getGroupWeights(id), getGroupWorkouts(id), getGroupFood(id)]).then(
              ([m, sh, sl, w, wo, fo]) => setSummaries(buildMemberSummaries(m, sh, sl, w, wo, fo)),
              (e) => {
                if (isNotMember(e)) throw e;
                setSummaries(null);
              },
            ),
          ]);
        })
        .catch((e) => {
          // Removed or left: don't keep showing the group's data.
          // Only while on screen: from underneath Group Info it would replace that route instead. The next focus redirects.
          if (isNotMember(e)) {
            if (focused.current) {
              setGroup(null);
              setRows(null);
              setSummaries(null);
              router.replace({ pathname: '/groups', params: { notice: 'unavailable' } });
            }
            return;
          }
          setError("Couldn't load the leaderboard. Pull down to try again.");
        }),
    [id, period, router],
  );

  // Also reloads when coming back from group info, which can rename the group or remove members.
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      load();
      return () => {
        focused.current = false;
      };
    }, [load]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const labels = rows ? rankLabels(rows) : [];
  const ranked = rows ? rows.filter((r) => !hasNoData(r)).length : 0;
  const leader = rows ? leaderValue(rows) : 0;
  const youIndex = rows ? rows.findIndex((r) => r.userId === me) : -1;
  const you = youIndex >= 0 ? rows![youIndex] : null;

  // FlatList needs a stable function here.
  const onViewable = useCallback(
    ({ viewableItems }: { viewableItems: { item: LeaderboardRow }[] }) => setVisible(viewableItems.map((v) => v.item.userId)),
    [],
  );

  // Scrolls with the list, so at large text sizes it doesn't squeeze the rows into a strip.
  const head = (
    <View style={styles.head}>
      <Text accessibilityRole="header" numberOfLines={large ? undefined : 2} maxFontSizeMultiplier={1.5} style={[ui.title, { color: c.ink }]}>
        {group?.name ?? ' '}
      </Text>
      <View style={[styles.toggle, { backgroundColor: c.surface, borderColor: c.border }]} accessibilityRole="tablist">
        {PERIODS.map((p) => {
          const on = period === p.key;
          return (
            <Pressable
              key={p.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${p.label} leaderboard`}
              onPress={() => {
                if (on) return;
                setRows(null);
                setPeriod(p.key);
              }}
              style={[styles.tab, on && { backgroundColor: c.accent }]}
            >
              <Text style={[ui.bodyStrong, { color: on ? c.onAccent : c.ink }]}>{p.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {rows && (
        <Text style={[ui.caption, { color: c.inkSoft }]}>
          {rows.length} member{rows.length === 1 ? '' : 's'}
        </Text>
      )}
    </View>
  );

  return (
    <View style={[{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top }, Platform.OS === 'web' && ui.webWidth]}>
      <View style={styles.header}>
        <Button plain label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
        <Button plain label="Competitions" onPress={() => router.push(`/groups/${id}/competitions`)} />
        <Button plain label="Group Info" onPress={() => router.push(`/groups/${id}/info`)} />
      </View>
      {!rows && <View style={{ paddingHorizontal: 16 }}>{head}</View>}
      {error && !rows ? (
        <View style={styles.center}>
          <ErrorText>{error}</ErrorText>
          <Button label="Try Again" onPress={load} />
        </View>
      ) : !rows ? (
        <View style={{ paddingHorizontal: 16 }}>
          <Skeleton label="Loading leaderboard" />
        </View>
      ) : (
        <FlatList
          ref={list}
          data={rows}
          onViewableItemsChanged={onViewable}
          viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
          onScrollToIndexFailed={() => {}}
          keyExtractor={(r) => r.userId}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 16 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListHeaderComponent={
            <>
              {head}
              {error && <ErrorText>{error}</ErrorText>}
            </>
          }
          ListEmptyComponent={<Text style={[ui.body, styles.empty, { color: c.inkSoft }]}>No members yet.</Text>}
          ListFooterComponent={
            <>
              {rows.length > 0 && ranked === 0 ? (
                <Text style={[ui.body, styles.empty, { color: c.inkSoft }]}>
                  No steps recorded {period === 'day' ? 'today' : 'this week'} yet.
                </Text>
              ) : null}
              {summaries && <MemberSummaries items={summaries} me={me} unit={unit} />}
            </>
          }
          renderItem={({ item, index }) => (
            <LeaderboardRowView
              row={item}
              rankLabel={labels[index]}
              metric={METRIC}
              isYou={item.userId === me}
              leader={leader}
              source={sourceLabel(period, manual[item.userId] ?? 0, item.state)}
            />
          )}
        />
      )}
      {you && visible && !visible.includes(you.userId) && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`You are ${hasNoData(you) ? 'unranked' : `rank ${labels[youIndex]}`}. Show your row.`}
          onPress={() => list.current?.scrollToIndex({ index: youIndex, viewPosition: 0.5 })}
          style={[styles.youBar, { backgroundColor: c.youTint, borderTopColor: c.line, paddingBottom: insets.bottom + 12 }]}
        >
          {/* Capped so the shortcut bar can't cover the rows; the row itself still scales fully. */}
          <Text maxFontSizeMultiplier={1.5} style={[ui.bodyStrong, { color: c.ink }]}>
            You: {you.value === null ? 'no data yet' : `${labels[youIndex]}, ${formatValue(METRIC, you.value)}`}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', paddingHorizontal: 16 },
  head: { paddingBottom: 12, gap: 12 },
  toggle: { flexDirection: 'row', flexWrap: 'wrap', maxWidth: '100%', borderWidth: 1, borderRadius: 999, padding: 2, alignSelf: 'flex-start' },
  tab: { minHeight: 44, minWidth: 96, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, borderRadius: 999 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  empty: { textAlign: 'center', padding: 24 },
  youBar: { paddingTop: 12, paddingHorizontal: 16, borderTopWidth: StyleSheet.hairlineWidth },
});
