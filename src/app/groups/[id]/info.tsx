import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Share, Text, View } from 'react-native';

import { Button, ErrorText, Field, Row, Screen, Section, Skeleton, styles } from '@/components/ui';
import { alert } from '@/lib/alert';
import { useAuth } from '@/lib/auth';
import {
  deleteGroup,
  deleteMemberManualSteps,
  getMyShares,
  inviteLink,
  isNotMember,
  isValidGroupId,
  leaveGroup,
  listMembers,
  removeMember,
  renameGroup,
  setShare,
  type Member,
  type SharedMetric,
} from '@/lib/groups';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/theme';

type Group = { name: string; invite_code: string; owner_id: string };

const SHARE_ROWS: { metric: SharedMetric; label: string }[] = [
  { metric: 'steps', label: 'Steps' },
  { metric: 'sleep', label: 'Sleep' },
  { metric: 'weight', label: 'Weight' },
  { metric: 'workouts', label: 'Workouts' },
];

export default function GroupInfo() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const me = session?.user.id;
  const c = useTheme();
  const router = useRouter();
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [shares, setShares] = useState<SharedMetric[] | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      if (!isValidGroupId(id)) throw new Error('not a member of this group');
      const [g, m, s] = await Promise.all([
        supabase.from('groups').select('name, invite_code, owner_id').eq('id', id).maybeSingle(),
        listMembers(id),
        getMyShares(id),
      ]);
      if (g.error) throw g.error;
      if (!g.data) throw new Error('not a member of this group');
      setGroup(g.data);
      setName(g.data.name);
      setMembers(m);
      setShares(s);
      setError(null);
    } catch (e) {
      if (isNotMember(e)) {
        // Removed or left elsewhere: nothing here to show any more.
        if (router.canDismiss()) router.dismissAll();
        router.replace({ pathname: '/groups', params: { notice: 'unavailable' } });
        return;
      }
      setError("Couldn't load this group. Check your connection and try again.");
    }
  }, [id, router]);

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

  if (!group || !members || !shares) {
    return (
      <Screen title="Group Info" back>
        {error ? (
          <>
            <ErrorText>{error}</ErrorText>
            <Button label="Try Again" onPress={load} />
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
    alert(m.name, undefined, [
      {
        text: "Delete Today's Manual Steps",
        style: 'destructive',
        onPress: () => act(() => deleteMemberManualSteps(id, m.userId)),
      },
      {
        text: 'Remove from Group',
        style: 'destructive',
        onPress: () =>
          alert(`Remove ${m.name}?`, 'They can join again with the invite code unless you share a new one.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Remove', style: 'destructive', onPress: () => act(() => removeMember(id, m.userId)) },
          ]),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);

  const confirmLeave = () =>
    alert(
      owner ? `Delete ${group.name}?` : `Leave ${group.name}?`,
      owner
        ? "Everyone in it loses this leaderboard. Steps stay in each person's history. This can't be undone."
        : 'You can join again later with the invite code.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: owner ? 'Delete Group' : 'Leave Group',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              await (owner ? deleteGroup(id) : leaveGroup(id));
              // Group info sits on the root stack above the tabs: pop back to the tabs, then show Groups.
              if (router.canDismiss()) router.dismissAll();
              router.replace('/groups');
            } catch (e) {
              setBusy(false);
              setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
            }
          },
        },
      ],
    );

  return (
    <Screen title="Group Info" back>
      <ErrorText>{error}</ErrorText>

      {owner ? (
        <>
          <Field label="Group name" maxLength={60} value={name} onChangeText={setName} returnKeyType="done" helper={`${name.length}/60`} />
          {renamed && <Button label="Save Name" busy={busy} onPress={() => act(() => renameGroup(id, name))} />}
        </>
      ) : (
        <Text style={[styles.heading, { color: c.ink }]}>{group.name}</Text>
      )}

      <Section title="Invite friends" footer="Anyone with this code can join. Only share it with people you trust.">
        <View style={{ padding: 16 }}>
          <Text selectable accessibilityLabel={`Invite code ${code.split('').join(' ')}`} style={[styles.code, { color: c.ink }]}>
            {`${code.slice(0, 4)} ${code.slice(4)}`}
          </Text>
        </View>
        <Row
          label="Share Invite Link"
          icon={{ ios: 'square.and.arrow.up', android: 'share', web: 'share' }}
          action
          onPress={() =>
            Share.share({ message: `Join my group "${group.name}" on Leaderboard: ${inviteLink(code)} (code ${code})` }).catch(() => {})
          }
        />
        <Row
          label={copied ? 'Copied' : 'Copy Code'}
          icon={{ ios: 'doc.on.doc', android: 'content_copy', web: 'content_copy' }}
          action
          last
          onPress={async () => {
            await Clipboard.setStringAsync(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        />
      </Section>

      <Section
        title="What you share with this group"
        footer="Health access on your iPhone decides what this app can read. These switches decide what this group sees, and you can change them any time. Sleep shares nightly totals only. Weight shares your latest reading and goal progress. Workouts share a weekly count and total time only, never exercises, sets or notes."
      >
        {SHARE_ROWS.map(({ metric, label }, i) => {
          const on = shares.includes(metric);
          return (
            <Row
              key={metric}
              label={label}
              value={on ? 'Shared' : 'Not shared'}
              last={i === SHARE_ROWS.length - 1}
              disabled={busy}
              onPress={() => act(() => setShare(id, metric, !on))}
            />
          );
        })}
      </Section>

      <Section title={`${members.length} ${members.length === 1 ? 'member' : 'members'}`} footer={owner ? 'Tap a member to remove them or delete steps they typed in today. Health steps can\'t be deleted.' : undefined}>
        {members.map((m, i) => {
          const manageable = owner && m.userId !== me;
          const tag = [m.userId === me && 'You', m.role === 'owner' && 'Owner'].filter(Boolean).join(', ');
          return (
            <Row
              key={m.userId}
              label={m.name}
              value={tag || undefined}
              last={i === members.length - 1}
              disabled={busy}
              onPress={manageable ? () => memberOptions(m) : undefined}
            />
          );
        })}
      </Section>

      <Section>
        <Row label={owner ? 'Delete Group' : 'Leave Group'} danger last disabled={busy} onPress={confirmLeave} />
      </Section>
    </Screen>
  );
}
