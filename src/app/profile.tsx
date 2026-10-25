import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Linking, Platform, Text, View } from 'react-native';

import { Button, ErrorText, Field, Screen, Skeleton, styles } from '@/components/ui';
import { NAME_MAX, PRIVACY_POLICY_URL, deleteAccount, getDisplayName, updateDisplayName } from '@/lib/profile';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/theme';

export default function Profile() {
  const c = useTheme();
  const router = useRouter();
  const [saved, setSaved] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getDisplayName().then(
      (n) => {
        setSaved(n);
        setName(n);
      },
      (e) => setError(e.message),
    );
  }, []);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const confirmSignOut = () =>
    Alert.alert('Sign out?', 'Your groups and steps stay saved.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => supabase.auth.signOut() },
    ]);

  const confirmDelete = () =>
    Alert.alert(
      'Delete your account?',
      "This deletes your profile, your steps and your memberships. Groups you own are deleted for everyone in them. This can't be undone.",
      [
        { text: 'Cancel', style: 'cancel' },
        // The session ends after the delete, and the route guard takes over from there.
        { text: 'Delete account', style: 'destructive', onPress: () => run(deleteAccount) },
      ],
    );

  const changed = saved !== null && name.trim() !== saved && name.trim().length > 0;

  return (
    <Screen title="Profile" back>
      {saved === null && !error ? (
        <Skeleton label="Loading profile" rows={1} />
      ) : (
        <>
          <Field
            label="Your name"
            helper="Friends see this name on leaderboards."
            maxLength={NAME_MAX}
            autoComplete="name"
            textContentType="name"
            value={name}
            onChangeText={setName}
          />
          {changed && <Button label="Save name" busy={busy} onPress={() => run(async () => setSaved(await updateDisplayName(name)))} />}
        </>
      )}
      <ErrorText>{error}</ErrorText>

      {Platform.OS === 'ios' && (
        <View style={{ gap: 4 }}>
          <Text style={[styles.heading, { color: c.ink }]}>Apple Health</Text>
          <Text style={[styles.body, { color: c.inkSoft }]}>
            Leaderboard works with Apple Health. It reads your daily step count and uploads only the daily total.
          </Text>
          <Button plain label="Health access" onPress={() => router.push('/steps/permission')} />
          <Button plain label="Connect a watch or tracker" onPress={() => router.push('/steps/sources')} />
        </View>
      )}

      <View style={{ gap: 4 }}>
        <Text style={[styles.heading, { color: c.ink }]}>Account</Text>
        <Button plain label="Privacy policy" onPress={() => Linking.openURL(PRIVACY_POLICY_URL).catch(() => {})} />
        <Button plain label="Sign out" onPress={confirmSignOut} />
        <Button plain danger busy={busy} label="Delete account" onPress={confirmDelete} />
      </View>
    </Screen>
  );
}
