import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text } from 'react-native';

import { Button, ErrorText, Screen, styles } from '@/components/ui';
import { useTheme } from '@/theme';
import { useAuth } from '@/lib/auth';
import { isValidCode, isValidGroupId, joinGroup, normalizeCode, pendingInvite } from '@/lib/groups';

// Deep link landing for leaderboard://join/<CODE>. Never auto-joins.
// The group name isn't readable before joining (RLS), so we confirm with the code only.
export default function JoinByLink() {
  const { session, loading } = useAuth();
  const c = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ code: string; competition?: string }>();
  const code = normalizeCode(String(params.code ?? ''));
  const competition = typeof params.competition === 'string' && isValidGroupId(params.competition) ? params.competition : '';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!loading && !session && isValidCode(code)) { pendingInvite.code = code; pendingInvite.competition = competition; }
  }, [loading, session, code, competition]);

  const leave = () => (router.canGoBack() ? router.back() : router.replace('/'));

  if (!isValidCode(code)) {
    return (
      <Screen title="Invalid Invite Link">
        <Text style={[styles.body, { color: c.inkSoft }]}>
          This link doesn&apos;t hold a valid invite code. Ask whoever invited you to send it again.
        </Text>
        <Button label="Enter a Code Instead" onPress={() => router.replace('/groups/join')} />
      </Screen>
    );
  }

  if (loading) return null;
  if (!session) return <Redirect href={{ pathname: '/sign-in', params: { code, ...(competition ? { competition } : {}) } }} />;

  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      const groupId = await joinGroup(code);
      router.replace(competition ? `/groups/${groupId}/competitions/${competition}` : `/groups/${groupId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
      setBusy(false);
    }
  };

  return (
    <Screen title={`Join with code ${code.slice(0, 4)} ${code.slice(4)}?`}>
      <Text style={[styles.body, { color: c.inkSoft }]}>You&apos;ll be added to the group that code belongs to. Your steps are shared with it; sleep, weight, workouts, food and water stay private unless you turn them on in Group Info.</Text>
      {competition && <Text style={[styles.body, { color: c.inkSoft }]}>After joining the group, you can review the competition rules and choose whether to enroll. Joining this group does not enroll you.</Text>}
      <ErrorText>{error}</ErrorText>
      <Button label="Join Group" busy={busy} onPress={join} />
      <Button label="Not Now" secondary disabled={busy} onPress={leave} />
    </Screen>
  );
}
