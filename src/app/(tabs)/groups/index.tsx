import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl, Text, View } from 'react-native';

import { Button, ErrorText, Row, Screen, Section, Skeleton, styles } from '@/components/ui';
import { useTheme } from '@/theme';
import { alert } from '@/lib/alert';
import { listMyGroups, type MyGroup } from '@/lib/groups';
import { acceptFriendRequest, listFriends, removeFriend, type Friend } from '@/lib/social';

// Groups and friends together. The route stays /groups so existing links and deep links keep working.
export default function Groups() {
  const c = useTheme();
  const router = useRouter();
  const { notice } = useLocalSearchParams<{ notice?: string }>();
  const unavailable = notice === 'unavailable' ? (
    <View style={{ gap: 8 }}>
      <Text accessibilityLiveRegion="polite" style={[styles.body, { color: c.inkSoft }]}>This group is unavailable. You may no longer be a member, or it may have been deleted.</Text>
      <Button plain label="Dismiss Notice" onPress={() => router.setParams({ notice: undefined })} />
    </View>
  ) : null;
  const [groups, setGroups] = useState<MyGroup[] | null>(null);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [g, f] = await Promise.all([listMyGroups(), listFriends()]);
      setGroups(g);
      setFriends(f);
      setError(null);
    } catch {
      setError("Couldn't load your groups and friends. Check your connection and try again.");
    }
  }, []);

  // Reload on focus so a group deleted, left or renamed elsewhere is reflected on return.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const respond = (f: Friend) => {
    const act = (fn: () => Promise<void>) => () => void fn().then(load, (e: Error) => setError(e.message));
    if (f.status === 'incoming') {
      alert(`${f.name} wants to be friends`, 'Friends can message each other.', [
        { text: 'Decline', style: 'destructive', onPress: act(() => removeFriend(f.userId)) },
        { text: 'Accept', onPress: act(() => acceptFriendRequest(f.userId)) },
      ]);
    } else {
      alert(`Cancel your request to ${f.name}?`, undefined, [
        { text: 'Keep', style: 'cancel' },
        { text: 'Cancel Request', style: 'destructive', onPress: act(() => removeFriend(f.userId)) },
      ]);
    }
  };
  // Requests waiting on you first, then friends, then requests you sent.
  const order = { incoming: 0, friend: 1, outgoing: 2 };
  const people = [...friends].sort((a, b) => order[a.status] - order[b.status]);
  const friendsSection = (
    <Section title="Friends">
      {people.map((f) => (
        <Row
          key={f.userId}
          label={f.name}
          value={f.status === 'incoming' ? 'Wants to be friends' : f.status === 'outgoing' ? 'Requested' : 'Message'}
          onPress={() => (f.status === 'friend' ? router.push(`/groups/chat?friend=${f.userId}`) : respond(f))}
        />
      ))}
      <Row label="Add Friends" icon={{ ios: 'person.badge.plus', android: 'person_add', web: 'person_add' }} action last onPress={() => router.push('/groups/add-friend')} />
    </Section>
  );

  const actions = (
    <Section>
      <Row label="Create Group" icon={{ ios: 'plus.circle', android: 'add_circle', web: 'add_circle' }} action onPress={() => router.push('/groups/new')} />
      <Row label="Join with a Code" icon={{ ios: 'qrcode', android: 'qr_code', web: 'qr_code' }} action last onPress={() => router.push('/groups/join')} />
    </Section>
  );

  if (!groups) {
    return (
      <Screen title="Social">
        {unavailable}
        {error ? (
          <>
            <ErrorText>{error}</ErrorText>
            <Button label="Try Again" onPress={load} />
          </>
        ) : (
          <Skeleton label="Loading groups" />
        )}
      </Screen>
    );
  }

  return (
    <Screen title="Social" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
      {unavailable}
      <ErrorText>{error}</ErrorText>
      {groups.length === 0 ? (
        <View style={{ gap: 4 }}>
          <Text style={[styles.heading, { color: c.ink }]}>No groups yet</Text>
          <Text style={[styles.body, { color: c.inkSoft }]}>Start one for your friends, or join with a code someone sent you.</Text>
        </View>
      ) : (
        <Section title="Groups">
          {groups.map((g, i) => (
            <Row
              key={g.id}
              label={g.name}
              value={`${g.memberCount} ${g.memberCount === 1 ? 'member' : 'members'}${g.role === 'owner' ? ', owner' : ''}`}
              last={i === groups.length - 1}
              onPress={() => router.push(`/groups/${g.id}`)}
            />
          ))}
        </Section>
      )}
      {actions}
      {friendsSection}
    </Screen>
  );
}
