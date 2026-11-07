import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, RefreshControl, Text, View } from 'react-native';

import { healthProviderName } from '@/lib/health-adapter/capabilities';
import { hasStepHistory } from '@/lib/history-presence';
import { BarHistory } from '@/components/history/BarHistory';
import { Button, ErrorText, Row as DetailRow, Screen, Section, styles } from '@/components/ui';
import { Overflow } from '@/components/inputs';
import { alert } from '@/lib/alert';
import { dateFromKey } from '@/lib/health/format';
import { useExportChoice } from '@/components/health/ExportOption';
import { ManualEntry } from '@/components/steps/ManualEntry';
import { StepRow } from '@/components/steps/StepRow';
import { useTheme } from '@/theme';
import { isHealthConnectLoaded } from '@/lib/health/health-connect';
import { isHealthAvailable } from '@/lib/health/healthkit';
import { lastNDates, localDateKey } from '@/lib/health/dates';
import type { StepRow as Row } from '@/lib/health/rules';
import { MANUAL_KINDS } from '@/lib/health/manual-export';
import { SYNC_DAYS, useHealthExport, useStepSync } from '@/lib/health/sync';
import { deleteManualSteps, getMyRecentSteps } from '@/lib/metrics';

export default function Steps() {
  const t = useTheme();
  const router = useRouter();
  const [selected, setSelected] = useState<Row | null>(null);
  const [entering, setEntering] = useState(false);
  const [editRow, setEditRow] = useState<Row | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const dates = lastNDates(SYNC_DAYS);
  const today = localDateKey(new Date());
  const health = isHealthAvailable() || isHealthConnectLoaded();
  const provider = healthProviderName();
  const choice = useExportChoice('steps');
  const exp = useHealthExport();

  const load = useCallback(async () => {
    try {
      setRows(await getMyRecentSteps(90));
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
      if (choice.on) void exp.enqueue(MANUAL_KINDS.steps, date, 'delete', null).catch(() => {});
      await recheck();
      await load();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Couldn't update that day.");
    }
  };

  const status = !health
    ? `Health sync needs the ${Platform.OS === 'android' ? 'Android' : 'iOS'} app build. Enter steps manually below.`
    : syncError
      ? syncError
      : result?.status === 'not-connected'
        ? `Connect this account to ${provider} to import your steps.`
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

  const remove = () => alert(`Delete steps for ${selected ? dateFromKey(selected.date).toLocaleDateString() : ''}?`, `The manual total is removed for good. ${provider} may fill the day again at the next sync.`, [
    { text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => { if (!selected) return; try { await deleteManualSteps(selected.date); if (choice.on) void exp.enqueue(MANUAL_KINDS.steps, selected.date, 'delete', null).catch(() => {}); setSelected(null); await load(); } catch (e) { setLoadError((e as Error).message); } } },
  ]);
  if (entering) return <ManualEntry dates={dates} rows={rows ?? []} initialDate={editRow?.date} initialText={editRow ? String(editRow.value) : ''} choice={choice} onCancel={() => setEntering(false)} onSaved={() => { setEntering(false); setEditRow(null); void load(); }} />;
  if (selected) return <Screen title="Step Entry" back onBack={() => setSelected(null)} headerActions={selected.source === 'manual' && <Button plain label="Edit" onPress={() => { setEditRow(selected); setSelected(null); setEntering(true); }} />}>
    <Section><DetailRow label="Date" value={dateFromKey(selected.date).toLocaleDateString()} /><DetailRow label="Steps" value={`${selected.value.toLocaleString()} steps`} /><DetailRow label="Source" value={selected.source === 'manual' ? 'Manual' : provider} last /></Section>
    {selected.source === 'manual' && <Overflow name="step entry"><DetailRow label="Delete Entry" danger last onPress={remove} /></Overflow>}
    <ErrorText>{loadError}</ErrorText>
    {selected.source === 'manual' && health && connected && <Button secondary label={`Use ${provider} Total`} onPress={async () => { await switchToHealth(selected.date); setSelected(null); }} />}
  </Screen>;
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

      <BarHistory hasAny={hasStepHistory} refresh={rows} fetch={getMyRecentSteps} fmt={(v) => `${Math.round(v).toLocaleString()} steps`} noun="steps" />

      {rows === null && !loadError ? (
        <ActivityIndicator accessibilityLabel="Loading steps" color={t.accent} />
      ) : loadError ? (
        <View>
          <ErrorText>{loadError}</ErrorText>
          <Button plain label="Try Again" onPress={load} />
        </View>
      ) : (
        <View>
          {(rows ?? []).slice().reverse().map((row) => <StepRow key={row.date} date={row.date} today={today} row={row} onPress={() => { setSelected(row); setLoadError(null); }} />)}
        </View>
      )}

      {/* The how-to applies to any iPhone, even before Health access works (Expo Go, not yet allowed). */}
      {Platform.OS === 'ios' && <Button plain label="Connect a Watch or Tracker" onPress={() => router.push('/steps/sources')} />}

      <Button label="Add Steps" onPress={() => { setEditRow(null); setEntering(true); }} />
    </Screen>
  );
}
