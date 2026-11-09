import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl, Text } from 'react-native';
import { Button, ErrorText, Row, Screen, Section, Skeleton, styles } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { competitionState, getMyCompetitions, type GroupCompetition } from '@/lib/competitions';
import { useCompetitionClock } from '@/lib/competition-clock';
import { useTheme } from '@/theme';
const groups = [['Active', 'Active'], ['Upcoming', 'Upcoming'], ['Finished', null]] as const;
// Every competition in your groups, grouped by state. Joining still happens on each competition's own screen.
export default function Compete() {
  const router = useRouter(); const c = useTheme(); const now = useCompetitionClock(); const uid = useAuth().session?.user.id ?? '';
  const [rows, setRows] = useState<GroupCompetition[] | null>(null); const [error, setError] = useState<string | null>(null);
  const [tries, setTries] = useState(0); const [refreshing, setRefreshing] = useState(false);
  useFocusEffect(useCallback(() => {
    let live = true;
    void getMyCompetitions(uid).then((r) => { if (live) { setRows(r); setError(null); setRefreshing(false); } }, () => { if (live) { setError('Couldn’t load competitions. Pull down to try again.'); setRefreshing(false); } });
    return () => { live = false; };
  }, [uid, tries]));
  const state = (r: GroupCompetition) => competitionState(r, now);
  return <Screen title="Compete" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); setTries((v) => v + 1); }} />}>
    <ErrorText>{error}</ErrorText>
    {rows === null ? !error && <Skeleton label="Loading competitions" /> : !rows.length ? <>
      <Text style={[styles.body, { color: c.inkSoft }]}>No competitions yet. Open a group to create one, then choose whether to join it.</Text>
      <Button secondary label="Go to Groups" onPress={() => router.navigate('/groups')} />
    </> : groups.map(([title, match]) => {
      const list = rows.filter((r) => (match ? state(r) === match : state(r) !== 'Active' && state(r) !== 'Upcoming'));
      return list.length ? <Section key={title} title={title}>
        {list.map((r, i) => <Row key={r.id} label={r.name} value={[r.groups?.name, r.joined ? 'Joined' : match ? null : state(r)].filter(Boolean).join(', ')} last={i === list.length - 1} onPress={() => router.push(`/compete/${r.group_id}/${r.id}`)} />)}
      </Section> : null;
    })}
  </Screen>;
}
