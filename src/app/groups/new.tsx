import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Share, Text } from 'react-native';

import { Button, Field, Screen, styles } from '@/components/ui';
import { useTheme } from '@/theme';
import { createGroup, inviteLink, type CreatedGroup } from '@/lib/groups';

export default function NewGroup() {
  const c = useTheme();
  const router = useRouter();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedGroup | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = async () => {
    if (busy || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setCreated(await createGroup(name));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the group. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (created) {
    const { inviteCode, name: groupName, id } = created;
    return (
      <Screen title={`Invite friends to ${groupName}`}>
        <Text
          selectable
          accessibilityLabel={`Invite code ${inviteCode.split('').join(' ')}`}
          style={[styles.code, { color: c.ink, textAlign: 'center' }]}
        >
          {`${inviteCode.slice(0, 4)} ${inviteCode.slice(4)}`}
        </Text>
        <Button
          label={copied ? 'Copied' : 'Copy code'}
          secondary
          onPress={async () => {
            await Clipboard.setStringAsync(inviteCode);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        />
        <Button
          label="Share invite link"
          onPress={() =>
            // Include the plain code: a custom scheme isn't clickable in every messenger.
            Share.share({
              message: `Join my group "${groupName}" on Leaderboard: ${inviteLink(inviteCode)} (code ${inviteCode})`,
            }).catch(() => {})
          }
        />
        <Text style={[styles.caption, { color: c.inkSoft }]}>
          Anyone with this code can join. Only share it with people you trust.
        </Text>
        <Button label="Done" secondary onPress={() => router.replace(`/groups/${id}`)} />
      </Screen>
    );
  }

  return (
    <Screen title="New group" back>
      <Field
        label="Group name"
        autoFocus
        maxLength={60}
        returnKeyType="done"
        value={name}
        onChangeText={setName}
        onSubmitEditing={submit}
        placeholder="Office steps"
        helper={`${name.length}/60. Friends see this name when they join.`}
        error={error}
      />
      <Button label="Create group" busy={busy} disabled={!name.trim()} onPress={submit} />
    </Screen>
  );
}
