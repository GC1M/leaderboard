import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Share, Text } from 'react-native';
import { Button, ErrorText, Row, Screen, Section, Skeleton, styles } from '@/components/ui';
import { alert } from '@/lib/alert';
import { useAuth } from '@/lib/auth';
import { competitionDay, competitionInviteLink, competitionState, getCompetition, getParticipation, joinCompetition, leaveCompetition, type Competition, type Participation } from '@/lib/competitions';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/theme';
export default function CompetitionDetail() {
  const { id, competitionId } = useLocalSearchParams<{ id: string; competitionId: string }>(); const uid = useAuth().session?.user.id ?? ''; const c = useTheme();
  const [row, setRow] = useState<Competition | null>(); const [participation, setParticipation] = useState<Participation | null>(null);
  const [error, setError] = useState<string | null>(null); const [tries, setTries] = useState(0); const [busy, setBusy] = useState(false); const lock = useRef(false);
  useFocusEffect(useCallback(() => {
    let live = true;
    void Promise.all([getCompetition(competitionId), getParticipation(competitionId, uid)]).then(([r, p]) => { if (live) { setRow(r?.group_id === id ? r : null); setParticipation(p); setError(null); } }, (e) => live && setError(e.message));
    return () => { live = false; };
  }, [competitionId, id, uid, tries]));
  const act = async (fn: () => Promise<unknown>) => { if (lock.current) return; lock.current = true; setBusy(true); setError(null); try { await fn(); setTries((v) => v + 1); } catch (e) { setError((e as Error).message); } finally { lock.current = false; setBusy(false); } };
  const invite = async () => { const { data, error: failure } = await supabase.from('groups').select('invite_code').eq('id', id).single(); if (failure) throw failure; await Share.share({ message: `Join ${row?.name}: ${competitionInviteLink(data.invite_code, competitionId)}` }); };
  const joined = participation?.status === 'joined';
  return <Screen title={row?.name ?? 'Competition'} back>
    <ErrorText>{error}</ErrorText>{error && <Button plain label="Try Again" onPress={() => setTries((v) => v + 1)} />}
    {row === undefined ? !error && <Skeleton label="Loading competition" /> : !row ? <ErrorText>This competition is unavailable.</ErrorText> : <>
      <Section><Row label="Status" value={competitionState(row)} /><Row label="Metric" value="Steps" /><Row label="First day" value={competitionDay(row.starts_at, row.timezone)} /><Row label="Last day" value={competitionDay(new Date(Date.parse(row.ends_at) - 1).toISOString(), row.timezone)} /><Row label="Timezone" value={row.timezone} /><Row label="Sources" value={row.include_manual ? 'Health and manual entries' : 'Health entries only'} last /></Section>
      <Text style={[styles.body, { color: c.inkSoft }]}>Joining shares your eligible step total and rank with current group members. Your step-sharing switch must stay on. Everyone must use {row.timezone}. Missing readings are unranked; ties share a rank. Results stay provisional until explicit finalization, at least 24 hours after the end.</Text>
      {row.status === 'scheduled' && Date.now() < Date.parse(row.starts_at) && !joined && participation?.status !== 'removed' && <Button label="Join Competition" busy={busy} onPress={() => void act(() => joinCompetition(competitionId))} />}
      {row.status === 'scheduled' && joined && Date.now() < Date.parse(row.ends_at) && <Button secondary label="Leave Competition" disabled={busy} onPress={() => alert('Leave this competition?', 'You can rejoin only before it starts. You will be removed from its standings.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Leave', style: 'destructive', onPress: () => void act(() => leaveCompetition(competitionId)) }])} />}
      {row.status === 'scheduled' && Date.now() < Date.parse(row.starts_at) && <Button secondary label="Share Competition Invite" disabled={busy} onPress={() => void act(invite)} />}
      {participation && <Text style={[styles.caption, { color: c.inkSoft }]}>Your participation: {participation.status}</Text>}
    </>}
  </Screen>;
}
