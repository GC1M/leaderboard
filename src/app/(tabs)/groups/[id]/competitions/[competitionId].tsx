import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Share, Text } from 'react-native';
import { Button, ErrorText, Row, Screen, Section, Skeleton, styles } from '@/components/ui';
import { CompetitionIntegrity } from '@/components/competitions/Integrity';
import { CompetitionStandings } from '@/components/competitions/Standings';
import { alert } from '@/lib/alert';
import { useAuth } from '@/lib/auth';
import { competitionDay, competitionInviteLink, competitionState, getCompetition, getCompetitionStandings, finalizeCompetition, getParticipation, type CompetitionStanding, joinCompetition, leaveCompetition, type Competition, type Participation } from '@/lib/competitions';
import { useCompetitionClock } from '@/lib/competition-clock';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/theme';
export default function CompetitionDetail() {
  const { id, competitionId } = useLocalSearchParams<{ id: string; competitionId: string }>(); const uid = useAuth().session?.user.id ?? ''; const c = useTheme(); const now = useCompetitionClock();
  const [standings, setStandings] = useState<CompetitionStanding[] | null>(null);
  const [refreshed, setRefreshed] = useState<Date | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [row, setRow] = useState<Competition | null>(); const [participation, setParticipation] = useState<Participation | null>(null);
  const [error, setError] = useState<string | null>(null); const [tries, setTries] = useState(0); const [busy, setBusy] = useState(false); const lock = useRef(false);
  useFocusEffect(useCallback(() => {
    let live = true; let revision = 0; setRow(undefined); setStandings(null);
    const refresh = () => {
      const request = ++revision;
      void Promise.all([getCompetition(competitionId), getParticipation(competitionId, uid), getCompetitionStandings(competitionId)]).then(([r, p, scores]) => {
        if (live && request === revision) { setRow(r?.group_id === id ? r : null); setParticipation(p); setStandings(scores); setRefreshed(new Date()); setError(null); }
      }, (e) => { if (live && request === revision) setError(e.message); });
    };
    refresh();
    const timer = setInterval(refresh, 30_000);
    return () => { live = false; clearInterval(timer); };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- retries intentionally refetch the same resource
  }, [competitionId, id, uid, tries]));
  const act = async (fn: () => Promise<unknown>) => { if (lock.current) return; lock.current = true; setBusy(true); setError(null); try { await fn(); setTries((v) => v + 1); } catch (e) { setError((e as Error).message); } finally { lock.current = false; setBusy(false); } };
  const invite = async () => { const { data, error: failure } = await supabase.from('groups').select('invite_code').eq('id', id).single(); if (failure) throw failure; await Share.share({ message: `Join ${row?.name}: ${competitionInviteLink(data.invite_code, competitionId)}` }); };
  const joined = participation?.status === 'joined';
  return <Screen title={row?.name ?? 'Competition'} back>
    <ErrorText>{error}</ErrorText>{error && <Button plain label="Try Again" onPress={() => setTries((v) => v + 1)} />}
    {row === undefined ? !error && <Skeleton label="Loading competition" /> : !row ? <ErrorText>This competition is unavailable.</ErrorText> : <>
      <Section><Row label="Status" value={competitionState(row, now)} /><Row label="Metric" value="Steps" /><Row label="First day" value={competitionDay(row.starts_at, row.timezone)} /><Row label="Last day" value={competitionDay(new Date(Date.parse(row.ends_at) - 1).toISOString(), row.timezone)} /><Row label="Timezone" value={row.timezone} /><Row label="Sources" value={row.include_manual ? 'Health and manual entries' : 'Health entries only'} last /></Section>
      <Text style={[styles.body, { color: c.inkSoft }]}>Joining shares your eligible step total, rank, source counts and data freshness with current group members. Your step-sharing switch must stay on, and your profile timezone must be {row.timezone}. Join before the first day begins; you can leave until the competition ends.</Text>
      <Button plain label={showRules ? 'Hide Competition Rules' : 'Competition Rules and Privacy'} onPress={() => setShowRules((v) => !v)} />
      {showRules && <Section title={`Scoring rules · version ${row.scoring_version}`}>
        <Row wrap label="Scoring period" value={`Whole calendar days in ${row.timezone}, including the first day and all of the last day shown. Daylight saving changes can make a day shorter or longer.`} />
        <Row wrap label="Scores and ties" value="Eligible entries are summed on the server. Missing readings are unranked; a recorded zero counts. Equal totals share a rank, with gaps afterward: 1, 1, 3." />
        <Row wrap label="Uploads and corrections" value="Uploads, edits and deletions count until explicit finalization. A participant, creator or group owner can finalize at least 24 hours after the end. Final scores then freeze, including after later source deletions." />
        <Row wrap label="Privacy and consent" value="Turning off step sharing hides your score, rank, source counts and freshness even in final results. Leaving the group ends participation; returning does not enroll you again. Your detailed contribution view is private to you." />
        <Row wrap label="Moderation" value="The creator or current group owner can cancel before the end, or remove a participant before finalization, with a reason. Group members see these actions and generic source-change activity. Review flags never change your original measurements." last />
      </Section>}
      {row.status === 'scheduled' && now.getTime() < Date.parse(row.starts_at) && !joined && participation?.status !== 'removed' && <Button label="Join Competition" busy={busy} onPress={() => void act(() => joinCompetition(competitionId))} />}
      {row.status === 'scheduled' && joined && now.getTime() < Date.parse(row.ends_at) && <Button secondary label="Leave Competition" disabled={busy} onPress={() => alert('Leave this competition?', 'You can rejoin only before it starts. You will be removed from its standings.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Leave', style: 'destructive', onPress: () => void act(() => leaveCompetition(competitionId)) }])} />}
      {row.status === 'scheduled' && now.getTime() < Date.parse(row.starts_at) && <Button secondary label="Share Competition Invite" disabled={busy} onPress={() => void act(invite)} />}
      {row.status !== 'cancelled' && <>
        <Button secondary label="Refresh Standings" disabled={busy} onPress={() => setTries((v) => v + 1)} />
        {refreshed && <Text style={[styles.caption, { color: c.inkSoft }]}>Standings refreshed {refreshed.toLocaleTimeString()}</Text>}
        {standings !== null && <CompetitionStandings rows={standings} metric={row.metric} uid={uid} />}
        {row.status === 'finalized' ? <Text style={[styles.body, { color: c.inkSoft }]}>Finalized {new Date(row.finalized_at!).toLocaleString()}. Later corrections do not change these scores. Privacy choices still apply.</Text> : <Text style={[styles.body, { color: c.inkSoft }]}>Provisional: uploads and corrections count until someone finalizes the results.</Text>}
        {row.status === 'scheduled' && now.getTime() >= Date.parse(row.ends_at) && (joined || row.creator_id === uid) && <>
          <Button label="Finalize Results" busy={busy} disabled={now.getTime() < Date.parse(row.ends_at) + 86_400_000} onPress={() => alert('Finalize these results?', 'This freezes the current server scores. Later uploads, edits and deletions will not change them. Sharing can still be revoked.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Finalize', onPress: () => void act(() => finalizeCompetition(competitionId)) }])} />
          {now.getTime() < Date.parse(row.ends_at) + 86_400_000 && <Text style={[styles.caption, { color: c.inkSoft }]}>Available {new Date(Date.parse(row.ends_at) + 86_400_000).toLocaleString()}.</Text>}
        </>}
      </>}
      <CompetitionIntegrity competition={row} uid={uid} onChanged={() => setTries((v) => v + 1)} />
      {participation && <Text style={[styles.caption, { color: c.inkSoft }]}>Your participation: {participation.status}</Text>}
    </>}
  </Screen>;
}
