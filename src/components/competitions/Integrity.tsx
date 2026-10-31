import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Text } from 'react-native';
import { Button, ErrorText, Field, Row, Section, styles } from '@/components/ui';
import { alert } from '@/lib/alert';
import { useCompetitionClock } from '@/lib/competition-clock';
import { contributionReason, finalizeCompetition, getCompetitionAudit, getCompetitionParticipants, getMyContributions, moderateCompetition, type Competition } from '@/lib/competitions';
import { listMembers, type Member } from '@/lib/groups';
import { dateFromKey } from '@/lib/health/format';
import { useTheme } from '@/theme';
type Audit = NonNullable<Awaited<ReturnType<typeof getCompetitionAudit>>>;
type Contributions = NonNullable<Awaited<ReturnType<typeof getMyContributions>>>;
type Participants = NonNullable<Awaited<ReturnType<typeof getCompetitionParticipants>>>;
export function CompetitionIntegrity({ competition, uid, onChanged }: { competition: Competition; uid: string; onChanged: () => void }) {
  const c = useTheme(); const now = useCompetitionClock();
  const [members, setMembers] = useState<Member[]>([]); const [audit, setAudit] = useState<Audit>([]); const [records, setRecords] = useState<Contributions>([]); const [participants, setParticipants] = useState<Participants>([]);
  const [reason, setReason] = useState(''); const [showRecords, setShowRecords] = useState(false); const [showAudit, setShowAudit] = useState(false);
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [revision, setRevision] = useState(0); const lock = useRef(false);
  useFocusEffect(useCallback(() => {
    let live = true; let request = 0;
    const refresh = () => {
      const current = ++request;
      void Promise.all([listMembers(competition.group_id), getCompetitionAudit(competition.id), getMyContributions(competition.id), getCompetitionParticipants(competition.id)]).then(([m, a, r, p]) => { if (live && current === request) { setMembers(m); setAudit(a ?? []); setRecords(r ?? []); setParticipants(p ?? []); setError(null); } }, (e) => { if (live && current === request) setError(e.message); });
    };
    refresh(); const timer = setInterval(refresh, 30_000);
    return () => { live = false; clearInterval(timer); };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- manual retries refetch the same competition
  }, [competition.id, competition.group_id, revision]));
  const owner = members.some((m) => m.userId === uid && m.role === 'owner');
  const canModerate = competition.creator_id === uid || owner;
  const active = participants.filter((p) => p.status === 'joined');
  const name = (id: string | null) => id === uid ? 'You' : members.find((m) => m.userId === id)?.name ?? 'Former member';
  const act = async (fn: () => Promise<unknown>) => {
    if (lock.current) return; lock.current = true; setBusy(true); setError(null);
    try { await fn(); setRevision((v) => v + 1); onChanged(); } catch (e) { setError((e as Error).message); } finally { lock.current = false; setBusy(false); }
  };
  const confirm = (action: 'cancel' | 'remove', userId?: string) => {
    if (!reason.trim()) return setError('Enter a reason. It will be visible in the activity log.');
    alert(action === 'cancel' ? 'Cancel this competition?' : `Remove ${name(userId ?? null)}?`, 'The action and reason will be recorded. Original health measurements are kept.', [
      { text: 'Keep', style: 'cancel' }, { text: action === 'cancel' ? 'Cancel Competition' : 'Remove Participant', style: 'destructive', onPress: () => void act(() => moderateCompetition(competition.id, action, reason, userId)) },
    ]);
  };
  return <>
    <ErrorText>{error}</ErrorText>{error && <Button plain label="Retry Competition Details" onPress={() => setRevision((v) => v + 1)} />}
    <Button plain label={showRecords ? 'Hide My Contributions' : 'My Contributions'} onPress={() => setShowRecords((v) => !v)} />
    {showRecords && <>
      <Text style={[styles.caption, { color: c.inkSoft }]}>Your current source records only. Finalized scores stay frozen. Flags ask for review and never change a measurement.</Text>
      {!records.length ? <Text style={[styles.body, { color: c.inkSoft }]}>No source records in this scoring period.</Text> : <Section title="Your contributions">{records.map((r) => <Row wrap key={r.record_id} label={`${dateFromKey(r.measured_on).toLocaleDateString()} · ${r.value} ${competition.metric === 'steps' ? 'steps' : competition.metric === 'workout_count' ? 'workouts' : 'seconds'}`} value={`${r.source} · ${contributionReason(r.reason)}${r.flagged ? ' · Unusually high reading: review' : ''}`} />)}</Section>}
    </>}
    <Button plain label={showAudit ? 'Hide Activity Log' : 'Activity Log'} onPress={() => setShowAudit((v) => !v)} />
    {showAudit && <Section title="Activity log" footer="Actions recorded since competition auditing was enabled. No raw health measurements are stored in this log.">{audit.length ? audit.map((a, i) => <Row wrap key={a.id} label={`${a.event} · ${a.actor_id ? name(a.actor_id) : 'System or former member'}${a.target_id ? ` → ${name(a.target_id)}` : ''}`} value={`${new Date(a.created_at).toLocaleString()}${a.reason ? ` · ${a.reason}` : ''}`} last={i === audit.length - 1} />) : <Row label="No recorded actions" last />}</Section>}
    {canModerate && competition.status === 'scheduled' && <>
      <Field label="Moderation reason" helper="Required for cancellation or removal; shown in the activity log." value={reason} onChangeText={setReason} maxLength={500} />
      <Button secondary danger label="Cancel Competition" disabled={busy} onPress={() => confirm('cancel')} />
      {!!active.length && <Section title="Manage participants">{active.map((p, i) => <Row key={p.user_id} label={`Remove ${name(p.user_id)}`} danger disabled={busy} last={i === active.length - 1} onPress={() => confirm('remove', p.user_id)} />)}</Section>}
      {owner && competition.creator_id !== uid && !active.some((p) => p.user_id === uid) && now.getTime() >= Date.parse(competition.ends_at) + 86_400_000 && <Button label="Finalize Results" busy={busy} onPress={() => alert('Finalize results?', 'This freezes the current server scores.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Finalize', onPress: () => void act(() => finalizeCompetition(competition.id)) }])} />}
    </>}
  </>;
}
