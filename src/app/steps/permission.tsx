import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Text } from 'react-native';

import { Button, ErrorText, Screen, styles } from '@/components/ui';
import { useTheme } from '@/theme';
import { getAllHealthAccess, type HealthAccess, type HealthMetric } from '@/lib/health/healthkit';
import { useHealthSync } from '@/lib/health/sync';

export default function HealthPermission() {
  const t = useTheme();
  const healthSync = useHealthSync();
  const router = useRouter();
  const [access, setAccess] = useState<Record<HealthMetric, HealthAccess> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setAccess(await getAllHealthAccess());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't check Health access.");
    }
  }, []);

  // Re-check when coming back from the Health app or Settings. This never shows the permission sheet.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount
    void load();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void load();
    });
    return () => sub.remove();
  }, [load]);

  const allow = async () => {
    setBusy(true);
    setError(null);
    try {
      await healthSync.connect();
      router.replace('/steps');
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't connect to Health. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const states = access ? Object.values(access) : [];
  const unavailable = states.includes('unavailable');
  const notAsked = states.includes('not-asked');

  return (
    <Screen title="Connect Apple Health" back>
      <Text style={[styles.body, { color: t.ink }]}>
        Leaderboard can read your steps, sleep, weight, and workouts from Apple Health. You can allow any of them. It uploads daily step totals, nightly sleep summaries, weight readings, and workout summaries to your private account.
        Choose what to share separately in each group. Imports run while you use the app. Never your location.
      </Text>
      {unavailable ? (
        <Text style={[styles.body, { color: t.inkSoft }]}>
          Apple Health needs the Leaderboard iPhone app. It isn&apos;t available in Expo Go, on the web, or on Android. You can still enter steps
          manually.
        </Text>
      ) : access && !notAsked ? (
        <Text style={[styles.body, { color: t.inkSoft }]}>
          You&apos;ve already answered the Health request. To change what Leaderboard can read, open the Health app, tap your profile picture, then
          Apps, then Leaderboard.
        </Text>
      ) : null}
      <ErrorText>{error}</ErrorText>
      {/* Also shown if the status check failed, so there is always a way to retry. */}
      {!unavailable && <Button label={notAsked ? "Allow Health Access" : "Connect Health Data"} busy={busy} onPress={allow} />}
      <Button label="Enter Steps Manually" secondary disabled={busy} onPress={() => router.replace('/steps')} />
      <Button plain label="Using a Garmin, Oura or Other Tracker?" onPress={() => router.push('/steps/sources')} />
    </Screen>
  );
}
