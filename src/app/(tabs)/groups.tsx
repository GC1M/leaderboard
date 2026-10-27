import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl, Text, View } from 'react-native';

import { Button, ErrorText, Row, Screen, Section, Skeleton, styles } from '@/components/ui';
import { useTheme } from '@/theme';
import { listMyGroups, type MyGroup } from '@/lib/groups';

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
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setGroups(await listMyGroups());
      setError(null);
    } catch {
      setError("Couldn't load your groups. Check your connection and try again.");
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

  const actions = (
    <Section>
      <Row label="Create Group" icon={{ ios: 'plus.circle', android: 'add_circle', web: 'add_circle' }} action onPress={() => router.push('/groups/new')} />
      <Row label="Join with a Code" icon={{ ios: 'qrcode', android: 'qr_code', web: 'qr_code' }} action last onPress={() => router.push('/groups/join')} />
    </Section>
  );

  if (!groups) {
    return (
      <Screen title="Groups">
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
    <Screen title="Groups" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
      {unavailable}
      <ErrorText>{error}</ErrorText>
      {groups.length === 0 ? (
        <View style={{ gap: 4 }}>
          <Text style={[styles.heading, { color: c.ink }]}>No groups yet</Text>
          <Text style={[styles.body, { color: c.inkSoft }]}>Start one for your friends, or join with a code someone sent you.</Text>
        </View>
      ) : (
        <Section>
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
    </Screen>
  );
}
