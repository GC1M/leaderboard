import { useState } from 'react';
import { Platform } from 'react-native';

import { ErrorText, Row, Screen, Section } from '@/components/ui';
import { alert } from '@/lib/alert';
import { healthProviderName } from '@/lib/health-adapter/capabilities';
import { useAuth } from '@/lib/auth';
import { exportedFood, settleFoodExport } from '@/lib/health/food-export';
import { useHealthExport, useHealthSync } from '@/lib/health/sync';
import { exportedWater, settleWaterExport } from '@/lib/health/water-export';
import { deleteFoodHistory } from '@/lib/profile';
import { deleteWaterHistory } from '@/lib/water/entries';

// The destructive data actions, away from the settings on Profile. Deleting the account stays on Profile.
export default function YourData() {
  const health = useHealthSync();
  const provider = healthProviderName();
  const uid = useAuth().session?.user.id ?? '';
  const healthExport = useHealthExport();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  const count = (n: number) => `${n} ${n === 1 ? 'entry was' : 'entries were'} saved to ${provider}`;
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

  return (
    <Screen title="Your Data" back>
      <ErrorText>{error}</ErrorText>
      <Section
        title={Platform.OS === 'android' ? 'Health Connect' : 'Apple Health'}
        footer={`Deleting imported data doesn't change ${provider} permissions: to change what Leaderboard can read, ${
          Platform.OS === 'android' ? 'open Health Connect, then App permissions, then Leaderboard' : 'open the Health app, tap your profile picture, then Apps, then Leaderboard'
        }.`}
      >
        <Row label="Delete Imported Health Data" icon={{ ios: 'trash', android: 'delete', web: 'delete' }} danger last disabled={busy || !health.ready} onPress={confirmDeleteImports} />
      </Section>
      <Section title="Food" footer="Food is private unless you share daily totals with a group in Group Info.">
        <Row label="Delete Food History" icon={{ ios: 'trash', android: 'delete', web: 'delete' }} danger last disabled={busy} onPress={confirmDeleteFood} />
      </Section>
      <Section title="Water" footer="Water is private unless you share daily totals with a group in Group Info.">
        <Row label="Delete Water History" icon={{ ios: 'trash', android: 'delete', web: 'delete' }} danger last disabled={busy} onPress={confirmDeleteWater} />
      </Section>
    </Screen>
  );
}
