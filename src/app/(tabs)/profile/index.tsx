import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Keyboard, Platform } from 'react-native';

import { Button, ErrorText, Field, Row, Screen, Section, Skeleton } from '@/components/ui';
import { alert } from '@/lib/alert';
import { healthProviderName } from '@/lib/health-adapter/capabilities';
import { useAuth } from '@/lib/auth';
import { exportedFood, settleFoodExport } from '@/lib/health/food-export';
import { useHealthExport, useHealthSync } from '@/lib/health/sync';
import { exportedWater, settleWaterExport } from '@/lib/health/water-export';
import { NAME_MAX, deleteAccount, deleteFoodHistory, getDisplayName, signOut, updateDisplayName } from '@/lib/profile';
import { deleteWaterHistory } from '@/lib/water/entries';

export default function Profile() {
  const router = useRouter();
  const health = useHealthSync();
  const provider = healthProviderName();
  const uid = useAuth().session?.user.id ?? '';
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
    alert('Sign out?', 'Your groups and steps stay saved. Other devices stay signed in.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: () => signOut() },
    ]);

  const confirmDeleteImports = () =>
    alert(
      'Delete imported Health data?',
      `This stops Health imports and deletes the steps, sleep, weight, workouts, and water Leaderboard imported from ${provider}, here and in your groups. Manual entries stay. Nothing is uploaded again until you reconnect ${provider}. Your data in ${Platform.OS === 'android' ? 'Health Connect' : 'the Health app'} isn't touched.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete Imported Data', style: 'destructive', onPress: () => run(health.deleteImports) },
      ],
    );

  // Food this app saved to Apple Health. The user chooses whether it goes too (see settleFoodExport); the entries are
  // read when the button is pressed, not from this render.
  const exported = exportedFood(healthExport.entries).length;
  const count = (n: number) => `${n} ${n === 1 ? 'entry was' : 'entries were'} saved to Apple Health`;
  const deleteFood = (fromHealth: boolean) =>
    run(async () => {
      // Health first, like account deletion: a failed Remove leaves the history intact, and Keep leaves nothing to reconcile.
      await settleFoodExport(healthExport, fromHealth);
      await deleteFoodHistory();
    });
  // Same for water this app saved to Health.
  const exportedW = exportedWater(healthExport.entries).length;
  const deleteWater = (fromHealth: boolean) =>
    run(async () => {
      await settleWaterExport(healthExport, fromHealth);
      await deleteWaterHistory(uid);
    });
  // Health deletes must run while the account still exists, so they come first; if they fail the account stays.
  const removeAccount = (fromHealth: boolean) =>
    run(async () => {
      if (fromHealth) {
        await settleFoodExport(healthExport, true);
        await settleWaterExport(healthExport, true);
      }
      await deleteAccount();
    });

  const confirmDeleteFood = () =>
    alert(
      'Delete food history?',
      `This deletes every food entry, recipe and custom food you saved, on your account and in your groups. Your sharing choices stay, so groups you share food with will see no food logged. ${
        exported ? `${count(exported)}: choose whether to remove ${exported === 1 ? 'it' : 'them'} from Health too. ` : ''
      }This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        ...(exported ? [{ text: 'Delete and Remove from Health', style: 'destructive' as const, onPress: () => deleteFood(true) }] : []),
        { text: exported ? 'Delete, Keep in Health' : 'Delete Food History', style: 'destructive', onPress: () => deleteFood(false) },
      ],
    );

  const confirmDeleteWater = () =>
    alert(
      'Delete water history?',
      `This deletes every water entry on your account, both added here and imported from Apple Health, and your water target. Your sharing choices stay, so groups you share water with will see no water logged. ${
        exportedW ? `${count(exportedW)}: choose whether to remove ${exportedW === 1 ? 'it' : 'them'} from Health too. ` : ''
      }Water from other apps stays in Health. This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        ...(exportedW ? [{ text: 'Delete and Remove from Health', style: 'destructive' as const, onPress: () => deleteWater(true) }] : []),
        { text: exportedW ? 'Delete, Keep in Health' : 'Delete Water History', style: 'destructive', onPress: () => deleteWater(false) },
      ],
    );

  const confirmDelete = () =>
    alert(
      'Delete your account?',
      `This deletes your profile, your steps, sleep, weight, workouts and templates, your food entries and recipes, your water, your sharing choices and your memberships. Groups you own are deleted for everyone in them. ${
        exported + exportedW ? `${count(exported + exportedW)}: choose whether to remove ${exported + exportedW === 1 ? 'it' : 'them'} from Health too. ` : ''
      }This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        // The session ends after the delete, and the route guard takes over from there.
        ...(exported + exportedW ? [{ text: 'Delete Account and Remove from Health', style: 'destructive' as const, onPress: () => removeAccount(true) }] : []),
        { text: exported + exportedW ? 'Delete Account, Keep in Health' : 'Delete Account', style: 'destructive', onPress: () => removeAccount(false) },
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

      {Platform.OS === 'android' && (
        <Section
          title="Health Connect"
          footer="Leaderboard reads steps, sleep, weight, and workouts that you allow. Deleting imported data doesn't change Health Connect permissions: to change what Leaderboard can read, open Health Connect, then App permissions, then Leaderboard."
        >
          <Row label="Health Access" icon={{ ios: 'heart.text.square', android: 'favorite', web: 'favorite' }} onPress={() => router.push('/steps/permission')} />
          <Row label="Delete Imported Health Data" icon={{ ios: 'trash', android: 'delete', web: 'delete' }} danger last disabled={busy || !health.ready} onPress={confirmDeleteImports} />
        </Section>
      )}
      {Platform.OS === 'ios' && (
        <Section
          title="Apple Health"
          footer="Leaderboard reads steps, sleep, weight, workouts, and water that you allow, and saves food or water to Apple Health only if you turn that on in the Food Diary or on the Water screen. Deleting imported data doesn't change Apple's permissions: to change what Leaderboard can read, open the Health app, tap your profile picture, then Apps, then Leaderboard."
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

      <Section title="Water" footer="Water is private unless you share daily totals with a group in Group Info.">
        <Row label="Delete Water History" icon={{ ios: 'trash', android: 'delete', web: 'delete' }} danger last disabled={busy} onPress={confirmDeleteWater} />
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
