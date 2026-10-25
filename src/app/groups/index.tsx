import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, Text, View } from 'react-native';

import { Button, ErrorText, Screen, styles } from '@/components/ui';
import { useTheme } from '@/theme';
import { listMyGroups, type MyGroup } from '@/lib/groups';
import { supabase } from '@/lib/supabase';

export default function Groups() {
  const c = useTheme();
  const router = useRouter();
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

  useEffect(() => {
    // Not load(): lint forbids a synchronous setState call in an effect body.
    listMyGroups().then(setGroups, () =>
      setError("Couldn't load your groups. Check your connection and try again."),
    );
  }, []);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const actions = (
    <View style={{ gap: 12 }}>
      <Button label="Create a group" onPress={() => router.push('/groups/new')} />
      <Button label="Join with a code" secondary onPress={() => router.push('/groups/join')} />
      <Button label="My steps" secondary onPress={() => router.push('/steps')} />
      <Button
        label="Sign out"
        plain
        onPress={() =>
          Alert.alert('Sign out?', 'Your groups and steps stay saved.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Sign out', style: 'destructive', onPress: () => supabase.auth.signOut() },
          ])
        }
      />
    </View>
  );

  if (!groups) {
    return (
      <Screen title="Your groups">
        {error ? (
          <>
            <ErrorText>{error}</ErrorText>
            <Button label="Try again" onPress={load} />
          </>
        ) : (
          <ActivityIndicator accessibilityLabel="Loading groups" color={c.accent} />
        )}
      </Screen>
    );
  }

  if (groups.length === 0) {
    return (
      <Screen title="Your groups">
        <Text style={[styles.heading, { color: c.ink }]}>No groups yet</Text>
        <Text style={[styles.body, { color: c.inkSoft }]}>
          Start one for your friends, or join with a code someone sent you.
        </Text>
        {actions}
      </Screen>
    );
  }

  return (
    <Screen title="Your groups" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
      <ErrorText>{error}</ErrorText>
      {groups.map((item) => (
        <Pressable
          key={item.id}
          accessibilityRole="button"
          accessibilityLabel={`${item.name}, ${item.memberCount} ${item.memberCount === 1 ? 'member' : 'members'}`}
          onPress={() => router.push(`/groups/${item.id}`)}
          style={({ pressed }) => ({
            minHeight: 64,
            justifyContent: 'center',
            borderBottomWidth: 1,
            borderBottomColor: c.line,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Text style={[styles.bodyStrong, { color: c.ink }]} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={[styles.caption, { color: c.inkSoft }]}>
            {item.memberCount} {item.memberCount === 1 ? 'member' : 'members'}
            {item.role === 'owner' ? ' \u00b7 Owner' : ''}
          </Text>
        </Pressable>
      ))}
      {actions}
    </Screen>
  );
}
