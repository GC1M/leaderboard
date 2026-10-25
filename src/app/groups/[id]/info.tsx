import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, Share, Text, View } from 'react-native';

import { Button, ErrorText, Field, Screen, Skeleton, styles } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import {
  deleteGroup,
  deleteMemberSteps,
  inviteLink,
  leaveGroup,
  listMembers,
  removeMember,
  renameGroup,
  type Member,
} from '@/lib/groups';
import { localDateKey } from '@/lib/health/dates';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/theme';

type Group = { name: string; invite_code: string; owner_id: string };

export default function GroupInfo() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const me = session?.user.id;
  const c = useTheme();
  const router = useRouter();
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const [g, m] = await Promise.all([
        supabase.from('groups').select('name, invite_code, owner_id').eq('id', id).single(),
        listMembers(id),
      ]);
      if (g.error) throw g.error;
      setGroup(g.data);
      setName(g.data.name);
      setMembers(m);
      setError(null);
    } catch {
      setError("Couldn't load this group. Check your connection and try again.");
    }
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount
    void load();
  }, [load]);

  // Runs an action, shows its error inline, reloads on success.
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (!group || !members) {
    return (
      <Screen title="Group info" back>
        {error ? (
          <>
            <ErrorText>{error}</ErrorText>
            <Button label="Try again" onPress={load} />
          </>
        ) : (
          <Skeleton label="Loading group" />
        )}
      </Screen>
    );
  }

  const owner = group.owner_id === me;
  const code = group.invite_code;
  const renamed = name.trim() !== group.name && name.trim().length > 0;

  const memberOptions = (m: Member) =>
    Alert.alert(m.name, undefined, [
      {
        text: "Delete today's steps",
        style: 'destructive',
        onPress: () => act(() => deleteMemberSteps(id, m.userId, localDateKey(new Date()))),
      },
      {
        text: 'Remove from group',
        style: 'destructive',
        onPress: () =>
          Alert.alert(`Remove ${m.name}?`, 'They can join again with the invite code unless you share a new one.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Remove', style: 'destructive', onPress: () => act(() => removeMember(id, m.userId)) },
          ]),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);

  const confirmLeave = () =>
    Alert.alert(
      owner ? `Delete ${group.name}?` : `Leave ${group.name}?`,
      owner
        ? "Everyone in it loses this leaderboard. Steps stay in each person's history. This can't be undone."
        : 'You can join again later with the invite code.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: owner ? 'Delete group' : 'Leave group',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              await (owner ? deleteGroup(id) : leaveGroup(id));
              router.dismissTo('/groups');
            } catch (e) {
              setBusy(false);
              setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
            }
          },
        },
      ],
    );

  return (
    <Screen title="Group info" back>
      <ErrorText>{error}</ErrorText>

      {owner ? (
        <>
          <Field label="Group name" maxLength={60} value={name} onChangeText={setName} returnKeyType="done" helper={`${name.length}/60`} />
          {renamed && <Button label="Save name" busy={busy} onPress={() => act(() => renameGroup(id, name))} />}
        </>
      ) : (
        <Text style={[styles.heading, { color: c.ink }]}>{group.name}</Text>
      )}

      <View style={{ gap: 8 }}>
        <Text style={[styles.heading, { color: c.ink }]}>Invite friends</Text>
        <Text selectable accessibilityLabel={`Invite code ${code.split('').join(' ')}`} style={[styles.code, { color: c.ink }]}>
          {`${code.slice(0, 4)} ${code.slice(4)}`}
        </Text>
        <Button
          label="Share invite link"
          onPress={() =>
            Share.share({ message: `Join my group "${group.name}" on Leaderboard: ${inviteLink(code)} (code ${code})` }).catch(() => {})
          }
        />
        <Button
          label={copied ? 'Copied' : 'Copy code'}
          secondary
          onPress={async () => {
            await Clipboard.setStringAsync(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        />
      </View>

      <View>
        <Text style={[styles.heading, { color: c.ink, marginBottom: 8 }]}>
          {members.length} {members.length === 1 ? 'member' : 'members'}
        </Text>
        {members.map((m) => {
          const manageable = owner && m.userId !== me;
          const tag = [m.userId === me && 'You', m.role === 'owner' && 'Owner'].filter(Boolean).join(', ');
          return (
            <Pressable
              key={m.userId}
              disabled={!manageable || busy}
              accessibilityRole={manageable ? 'button' : undefined}
              accessibilityLabel={`${m.name}${tag ? `, ${tag}` : ''}`}
              accessibilityHint={manageable ? 'Opens options to delete their steps or remove them' : undefined}
              onPress={() => memberOptions(m)}
              style={({ pressed }) => ({
                minHeight: 52,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderBottomWidth: 1,
                borderBottomColor: c.line,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text numberOfLines={1} style={[styles.bodyStrong, { color: c.ink, flexShrink: 1 }]}>
                {m.name}
              </Text>
              <Text style={[styles.caption, { color: manageable ? c.accent : c.inkSoft }]}>{manageable ? 'Manage' : tag}</Text>
            </Pressable>
          );
        })}
      </View>

      <Button plain danger busy={busy} label={owner ? 'Delete group' : 'Leave group'} onPress={confirmLeave} />
    </Screen>
  );
}
