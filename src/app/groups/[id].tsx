import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, ErrorText, Skeleton, styles as ui } from '@/components/ui';
import { LeaderboardRowView } from '@/components/leaderboard/LeaderboardRowView';
import { useAuth } from '@/lib/auth';
import {
  formatValue,
  getLeaderboard,
  getManualDays,
  hasNoData,
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
  { key: 'week', label: 'This week' },
];

type Group = { name: string; invite_code: string };

export default function GroupDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const c = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [group, setGroup] = useState<Group | null>(null);
  const [period, setPeriod] = useState<Period>('day');
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [manual, setManual] = useState<Record<string, number>>({});
  const [visible, setVisible] = useState<string[] | null>(null);
  const list = useRef<FlatList<LeaderboardRow>>(null);
  const me = session?.user.id;

  const load = useCallback(
    () =>
      Promise.all([supabase.from('groups').select('name, invite_code').eq('id', id).single(), getLeaderboard(id, METRIC, period)])
        .then(([g, r]) => {
          if (g.error) throw g.error;
          setGroup(g.data);
          setRows(r);
          setError(null);
          // Source captions are extra; a failure here shouldn't hide the board.
          return getManualDays(r.map((x) => x.userId), METRIC, period).then(setManual, () => setManual({}));
        })
        .catch(() => setError("Couldn't load the leaderboard. Pull down to try again.")),
    [id, period],
  );

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const showCode = () =>
    group &&
    Alert.alert('Invite code', group.invite_code, [
      {
        text: 'Share',
        onPress: () => Share.share({ message: `Join ${group.name} on Leaderboard with code ${group.invite_code}` }),
      },
      { text: 'Close', style: 'cancel' },
    ]);

  const labels = rows ? rankLabels(rows) : [];
  const ranked = rows ? rows.filter((r) => !hasNoData(r)).length : 0;
  const leader = rows ? Math.max(0, ...rows.map((r) => r.value)) : 0;
  const youIndex = rows ? rows.findIndex((r) => r.userId === me) : -1;
  const you = youIndex >= 0 ? rows![youIndex] : null;

  // FlatList needs a stable function here.
  const onViewable = useCallback(
    ({ viewableItems }: { viewableItems: { item: LeaderboardRow }[] }) => setVisible(viewableItems.map((v) => v.item.userId)),
    [],
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top }}>
      <View style={styles.header}>
        <Button plain label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
        <Button plain label="Invite" disabled={!group} onPress={showCode} />
      </View>
      <View style={styles.head}>
        <Text accessibilityRole="header" numberOfLines={2} style={[ui.title, { color: c.ink }]}>
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
      {error && !rows ? (
        <View style={styles.center}>
          <ErrorText>{error}</ErrorText>
          <Button label="Try again" onPress={load} />
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
          ListHeaderComponent={error ? <ErrorText>{error}</ErrorText> : undefined}
          ListEmptyComponent={<Text style={[ui.body, styles.empty, { color: c.inkSoft }]}>No members yet.</Text>}
          ListFooterComponent={
            rows.length > 0 && ranked === 0 ? (
              <Text style={[ui.body, styles.empty, { color: c.inkSoft }]}>
                No steps recorded {period === 'day' ? 'today' : 'this week'} yet.
              </Text>
            ) : undefined
          }
          renderItem={({ item, index }) => (
            <LeaderboardRowView
              row={item}
              rankLabel={labels[index]}
              metric={METRIC}
              isYou={item.userId === me}
              leader={leader}
              source={sourceLabel(period, manual[item.userId] ?? 0, hasNoData(item))}
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
          <Text style={[ui.bodyStrong, { color: c.ink }]}>
            You: {hasNoData(you) ? 'no data yet' : `${labels[youIndex]}, ${formatValue(METRIC, you.value)}`}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16 },
  head: { paddingHorizontal: 16, paddingBottom: 12, gap: 12 },
  toggle: { flexDirection: 'row', borderWidth: 1, borderRadius: 999, padding: 2, alignSelf: 'flex-start' },
  tab: { minHeight: 44, minWidth: 96, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, borderRadius: 999 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  empty: { textAlign: 'center', padding: 24 },
  youBar: { paddingTop: 12, paddingHorizontal: 16, borderTopWidth: StyleSheet.hairlineWidth },
});
