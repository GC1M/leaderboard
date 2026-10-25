import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, Text, View } from 'react-native';

import { Button, ErrorText, Screen, styles } from '@/components/ui';import { ManualEntry } from '@/components/steps/ManualEntry';
import { StepRow } from '@/components/steps/StepRow';
import { useTheme } from '@/theme';
import { isHealthAvailable } from '@/lib/health/healthkit';
import { lastNDates, localDateKey } from '@/lib/health/dates';
import type { StepRow as Row } from '@/lib/health/rules';
import { SYNC_DAYS, useStepSync } from '@/lib/health/sync';
import { deleteManualSteps, getMyRecentSteps } from '@/lib/metrics';

export default function Steps() {
  const t = useTheme();
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const dates = lastNDates(SYNC_DAYS);
  const today = localDateKey(new Date());
  const health = isHealthAvailable();

  const load = useCallback(async () => {
    try {
      setRows(await getMyRecentSteps(SYNC_DAYS));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Couldn't load your steps.");
    }
  }, []);

  const { sync, syncing, result, error: syncError } = useStepSync(load);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount
    void load();
  }, [load]);

  const switchToHealth = async (date: string) => {
    try {
      await deleteManualSteps(date);
      await sync();
      await load();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Couldn't update that day.");
    }
  };

  const status = !health
    ? 'Health sync needs the iOS app build. Enter steps manually below.'
    : syncError
      ? syncError
      : result?.status === 'needs-permission'
        ? 'Health access is not set up yet.'
        : result?.status === 'synced'
          ? `Synced at ${result.at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
          : 'Syncing...';

  const refresh = async () => {
    await sync();
    await load();
  };

  return (
    <Screen
      title="My steps"
      back
      refreshControl={health ? <RefreshControl refreshing={syncing} onRefresh={refresh} /> : undefined}
    >
      <Text accessibilityLiveRegion="polite" style={[styles.caption, { color: syncError ? t.danger : t.inkSoft }]}>{status}</Text>
      {result?.status === 'needs-permission' && (
        <Button plain label="Set up Health access" onPress={() => router.push('/steps/permission')} />
      )}

      {rows === null && !loadError ? (
        <ActivityIndicator accessibilityLabel="Loading steps" color={t.accent} />
      ) : loadError ? (
        <View>
          <ErrorText>{loadError}</ErrorText>
          <Button plain label="Try again" onPress={load} />
        </View>
      ) : (
        <View>
          {[...dates].reverse().map((d) => {
            const row = rows?.find((r) => r.date === d);
            return <StepRow key={d} date={d} today={today} row={row} onUseHealth={health ? () => switchToHealth(d) : undefined} />;
          })}
        </View>
      )}

      {health && <Button plain label="Connect a watch or tracker" onPress={() => router.push('/steps/sources')} />}

      <View style={{ marginTop: 16 }}>
        <ManualEntry dates={dates} rows={rows ?? []} onSaved={load} />
      </View>
    </Screen>
  );
}
