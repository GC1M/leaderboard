import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text } from 'react-native';
import { Button, ErrorText, Row, Screen, Section, Skeleton, styles } from '@/components/ui';
import { competitionState, getCompetitions, type Competition } from '@/lib/competitions';
import { useCompetitionClock } from '@/lib/competition-clock';
import { useTheme } from '@/theme';
export default function Competitions() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter(); const c = useTheme(); const now = useCompetitionClock();
  const [rows, setRows] = useState<Competition[] | null>(null); const [error, setError] = useState<string | null>(null); const [tries, setTries] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- retries intentionally refetch the same resource
  useFocusEffect(useCallback(() => { let live = true; void getCompetitions(id).then((r) => { if (live) { setRows(r); setError(null); } }, (e) => live && setError(e.message)); return () => { live = false; }; }, [id, tries]));
  return <Screen title="Competitions" back>
    <Button label="Create Competition" onPress={() => router.push(`/groups/${id}/competitions/new`)} />
    {error ? <><ErrorText>{error}</ErrorText><Button plain label="Try Again" onPress={() => setTries((v) => v + 1)} /></> : rows === null ? <Skeleton label="Loading competitions" /> : !rows.length ? <Text style={[styles.body, { color: c.inkSoft }]}>No competitions yet. Create a challenge, then choose whether to join it.</Text> : <Section>{rows.map((row, i) => <Row key={row.id} label={row.name} value={competitionState(row, now)} last={i === rows.length - 1} onPress={() => router.push(`/groups/${id}/competitions/${row.id}`)} />)}</Section>}
  </Screen>;
}
