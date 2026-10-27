import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text } from 'react-native';

import { Button, ErrorText, Screen, styles } from '@/components/ui';
import { useTheme } from '@/theme';
import { useAuth } from '@/lib/auth';
import { isValidCode, joinGroup, normalizeCode, pendingInvite } from '@/lib/groups';

// Deep link landing for leaderboard://join/<CODE>. Never auto-joins.
// The group name isn't readable before joining (RLS), so we confirm with the code only.
export default function JoinByLink() {
  const { session, loading } = useAuth();
  const c = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ code: string }>();
  const code = normalizeCode(String(params.code ?? ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!loading && !session && isValidCode(code)) pendingInvite.code = code;
  }, [loading, session, code]);

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
  if (!session) return <Redirect href={{ pathname: '/sign-in', params: { code } }} />;

  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      router.replace(`/groups/${await joinGroup(code)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
      setBusy(false);
    }
  };

  return (
    <Screen title={`Join with code ${code.slice(0, 4)} ${code.slice(4)}?`}>
      <Text style={[styles.body, { color: c.inkSoft }]}>You&apos;ll be added to the group that code belongs to. Your steps are shared with it; sleep and weight stay private unless you turn them on in Group Info.</Text>
      <ErrorText>{error}</ErrorText>
      <Button label="Join Group" busy={busy} onPress={join} />
      <Button label="Not Now" secondary disabled={busy} onPress={leave} />
    </Screen>
  );
}
