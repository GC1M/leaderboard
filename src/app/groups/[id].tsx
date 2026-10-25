import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Button,
  FlatList,
  Pressable,
  RefreshControl,
  Share,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from 'react-native';

import { LeaderboardRowView } from '@/components/leaderboard/LeaderboardRowView';
import { useAuth } from '@/lib/auth';
import { getLeaderboard, hasNoData, rankLabels, type LeaderboardRow, type Metric, type Period } from '@/lib/leaderboard';
import { supabase } from '@/lib/supabase';

// Metric picker comes later; the screen is already parameterised on it.
const METRIC: Metric = 'steps';
const PERIODS: { key: Period; label: string }[] = [
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
];

type Group = { name: string; invite_code: string };

export default function GroupDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const dark = useColorScheme() === 'dark';
  const fg = dark ? '#fff' : '#111';
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
        .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the leaderboard')),
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

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: true, title: group?.name ?? 'Group' }} />
      <View style={styles.bar}>
        <View style={styles.toggle} accessibilityRole="tablist">
          {PERIODS.map((p) => (
            <Pressable
              key={p.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: period === p.key }}
              accessibilityLabel={`${p.label} leaderboard`}
              onPress={() => {
                setRows(null);
                setPeriod(p.key);
              }}
              style={[styles.tab, period === p.key && styles.tabOn]}
            >
              <Text style={{ color: period === p.key ? '#fff' : fg, fontWeight: '600' }}>{p.label}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={{ color: fg }}>{rows ? `${rows.length} member${rows.length === 1 ? '' : 's'}` : ''}</Text>
        <Button title="Invite code" onPress={showCode} disabled={!group} accessibilityLabel="Show invite code" />
      </View>
      {error && !rows ? (
        <View style={styles.center}>
          <Text style={{ color: fg }}>{error}</Text>
          <Button title="Retry" onPress={load} />
        </View>
      ) : !rows ? (
        <View style={styles.center}>
          <ActivityIndicator accessibilityLabel="Loading leaderboard" />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.userId}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListHeaderComponent={error ? <Text style={styles.err}>Refresh failed: {error}</Text> : undefined}
          ListEmptyComponent={<Text style={[styles.empty, { color: fg }]}>No members yet.</Text>}
          ListFooterComponent={
            rows.length > 0 && ranked === 0 ? (
              <Text style={[styles.empty, { color: fg }]}>No steps recorded this {period} yet.</Text>
            ) : undefined
          }
          renderItem={({ item, index }) => (
            <LeaderboardRowView row={item} rankLabel={labels[index]} metric={METRIC} isYou={item.userId === session?.user.id} />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, gap: 8 },
  toggle: { flexDirection: 'row', borderWidth: 1, borderColor: '#999', borderRadius: 8, overflow: 'hidden' },
  tab: { minHeight: 44, minWidth: 64, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  tabOn: { backgroundColor: '#2563eb' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  empty: { textAlign: 'center', padding: 24 },
  err: { color: '#dc2626', padding: 16 },
});
