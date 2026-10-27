import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { Button, ErrorText, Field, Row, Screen, Section, Skeleton } from '@/components/ui';
import { alert } from '@/lib/alert';
import { useHealthSync } from '@/lib/health/sync';
import { NAME_MAX, deleteAccount, getDisplayName, updateDisplayName } from '@/lib/profile';
import { supabase } from '@/lib/supabase';

export default function Profile() {
  const router = useRouter();
  const health = useHealthSync();
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
    alert('Sign out?', 'Your groups and steps stay saved.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: () => supabase.auth.signOut() },
    ]);

  const confirmDeleteImports = () =>
    alert(
      'Delete imported Health data?',
      "This stops Health imports and deletes the steps, sleep, and weight Leaderboard imported from Apple Health, here and in your groups. Manual entries stay. Nothing is uploaded again until you reconnect Apple Health. Your data in the Health app isn't touched.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete Imported Data', style: 'destructive', onPress: () => run(health.deleteImports) },
      ],
    );

  const confirmDelete = () =>
    alert(
      'Delete your account?',
      "This deletes your profile, your steps, sleep and weight, your sharing choices and your memberships. Groups you own are deleted for everyone in them. This can't be undone.",
      [
        { text: 'Cancel', style: 'cancel' },
        // The session ends after the delete, and the route guard takes over from there.
        { text: 'Delete Account', style: 'destructive', onPress: () => run(deleteAccount) },
      ],
    );

  const changed = saved !== null && name.trim() !== saved && name.trim().length > 0;

  return (
    <Screen title="Profile">
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
          {changed && <Button label="Save Name" busy={busy} onPress={() => run(async () => setSaved(await updateDisplayName(name)))} />}
        </>
      )}
      <ErrorText>{error}</ErrorText>

      {Platform.OS === 'ios' && (
        <Section
          title="Apple Health"
          footer="Leaderboard reads steps, sleep, and weight that you allow. Deleting imported data doesn't change Apple's permissions: to change what Leaderboard can read, open the Health app, tap your profile picture, then Apps, then Leaderboard."
        >
          <Row label="Health Access" icon={{ ios: 'heart.text.square', android: 'favorite', web: 'favorite' }} onPress={() => router.push('/steps/permission')} />
          <Row
            label="Connect a Watch or Tracker"
            icon={{ ios: 'applewatch', android: 'watch', web: 'watch' }}
            onPress={() => router.push('/steps/sources')}
          />
          <Row
            label="Delete Imported Health Data"
            icon={{ ios: 'trash', android: 'delete', web: 'delete' }}
            danger
            last
            disabled={busy || !health.ready}
            onPress={confirmDeleteImports}
          />
        </Section>
      )}

      <Section title="Account">
        <Row label="Privacy Policy" icon={{ ios: 'hand.raised', android: 'privacy_tip', web: 'privacy_tip' }} onPress={() => router.push('/privacy')} />
        <Row label="Sign Out" icon={{ ios: 'rectangle.portrait.and.arrow.right', android: 'logout', web: 'logout' }} action onPress={confirmSignOut} />
        <Row label="Delete Account" icon={{ ios: 'trash', android: 'delete', web: 'delete' }} danger last disabled={busy} onPress={confirmDelete} />
      </Section>
    </Screen>
  );
}
