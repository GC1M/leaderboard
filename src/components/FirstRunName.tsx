import { useEffect, useRef, useState } from 'react';
import { Modal, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, ErrorText, Field, styles } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { NAME_MAX, defaultDisplayName, getDisplayName, skipNamePrompt, updateDisplayName } from '@/lib/profile';
import { useTheme } from '@/theme';

// Asks once for the name friends see, when the account still has the automatic "Player XXXX" name
// (email and phone sign-ups, or Apple without a shared name). A sheet, not a route, so invite links keep working underneath.
export function FirstRunName() {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const user = useAuth().session?.user;
  const uid = user?.id;
  const skipped = user?.user_metadata?.name_prompt_skipped === true;
  const [defaultFor, setDefaultFor] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);

  useEffect(() => {
    if (!uid || skipped) return;
    let live = true;
    // A failed load just skips the prompt this time; it asks again on the next launch.
    getDisplayName().then((n) => { if (live && n === defaultDisplayName(uid)) setDefaultFor(uid); }, () => {});
    return () => { live = false; };
  }, [uid, skipped]);

  const open = !!uid && !skipped && defaultFor === uid && !closed;
  const run = async (fn: () => Promise<unknown>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(null);
    try { await fn(); setClosed(true); } catch (e) { setError((e as Error).message); } finally { lock.current = false; setBusy(false); }
  };
  const save = () => {
    if (!name.trim()) return setError('Enter a name, or choose Not Now.');
    void run(() => updateDisplayName(name));
  };
  const later = () => void run(skipNamePrompt);

  if (!uid) return null;
  return (
    <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={later}>
      <View style={{ flex: 1, backgroundColor: c.bg, padding: 20, paddingTop: 48, paddingBottom: insets.bottom + 20, gap: 16 }}>
        <Text accessibilityRole="header" style={[styles.title, { color: c.ink }]}>What should friends call you?</Text>
        <Text style={[styles.body, { color: c.inkSoft }]}>This name shows on leaderboards in your groups. You can change it later in Profile.</Text>
        <Field label="Your name" value={name} onChangeText={(t) => { setName(t); setError(null); }} maxLength={NAME_MAX} autoFocus autoComplete="name" textContentType="name" returnKeyType="done" onSubmitEditing={save} placeholder="Alex" />
        <ErrorText>{error}</ErrorText>
        <Button label="Continue" busy={busy} onPress={save} />
        <Button plain label="Not Now" disabled={busy} onPress={later} />
        <Text style={[styles.caption, { color: c.inkSoft, textAlign: 'center' }]}>Until then you show as {defaultDisplayName(uid)}.</Text>
      </View>
    </Modal>
  );
}
