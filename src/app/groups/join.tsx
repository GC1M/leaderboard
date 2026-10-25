import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Text, TextInput } from 'react-native';

import { Button, ErrorText, Screen, styles, useColors } from '@/components/groups/ui';
import { isValidCode, joinGroup, normalizeCode } from '@/lib/groups';

export default function JoinGroup() {
  const c = useColors();
  const router = useRouter();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (busy || !isValidCode(code)) return;
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
    <Screen title="Join a group" back>
      <Text style={[styles.bodyStrong, { color: c.ink }]}>Invite code</Text>
      <TextInput
        accessibilityLabel="Invite code"
        autoFocus
        autoCapitalize="characters"
        autoCorrect={false}
        returnKeyType="done"
        value={code}
        // Limit after normalizing so a pasted "K74M-Q29X" still fits.
        onChangeText={(t) => setCode(normalizeCode(t).slice(0, 8))}
        onSubmitEditing={submit}
        placeholder="K74MQ29X"
        placeholderTextColor={c.inkSoft}
        style={[
          styles.code,
          { minHeight: 56, borderWidth: 1, borderColor: c.border, borderRadius: 8, padding: 12, color: c.ink, backgroundColor: c.surface },
        ]}
      />
      <Text style={[styles.caption, { color: c.inkSoft }]}>8 characters, no I, O, 0 or 1. Paste works too.</Text>
      <ErrorText>{error}</ErrorText>
      <Button label="Join group" busy={busy} disabled={!isValidCode(code)} onPress={submit} />
    </Screen>
  );
}
