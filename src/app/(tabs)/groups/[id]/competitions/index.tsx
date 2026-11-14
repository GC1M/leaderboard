import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text } from 'react-native';
import { Segmented } from '@/components/history/Segmented';
import { Button, ErrorText, Row, Screen, Section, Skeleton, styles } from '@/components/ui';
import { competitionState, getCompetitions, type Competition } from '@/lib/competitions';
import { useCompetitionClock } from '@/lib/competition-clock';
import { useTheme } from '@/theme';
export default function Competitions() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter(); const c = useTheme(); const now = useCompetitionClock();
  const [filter, setFilter] = useState<'all' | 'active' | 'upcoming' | 'completed'>('all');
  const [rows, setRows] = useState<Competition[] | null>(null); const [error, setError] = useState<string | null>(null); const [tries, setTries] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- retries intentionally refetch the same resource
  useFocusEffect(useCallback(() => { let live = true; void getCompetitions(id).then((r) => { if (live) { setRows(r); setError(null); } }, (e) => live && setError(e.message)); return () => { live = false; }; }, [id, tries]));
  const visible = (rows ?? []).filter((r) => {
    const state = competitionState(r, now);
    return filter === 'all' || (filter === 'active' ? state === 'Active' : filter === 'upcoming' ? state === 'Upcoming' : state !== 'Active' && state !== 'Upcoming');
  });
  // Relative, so the list opened from Summary's copy of the group stays in that stack.
  const open = (path: string) => router.push(`./${path}`, { relativeToDirectory: true });
  return <Screen title="Competitions" back>
    <Button label="Create Competition" onPress={() => open('new')} />
    <Button plain label="Refresh Competitions" onPress={() => setTries((v) => v + 1)} />
    {!!rows?.length && <Segmented label="Competition status" options={[{ value: 'all', label: 'All' }, { value: 'active', label: 'Active' }, { value: 'upcoming', label: 'Upcoming' }, { value: 'completed', label: 'Completed' }] as const} value={filter} onChange={setFilter} />}
    {error ? <><ErrorText>{error}</ErrorText><Button plain label="Try Again" onPress={() => setTries((v) => v + 1)} /></> : rows === null ? <Skeleton label="Loading competitions" /> : !rows.length ? <Text style={[styles.body, { color: c.inkSoft }]}>No competitions yet. Create a challenge, then choose whether to join it.</Text> : !visible.length ? <Text style={[styles.body, { color: c.inkSoft }]}>No competitions match this status. Choose another filter.</Text> : <Section>{visible.map((row, i) => <Row key={row.id} label={row.name} value={competitionState(row, now)} last={i === visible.length - 1} onPress={() => open(row.id)} />)}</Section>}
  </Screen>;
}
