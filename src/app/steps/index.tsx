import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ManualEntry } from '@/components/steps/ManualEntry';
import { StepRow } from '@/components/steps/StepRow';
import { useStepsTheme } from '@/components/steps/theme';
import { isHealthAvailable } from '@/lib/health/healthkit';
import { lastNDates, localDateKey } from '@/lib/health/dates';
import type { StepRow as Row } from '@/lib/health/rules';
import { SYNC_DAYS, useStepSync } from '@/lib/health/sync';
import { deleteManualSteps, getMyRecentSteps } from '@/lib/metrics';

export default function Steps() {
  const t = useStepsTheme();
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
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={health ? <RefreshControl refreshing={syncing} onRefresh={refresh} /> : undefined}
      >
        <Text accessibilityRole="header" style={[styles.title, { color: t.ink }]}>My steps</Text>
        <Text accessibilityLiveRegion="polite" style={[styles.caption, { color: syncError ? t.danger : t.inkSoft }]}>{status}</Text>
        {result?.status === 'needs-permission' && (
          <Pressable onPress={() => router.push('/steps/permission')} accessibilityRole="button" style={styles.link}>
            <Text style={{ color: t.accent, fontWeight: '600' }}>Set up Health access</Text>
          </Pressable>
        )}

        {rows === null && !loadError ? (
          <ActivityIndicator style={styles.spinner} />
        ) : loadError ? (
          <View>
            <Text style={[styles.caption, { color: t.danger }]}>{loadError}</Text>
            <Pressable onPress={load} accessibilityRole="button" style={styles.link}>
              <Text style={{ color: t.accent, fontWeight: '600' }}>Try again</Text>
            </Pressable>
          </View>
        ) : (
          [...dates].reverse().map((d) => {
            const row = rows?.find((r) => r.date === d);
            return <StepRow key={d} date={d} today={today} row={row} onUseHealth={health ? () => switchToHealth(d) : undefined} />;
          })
        )}

        <View style={styles.entry}>
          <ManualEntry dates={dates} rows={rows ?? []} onSaved={load} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 48 },
  title: { fontSize: 30, fontWeight: '800', marginBottom: 4 },
  caption: { fontSize: 13, marginBottom: 12 },
  link: { minHeight: 44, justifyContent: 'center' },
  spinner: { marginVertical: 32 },
  entry: { marginTop: 32 },
});
