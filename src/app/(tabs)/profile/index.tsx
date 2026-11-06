import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Keyboard, Platform } from 'react-native';

import { Button, ErrorText, Field, Row, Screen, Section, Skeleton } from '@/components/ui';
import { alert } from '@/lib/alert';
import { FOOD_KIND, foodDeleteVersion } from '@/lib/health/food-export';
import { useHealthExport, useHealthSync } from '@/lib/health/sync';
import { NAME_MAX, deleteAccount, deleteFoodHistory, getDisplayName, updateDisplayName } from '@/lib/profile';
import { supabase } from '@/lib/supabase';

export default function Profile() {
  const router = useRouter();
  const health = useHealthSync();
  const healthExport = useHealthExport();
  const [saved, setSaved] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameSaved, setNameSaved] = useState(false);

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

  const saveName = () => {
    Keyboard.dismiss();
    void run(async () => {
      setSaved(await updateDisplayName(name));
      setNameSaved(true);
      AccessibilityInfo.announceForAccessibility('Name saved');
      setTimeout(() => setNameSaved(false), 2000);
    });
  };

  const confirmSignOut = () =>
    alert('Sign out?', 'Your groups and steps stay saved.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: () => supabase.auth.signOut() },
    ]);

  const confirmDeleteImports = () =>
    alert(
      'Delete imported Health data?',
      "This stops Health imports and deletes the steps, sleep, weight, and workouts Leaderboard imported from Apple Health, here and in your groups. Manual entries stay. Nothing is uploaded again until you reconnect Apple Health. Your data in the Health app isn't touched.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete Imported Data', style: 'destructive', onPress: () => run(health.deleteImports) },
      ],
    );

  // Entries this app saved to Apple Health, if any. The user chooses whether they go too: the delete is queued
  // through the #48 export queue, which removes them from Health once it runs (HealthKit only lets an app delete its own samples).
  const exported = healthExport.entries.filter((e) => e.kind === FOOD_KIND && e.op !== 'delete' && e.status === 'success');
  const deleteFood = (fromHealth: boolean) =>
    run(async () => {
      await deleteFoodHistory();
      if (fromHealth) for (const e of exported) await healthExport.enqueue(FOOD_KIND, e.recordId, 'delete', null, foodDeleteVersion(healthExport.entries, e.recordId)!);
    });

  const confirmDeleteFood = () =>
    alert(
      'Delete food history?',
      `This deletes every food entry, recipe and custom food you saved, on your account and in your groups. Your sharing choices stay, so groups you share food with will see no food logged. ${
        exported.length ? `${exported.length} ${exported.length === 1 ? 'entry was' : 'entries were'} saved to Apple Health: choose whether to remove ${exported.length === 1 ? 'it' : 'them'} from Health too. ` : ''
      }This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        ...(exported.length ? [{ text: 'Delete and Remove from Health', style: 'destructive' as const, onPress: () => deleteFood(true) }] : []),
        { text: exported.length ? 'Delete, Keep in Health' : 'Delete Food History', style: 'destructive', onPress: () => deleteFood(false) },
      ],
    );

  const confirmDelete = () =>
    alert(
      'Delete your account?',
      "This deletes your profile, your steps, sleep, weight, workouts and templates, your food entries and recipes, your sharing choices and your memberships. Groups you own are deleted for everyone in them. This can't be undone.",
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
            helper={nameSaved ? 'Saved' : 'Friends see this name on leaderboards.'}
            maxLength={NAME_MAX}
            autoComplete="name"
            textContentType="name"
            value={name}
            onChangeText={setName}
          />
          {changed && <Button label="Save Name" busy={busy} onPress={saveName} />}
        </>
      )}
      <ErrorText>{error}</ErrorText>

      {Platform.OS === 'ios' && (
        <Section
          title="Apple Health"
          footer="Leaderboard reads steps, sleep, weight, and workouts that you allow. Deleting imported data doesn't change Apple's permissions: to change what Leaderboard can read, open the Health app, tap your profile picture, then Apps, then Leaderboard."
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

      <Section title="Food" footer="Food is private unless you share daily totals with a group in Group Info.">
        <Row label="Delete Food History" icon={{ ios: 'trash', android: 'delete', web: 'delete' }} danger last disabled={busy} onPress={confirmDeleteFood} />
      </Section>

      <Section title="Preferences">
        <Row label="Units" value="Weight and distance" last onPress={() => router.push('/profile/preferences')} />
      </Section>
      <Section title="Account">
        <Row label="Privacy Policy" icon={{ ios: 'hand.raised', android: 'privacy_tip', web: 'privacy_tip' }} onPress={() => router.push('/profile/privacy')} />
        <Row label="Sign Out" icon={{ ios: 'rectangle.portrait.and.arrow.right', android: 'logout', web: 'logout' }} action onPress={confirmSignOut} />
        <Row label="Delete Account" icon={{ ios: 'trash', android: 'delete', web: 'delete' }} danger last disabled={busy} onPress={confirmDelete} />
      </Section>
    </Screen>
  );
}
