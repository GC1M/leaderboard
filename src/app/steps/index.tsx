import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, RefreshControl, Text, View } from 'react-native';

import { BarHistory } from '@/components/history/BarHistory';
import { Button, ErrorText, Screen, styles } from '@/components/ui';
import { ManualEntry } from '@/components/steps/ManualEntry';
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

  const { sync, recheck, connected, syncing, result, error: syncError } = useStepSync(load);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount
    void load();
  }, [load]);

  const switchToHealth = async (date: string) => {
    try {
      await deleteManualSteps(date);
      await recheck();
      await load();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Couldn't update that day.");
    }
  };

  const status = !health
    ? 'Health sync needs the iOS app build. Enter steps manually below.'
    : syncError
      ? syncError
      : result?.status === 'not-connected'
        ? 'Connect this account to Apple Health to import your steps.'
      : result?.status === 'needs-permission'
        ? 'Health access is not set up yet.'
        : result?.status === 'no-data'
          ? 'No steps from Health in the last week. Steps may be off in Health access, or nothing was recorded.'
          : result?.status === 'synced'
            ? `Synced at ${result.at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
            : 'Syncing...';

  const refresh = async () => {
    await sync();
    await load();
  };

  return (
    <Screen
      title="My Steps"
      back
      refreshControl={health ? <RefreshControl refreshing={syncing} onRefresh={refresh} /> : undefined}
    >
      <Text accessibilityLiveRegion="polite" style={[styles.caption, { color: syncError ? t.danger : t.inkSoft }]}>{status}</Text>
      {(result?.status === 'needs-permission' || result?.status === 'no-data' || result?.status === 'not-connected') && (
        <Button
          plain
          label={result.status === 'no-data' ? 'Check Health Access' : 'Set Up Health Access'}
          onPress={() => router.push('/steps/permission')}
        />
      )}

      <BarHistory refresh={rows} fetch={getMyRecentSteps} fmt={(v) => `${Math.round(v).toLocaleString()} steps`} noun="steps" />

      {rows === null && !loadError ? (
        <ActivityIndicator accessibilityLabel="Loading steps" color={t.accent} />
      ) : loadError ? (
        <View>
          <ErrorText>{loadError}</ErrorText>
          <Button plain label="Try Again" onPress={load} />
        </View>
      ) : (
        <View>
          {[...dates].reverse().map((d) => {
            const row = rows?.find((r) => r.date === d);
            return <StepRow key={d} date={d} today={today} row={row} onUseHealth={health && connected ? () => switchToHealth(d) : undefined} />;
          })}
        </View>
      )}

      {/* The how-to applies to any iPhone, even before Health access works (Expo Go, not yet allowed). */}
      {Platform.OS === 'ios' && <Button plain label="Connect a Watch or Tracker" onPress={() => router.push('/steps/sources')} />}

      <View style={{ marginTop: 16 }}>
        <ManualEntry dates={dates} rows={rows ?? []} onSaved={load} />
      </View>
    </Screen>
  );
}
