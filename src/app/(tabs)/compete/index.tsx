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
    if (!uid) { setRefreshing(false); return; }
    void getMyCompetitions(uid).then((r) => { if (live) { setRows(r); setError(null); setRefreshing(false); } }, () => { if (live) { setError('Couldn’t load competitions.'); setRefreshing(false); } });
    return () => { live = false; };
  }, [uid, tries]));
  const state = (r: GroupCompetition) => competitionState(r, now);
  const count = (ms: number, unit: string) => { const d = Math.max(1, Math.ceil(ms / 86_400_000)); return `${d} ${unit}${d === 1 ? '' : 's'}`; };
  // What each row needs you to know: how long is left, when it starts, or how it ended.
  const when = (r: GroupCompetition, match: string | null) => match === 'Active' ? `${count(Date.parse(r.ends_at) - now.getTime(), 'day')} left` : match === 'Upcoming' ? `Starts in ${count(Date.parse(r.starts_at) - now.getTime(), 'day')}` : state(r);
  // Ending soonest, then starting soonest, then most recently finished.
  const order = (match: string | null) => (a: GroupCompetition, b: GroupCompetition) => match === 'Upcoming' ? Date.parse(a.starts_at) - Date.parse(b.starts_at) : match ? Date.parse(a.ends_at) - Date.parse(b.ends_at) : Date.parse(b.ends_at) - Date.parse(a.ends_at);
  return <Screen title="Compete" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); setTries((v) => v + 1); }} />}>
    <ErrorText>{error}</ErrorText>{error && <Button plain label="Try Again" onPress={() => setTries((v) => v + 1)} />}
    <Button label="New Competition" onPress={() => router.push('/compete/new')} />
    {rows === null ? !error && <Skeleton label="Loading competitions" /> : !rows.length ? <>
      <Text style={[styles.body, { color: c.inkSoft }]}>No competitions in your groups yet. Create one for a group, or join a group first.</Text>
      <Button secondary label="Go to Social" onPress={() => router.navigate('/groups')} />
    </> : groups.map(([title, match]) => {
      const list = rows.filter((r) => (match ? state(r) === match : state(r) !== 'Active' && state(r) !== 'Upcoming')).sort(order(match));
      return list.length ? <Section key={title} title={title}>
        {list.map((r, i) => <Row wrap key={r.id} label={r.name} value={[r.groups?.name, when(r, match), r.joined ? 'Joined' : (match === 'Upcoming' || (match === 'Active' && r.late_joins)) && 'Not joined'].filter(Boolean).join(', ')} last={i === list.length - 1} onPress={() => router.push(`/compete/${r.group_id}/${r.id}`)} />)}
      </Section> : null;
    })}
  </Screen>;
}
