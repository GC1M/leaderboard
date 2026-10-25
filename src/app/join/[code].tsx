import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';

import { Button, ErrorText, Screen, styles } from '@/components/ui';
import { useTheme } from '@/theme';
import { isValidCode, joinGroup, normalizeCode } from '@/lib/groups';

// Deep link landing for leaderboard://join/<CODE>. Never auto-joins.
// The group name isn't readable before joining (RLS), so we confirm with the code only.
export default function JoinByLink() {
  const c = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ code: string }>();
  const code = normalizeCode(String(params.code ?? ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const leave = () => (router.canGoBack() ? router.back() : router.replace('/'));

  if (!isValidCode(code)) {
    return (
      <Screen title="Invalid invite link">
        <Text style={[styles.body, { color: c.inkSoft }]}>
          This link doesn&apos;t hold a valid invite code. Ask whoever invited you to send it again.
        </Text>
        <Button label="Enter a code instead" onPress={() => router.replace('/groups/join')} />
      </Screen>
    );
  }

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
      <Text style={[styles.body, { color: c.inkSoft }]}>You&apos;ll be added to the group that code belongs to.</Text>
      <ErrorText>{error}</ErrorText>
      <Button label="Join group" busy={busy} onPress={join} />
      <Button label="Not now" secondary disabled={busy} onPress={leave} />
    </Screen>
  );
}
