import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, ErrorText, styles as ui } from '@/components/ui';
import { LeaderboardRowView } from '@/components/leaderboard/LeaderboardRowView';
import { useAuth } from '@/lib/auth';
import { getLeaderboard, hasNoData, rankLabels, type LeaderboardRow, type Metric, type Period } from '@/lib/leaderboard';
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

  const load = useCallback(
    () =>
      Promise.all([supabase.from('groups').select('name, invite_code').eq('id', id).single(), getLeaderboard(id, METRIC, period)])
        .then(([g, r]) => {
          if (g.error) throw g.error;
          setGroup(g.data);
          setRows(r);
          setError(null);
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
        <View style={styles.center}>
          <ActivityIndicator accessibilityLabel="Loading leaderboard" color={c.accent} />
        </View>
      ) : (
        <FlatList
          data={rows}
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
              isYou={item.userId === session?.user.id}
              leader={leader}
            />
          )}
        />
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
});
