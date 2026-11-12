import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text } from 'react-native';

import { ErrorText, Row, Screen, Section, Skeleton, styles } from '@/components/ui';
import { listFriends, listPeopleToAdd, sendFriendRequest, type Person } from '@/lib/social';
import { useTheme } from '@/theme';

export default function AddFriend() {
  const c = useTheme();
  const [people, setPeople] = useState<Person[] | null>(null);
  const [sent, setSent] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setPeople(await listPeopleToAdd(await listFriends()));
      setError(null);
    } catch {
      setError("Couldn't load people. Check your connection and try again.");
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const add = async (p: Person) => {
    try {
      await sendFriendRequest(p.userId);
      setSent((s) => new Set(s).add(p.userId));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Screen title="Add Friends" back>
      <ErrorText>{error}</ErrorText>
      {!people ? (
        !error && <Skeleton label="Loading people" />
      ) : people.length === 0 ? (
        <Text style={[styles.body, { color: c.inkSoft }]}>Everyone in your groups is already a friend or has a request. Join a group to meet more people.</Text>
      ) : (
        <Section title="From your groups" footer="They get a request and can accept or decline.">
          {people.map((p, i) => (
            <Row
              key={p.userId}
              label={p.name}
              value={sent.has(p.userId) ? 'Requested' : 'Add'}
              action
              disabled={sent.has(p.userId)}
              last={i === people.length - 1}
              onPress={() => void add(p)}
            />
          ))}
        </Section>
      )}
    </Screen>
  );
}
