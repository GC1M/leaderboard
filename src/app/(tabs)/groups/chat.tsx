import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { BottomTabBarHeightContext } from 'expo-router/js-tabs';
import { useCallback, useContext, useMemo, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, ErrorText, Field, Screen, Skeleton, glass, styles as ui } from '@/components/ui';
import { alert } from '@/lib/alert';
import { useAuth } from '@/lib/auth';
import { listMessages, removeFriend, sendMessage, threadFromParams, threadTitle, watchThread, type Message } from '@/lib/social';
import { useTheme } from '@/theme';

// One screen for every thread: /groups/chat?group=<id>, ?competition=<id> or ?friend=<user id>.
export default function Chat() {
  const { group, competition, friend } = useLocalSearchParams<{ group?: string; competition?: string; friend?: string }>();
  const thread = useMemo(() => threadFromParams({ group, competition, friend }), [group, competition, friend]);
  const uid = useAuth().session?.user.id ?? '';
  const c = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tabBar = useContext(BottomTabBarHeightContext) ?? 0;
  const [title, setTitle] = useState('Chat');
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!thread || !uid) return;
    try {
      setMessages(await listMessages(thread, uid));
      setError(null);
    } catch {
      setError("Couldn't load messages. Check your connection and try again.");
    }
  }, [thread, uid]);

  // Live while the screen is focused; a refetch on each new message keeps names and order right.
  useFocusEffect(
    useCallback(() => {
      if (!thread || !uid) return;
      threadTitle(thread).then(setTitle, () => {});
      void load();
      return watchThread(thread, uid, () => void load());
    }, [thread, uid, load]),
  );

  if (!thread) {
    return (
      <Screen title="Chat" back>
        <ErrorText>This chat is unavailable.</ErrorText>
      </Screen>
    );
  }

  const send = async () => {
    if (!draft.trim() || busy) return;
    setBusy(true);
    try {
      await sendMessage(thread, draft);
      setDraft('');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const unfriend = () =>
    alert(`Remove ${title} as a friend?`, 'You will no longer see this conversation.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => void removeFriend(thread.id).then(() => router.back(), () => setError("Couldn't remove. Try again.")),
      },
    ]);

  const shared = thread.kind !== 'friend';
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top, experimental_backgroundImage: c.wash }, Platform.OS === 'web' && ui.webWidth]}
    >
      <View style={styles.header}>
        <Button plain label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/groups'))} />
        {thread.kind === 'friend' && <Button plain danger label="Remove Friend" onPress={unfriend} />}
      </View>
      <Text accessibilityRole="header" numberOfLines={2} style={[ui.heading, { color: c.ink, paddingHorizontal: 16, paddingBottom: 8 }]}>{title}</Text>
      {messages === null ? (
        <View style={{ paddingHorizontal: 16, flex: 1 }}>{error ? <ErrorText>{error}</ErrorText> : <Skeleton label="Loading messages" />}</View>
      ) : (
        <FlatList
          inverted
          data={messages}
          keyExtractor={(m) => m.id}
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, gap: 8, flexGrow: 1 }}
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          ListEmptyComponent={<Text style={[ui.body, styles.empty, { color: c.inkSoft }]}>No messages yet. Say hi.</Text>}
          renderItem={({ item: m }) => {
            const mine = m.senderId === uid;
            const time = new Date(m.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
            return (
              <View
                accessible
                accessibilityLabel={`${mine ? 'You' : m.senderName}, ${time}: ${m.body}`}
                style={[styles.bubble, mine ? { alignSelf: 'flex-end', backgroundColor: c.accent } : [{ alignSelf: 'flex-start' }, glass(c)]]}
              >
                {!mine && shared && <Text style={[ui.caption, { color: c.accent }]}>{m.senderName}</Text>}
                <Text style={[ui.body, { color: mine ? c.onAccent : c.ink }]}>{m.body}</Text>
                <Text style={[ui.caption, { color: mine ? c.onAccent : c.inkFaint, opacity: 0.8 }]}>{time}</Text>
              </View>
            );
          }}
        />
      )}
      <View style={[styles.composer, { paddingBottom: Math.max(12, tabBar ? tabBar : insets.bottom) }]}>
        {messages !== null && <ErrorText>{error}</ErrorText>}
        <View style={styles.composerRow}>
          <View style={{ flex: 1 }}>
            <Field label="Message" value={draft} onChangeText={setDraft} multiline maxLength={2000} placeholder={shared ? 'Message everyone' : `Message ${title}`} />
          </View>
          <Button label="Send" busy={busy} disabled={!draft.trim()} onPress={() => void send()} />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16 },
  bubble: { maxWidth: '85%', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8, gap: 2 },
  empty: { textAlign: 'center', padding: 24 },
  composer: { paddingHorizontal: 16, paddingTop: 8, gap: 6 },
  composerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
});
