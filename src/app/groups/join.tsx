import { useRouter } from 'expo-router';
import { useState } from 'react';

import { Button, Field, Screen } from '@/components/ui';
import { isValidCode, joinGroup, normalizeCode } from '@/lib/groups';

export default function JoinGroup() {
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
    <Screen title="Join a Group" back>
      <Field
        label="Invite code"
        code={8}
        autoFocus
        autoCapitalize="characters"
        autoCorrect={false}
        returnKeyType="done"
        value={code}
        // Limit after normalizing so a pasted "K74M-Q29X" still fits.
        onChangeText={(t) => {
          setCode(normalizeCode(t).slice(0, 8));
          setError(null);
        }}
        onSubmitEditing={submit}
        placeholder="K74MQ29X"
        helper="8 characters, no I, O, 0 or 1. Paste works too. Joining shares your steps with the group; sleep and weight stay private unless you turn them on in Group Info."
        error={error}
      />
      <Button label="Join Group" busy={busy} disabled={!isValidCode(code)} onPress={submit} />
    </Screen>
  );
}
