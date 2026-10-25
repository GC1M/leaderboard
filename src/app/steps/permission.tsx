import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';

import { Button, ErrorText, Screen, styles } from '@/components/ui';
import { useTheme } from '@/theme';
import { requestStepsPermission } from '@/lib/health/healthkit';
import { syncSteps } from '@/lib/health/sync';

export default function HealthPermission() {
  const t = useTheme();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allow = async () => {
    setBusy(true);
    setError(null);
    try {
      await requestStepsPermission();
      await syncSteps();
      router.replace('/steps');
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't connect to Health. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title="Count your steps automatically" back>
      <Text style={[styles.body, { color: t.ink }]}>
        We read your step count from Apple Health so your friends see a score they can trust. We only upload daily totals, never your location or workouts.
      </Text>
      <ErrorText>{error}</ErrorText>
      <Button label="Allow Health access" busy={busy} onPress={allow} />
      <Button label="Enter steps manually" secondary disabled={busy} onPress={() => router.replace('/steps')} />
      <Button plain label="Using a Garmin, Oura or other tracker?" onPress={() => router.push('/steps/sources')} />
    </Screen>
  );
}
