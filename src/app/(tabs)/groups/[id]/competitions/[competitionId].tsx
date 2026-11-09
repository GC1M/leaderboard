import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { RefreshControl, Share, Text } from 'react-native';
import { Button, Card, ErrorText, Row, Screen, Section, Skeleton, styles } from '@/components/ui';
import { DailyStepsCard } from '@/components/competitions/DailySteps';
import { CompetitionIntegrity, confirmFinalize } from '@/components/competitions/Integrity';
import { CompetitionStandings, GapHighlight } from '@/components/competitions/Standings';
import { alert } from '@/lib/alert';
import { useAuth } from '@/lib/auth';
import { competitionDay, competitionDays, competitionInviteLink, competitionState, dailySteps, getCompetition, getCompetitionStandings, getMyContributions, finalizeCompetition, getParticipation, rivalPace, type CompetitionStanding, joinCompetition, leaveCompetition, type Competition, type Participation } from '@/lib/competitions';
import { useCompetitionClock } from '@/lib/competition-clock';
import { dateInZone } from '@/lib/health/dates';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/theme';
type Contributions = NonNullable<Awaited<ReturnType<typeof getMyContributions>>>;
const DAY = 86_400_000;
export default function CompetitionDetail() {
  const { id, competitionId } = useLocalSearchParams<{ id: string; competitionId: string }>(); const uid = useAuth().session?.user.id ?? ''; const c = useTheme(); const now = useCompetitionClock();
  const [standings, setStandings] = useState<CompetitionStanding[] | null>(null); const [records, setRecords] = useState<Contributions | null>(null);
  const [refreshed, setRefreshed] = useState<Date | null>(null); const [refreshing, setRefreshing] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [row, setRow] = useState<Competition | null>(); const [participation, setParticipation] = useState<Participation | null>(null);
  const [error, setError] = useState<string | null>(null); const [tries, setTries] = useState(0); const [busy, setBusy] = useState(false); const lock = useRef(false); const seen = useRef(competitionId);
  useFocusEffect(useCallback(() => {
    let live = true; let revision = 0; setRow((r) => (r?.id === competitionId ? r : undefined));
    // A reused screen must not show the previous competition's private entries.
    if (seen.current !== competitionId) { seen.current = competitionId; setRecords(null); setParticipation(null); }
    const refresh = () => {
      const request = ++revision;
      // Your own entries only feed the private steps card, so a failure there never blocks the standings; the card keeps its last good data or stays hidden.
      void Promise.all([getCompetition(competitionId), getParticipation(competitionId, uid), getCompetitionStandings(competitionId), getMyContributions(competitionId).catch(() => null)]).then(([r, p, scores, mine]) => {
        if (live && request === revision) { setRow(r?.group_id === id ? r : null); setParticipation(p); setStandings(scores); setRecords((prev) => mine ?? prev); setRefreshed(new Date()); setError(null); setRefreshing(false); }
      }, () => { if (live && request === revision) { setError('Couldn’t load this competition. Pull down to try again.'); setRefreshing(false); } });
    };
    refresh();
    const timer = setInterval(refresh, 30_000);
    return () => { live = false; clearInterval(timer); };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- retries intentionally refetch the same resource
  }, [competitionId, id, uid, tries]));
  const act = async (fn: () => Promise<unknown>) => { if (lock.current) return; lock.current = true; setBusy(true); setError(null); try { await fn(); setTries((v) => v + 1); } catch (e) { setError((e as Error).message); } finally { lock.current = false; setBusy(false); } };
  const invite = async () => { const { data, error: failure } = await supabase.from('groups').select('invite_code').eq('id', id).single(); if (failure) throw failure; await Share.share({ message: `Join ${row?.name}: ${competitionInviteLink(data.invite_code, competitionId)}` }); };
  const joined = participation?.status === 'joined';
  const pull = () => { setRefreshing(true); setTries((v) => v + 1); };
  const body = () => {
    if (!row) return null;
    const t = now.getTime(); const start = Date.parse(row.starts_at); const end = Date.parse(row.ends_at);
    const upcoming = row.status === 'scheduled' && t < start; const ended = row.status === 'scheduled' && t >= end;
    const days = competitionDays(row); const today = dateInZone(new Date(Math.min(t, end - 1)), row.timezone);
    const elapsed = days.filter((d) => d <= today).length;
    const status = row.status === 'scheduled' && t >= start && t < end ? `Day ${elapsed} of ${days.length}, ends ${competitionDay(new Date(end - 1).toISOString(), row.timezone)}`
      : upcoming ? `Starts ${competitionDay(row.starts_at, row.timezone)}, ${days.length} ${days.length === 1 ? 'day' : 'days'}` : competitionState(row, now);
    const finalizeAt = end + DAY;
    return <>
      <Text style={[styles.bodyStrong, { color: c.accent, marginTop: -8 }]}>{status}</Text>
      {row.status === 'cancelled' && <Card icon={{ ios: 'xmark.circle', android: 'cancel', web: 'cancel' }} label="Cancelled" color={c.danger}><Text style={[styles.body, { color: c.ink }]}>This competition was cancelled, so there are no standings. The activity log below shows who cancelled it and why.</Text></Card>}
      {upcoming && !joined && participation?.status !== 'removed' && <Card icon={{ ios: 'figure.walk', android: 'directions_walk', web: 'directions_walk' }} label="Steps competition" color={c.steps}>
        <Text style={[styles.body, { color: c.ink }]}>{competitionDay(row.starts_at, row.timezone)} to {competitionDay(new Date(end - 1).toISOString(), row.timezone)}</Text>
        <Text style={[styles.caption, { color: c.inkSoft }]}>Group members will see your step total, rank, entry sources and data freshness. Keep step sharing on and your profile timezone set to {row.timezone}. Join before the first day; you can leave until it ends.</Text>
        <Button label="Join Competition" busy={busy} onPress={() => void act(() => joinCompetition(competitionId))} />
      </Card>}
      {upcoming && joined && <Card icon={{ ios: 'checkmark.circle', android: 'check_circle', web: 'check_circle' }} label="You're in" color={c.accent}>
        <Text style={[styles.body, { color: c.ink }]}>Starts {competitionDay(row.starts_at, row.timezone)}. Your steps count from the first day.</Text>
        <Button secondary label="Share Competition Invite" disabled={busy} onPress={() => void act(invite)} />
      </Card>}
      {upcoming && !joined && <Button secondary label="Share Competition Invite" disabled={busy} onPress={() => void act(invite)} />}
      {ended && <Card icon={{ ios: 'hourglass', android: 'hourglass_empty', web: 'hourglass_empty' }} label="Provisional results" color={c.inkSoft}>
        <Text style={[styles.body, { color: c.ink }]}>Scores can still change until someone finalizes them.</Text>
        {(joined || row.creator_id === uid) && (t >= finalizeAt
          ? <Button label="Finalize Results" busy={busy} onPress={() => confirmFinalize(() => void act(() => finalizeCompetition(competitionId)))} />
          : <Text style={[styles.caption, { color: c.inkSoft }]}>You can finalize after {new Date(finalizeAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}.</Text>)}
      </Card>}
      {row.status !== 'cancelled' && standings !== null && <>
        {!upcoming && <GapHighlight rows={standings} metric={row.metric} uid={uid} />}
        <CompetitionStandings rows={standings} metric={row.metric} uid={uid} final={row.status === 'finalized'} now={now} meta={refreshed ? `updated ${refreshed.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : undefined} />
        {row.status === 'finalized' && <Text style={[styles.caption, { color: c.inkSoft }]}>Finalized {new Date(row.finalized_at!).toLocaleString()}. Later corrections do not change these scores. Privacy choices still apply.</Text>}
        {!upcoming && joined && records && <DailyStepsCard days={dailySteps(days, records, today)} today={today} live={t < end} pace={rivalPace(standings, uid, elapsed)} />}
      </>}
      <Section title="Details">
        <Row label="First day" value={competitionDay(row.starts_at, row.timezone)} />
        <Row label="Last day" value={competitionDay(new Date(end - 1).toISOString(), row.timezone)} />
        <Row label="Timezone" value={row.timezone} />
        <Row label="Sources" value={row.include_manual ? 'Health and manual entries' : 'Health entries only'} />
        <Row action label={showRules ? 'Hide rules and privacy' : 'Rules and privacy'} onPress={() => setShowRules((v) => !v)} last />
      </Section>
      {showRules && <Section title={`Scoring rules, version ${row.scoring_version}`}>
        <Row wrap label="Scoring period" value={`Whole calendar days in ${row.timezone}, including the first day and all of the last day shown. Daylight saving changes can make a day shorter or longer.`} />
        <Row wrap label="Scores and ties" value="Eligible entries are summed on the server. Missing readings are unranked; a recorded zero counts. Equal totals share a rank, with gaps afterward: 1, 1, 3." />
        <Row wrap label="Uploads and corrections" value="Uploads, edits and deletions count until explicit finalization. A participant, creator or group owner can finalize at least 24 hours after the end. Final scores then freeze, including after later source deletions." />
        <Row wrap label="Privacy and consent" value="Turning off step sharing hides your score, rank, source counts and freshness even in final results. Leaving the group ends participation; returning does not enroll you again. Your detailed contribution view is private to you." />
        <Row wrap label="Moderation" value="The creator or current group owner can cancel before the end, or remove a participant before finalization, with a reason. Group members see these actions and generic source-change activity. Review flags never change your original measurements." last />
      </Section>}
      <CompetitionIntegrity competition={row} uid={uid} onChanged={() => setTries((v) => v + 1)} />
      {row.status === 'scheduled' && joined && t < end && <Section>
        <Row danger label="Leave Competition" disabled={busy} onPress={() => alert('Leave this competition?', 'You can rejoin only before it starts. You will be removed from its standings.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Leave', style: 'destructive', onPress: () => void act(() => leaveCompetition(competitionId)) }])} last />
      </Section>}
    </>;
  };
  return <Screen title={row?.name ?? 'Competition'} back refreshControl={<RefreshControl refreshing={refreshing} onRefresh={pull} />}>
    <ErrorText>{error}</ErrorText>
    {row === undefined ? !error && <Skeleton label="Loading competition" /> : !row ? <ErrorText>This competition is unavailable.</ErrorText> : body()}
  </Screen>;
}
