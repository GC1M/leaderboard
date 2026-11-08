import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { BarHistory } from '@/components/history/BarHistory';
import { ExportOption, useExportChoice } from '@/components/health/ExportOption';
import { DateField, Overflow } from '@/components/inputs';
import { Button, ErrorText, Row, Screen, Section, Skeleton, styles } from '@/components/ui';
import { alert } from '@/lib/alert';
import { useAuth } from '@/lib/auth';
import { useEditorNavigation } from '@/lib/editor-navigation';
import { healthProviderName } from '@/lib/health-adapter/capabilities';
import { dateFromKey, formatSleep } from '@/lib/health/format';
import { hasSleepHistory } from '@/lib/history-presence';
import { MANUAL_KINDS } from '@/lib/health/manual-export';
import { validateSleep } from '@/lib/health/rules';
import type { SleepDay } from '@/lib/health/sleep';
import { useHealthExport, useHealthSync } from '@/lib/health/sync';
import { clearMeasurementDraft, loadMeasurementDraft, saveMeasurementDraft } from '@/lib/measurement-draft';
import { deleteManualSleep, getMyRecentSleep, saveManualSleep } from '@/lib/sleep';
import { useTheme } from '@/theme';
const defaultTimes = () => {
  const wake = new Date(); wake.setHours(7, 0, 0, 0);
  if (wake > new Date()) wake.setDate(wake.getDate() - 1);
  const bed = new Date(wake); bed.setDate(bed.getDate() - 1); bed.setHours(23);
  return { bed: bed.toISOString(), wake: wake.toISOString() };
};
type Times = ReturnType<typeof defaultTimes>;
type Draft = { times: Times; editing: string | null };
export default function Sleep() {
  const c = useTheme();
  const me = useAuth().session?.user.id ?? '';
  const fetchSleep = useCallback((days: number) => getMyRecentSleep(me, days), [me]);
  const exp = useHealthExport();
  const health = useHealthSync();
  const choice = useExportChoice('sleep');
  const [tries, setTries] = useState(0);
  const [rows, setRows] = useState<SleepDay[] | null>(null);
  const [times, setTimes] = useState(defaultTimes);
  const [view, setView] = useState<'history' | 'detail' | 'edit'>('history');
  const [selected, setSelected] = useState<SleepDay | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const latest = useRef({ times, editing, changed, view });
  useEffect(() => { latest.current = { times, editing, changed, view }; });
  const persist = async () => { const s = latest.current; if (s.changed && s.view === 'edit') await saveMeasurementDraft(me, 'sleep', { times: s.times, editing: s.editing }); };
  const clear = async () => { latest.current.changed = false; setChanged(false); setDraft(null); await clearMeasurementDraft(me, 'sleep'); };
  useEditorNavigation(view === 'edit' && changed && !busy, persist, clear);
  useEffect(() => {
    let live = true;
    getMyRecentSleep(me, 90).then((r) => { if (live) { setRows(r); setLoadError(null); } }, (e) => live && setLoadError((e as Error).message));
    return () => { live = false; };
  }, [me, tries]);
  useEffect(() => {
    let live = true;
    void loadMeasurementDraft(me, 'sleep').then((raw) => {
      const d = raw as Partial<Draft> | null;
      if (live && d?.times && Number.isFinite(Date.parse(d.times.bed)) && Number.isFinite(Date.parse(d.times.wake)) && (d.editing === null || typeof d.editing === 'string')) setDraft(d as Draft);
    });
    return () => { live = false; };
  }, [me]);
  useEffect(() => {
    const timer = setTimeout(() => { const s = latest.current; if (s.changed && s.view === 'edit') void saveMeasurementDraft(me, 'sleep', { times: s.times, editing: s.editing }); }, 400);
    return () => clearTimeout(timer);
  }, [me, times, editing, changed, view]);
  const send = (date: string, op: 'save' | 'delete', payload: unknown) => { void exp.enqueue(MANUAL_KINDS.sleep, date, op, payload).catch(() => {}); };
  const begin = (d?: SleepDay) => { setTimes(d ? { bed: d.windowStart, wake: d.windowEnd } : defaultTimes()); setEditing(d?.date ?? null); setChanged(false); setError(null); setView('edit'); };
  const cancel = () => {
    if (!changed) return setView(selected ? 'detail' : 'history');
    alert('Unsaved changes', 'Keep editing, save a draft for later, or discard.', [
      { text: 'Keep Editing', style: 'cancel' },
      { text: 'Save Draft', onPress: () => void persist().then(() => { setDraft({ times, editing }); setChanged(false); setView('history'); }) },
      { text: 'Discard Changes', style: 'destructive', onPress: () => void clear().then(() => setView(selected ? 'detail' : 'history')) },
    ]);
  };
  const save = async () => {
    if (busy) return;
    const start = new Date(times.bed), end = new Date(times.wake);
    const v = validateSleep(start, end);
    if (!v.ok) return setError(v.message);
    setBusy(true); setError(null);
    try {
      const date = await saveManualSleep(me, start, end);
      if (editing && editing !== date) { await deleteManualSleep(me, editing); if (choice.on) send(editing, 'delete', null); }
      if (choice.on) send(date, 'save', { start: times.bed, end: times.wake });
      await clear(); setSelected({ date, value: (end.getTime() - start.getTime()) / 60000, windowStart: times.bed, windowEnd: times.wake, source: 'manual' }); setView('detail'); setTries((n) => n + 1);
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't save sleep."); }
    finally { setBusy(false); }
  };
  const remove = () => alert(`Delete sleep for ${selected ? dateFromKey(selected.date).toLocaleDateString() : ''}?`, 'This entry is removed for good.', [
    { text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => {
      if (busy || !selected) return; setBusy(true);
      try { await deleteManualSleep(me, selected.date); if (choice.on) send(selected.date, 'delete', null); if (health.connected) await health.recheck().catch(() => {}); setSelected(null); setView('history'); setTries((n) => n + 1); }
      catch (e) { setError((e as Error).message); } finally { setBusy(false); }
    } },
  ]);
  if (view === 'edit') return <Screen title={editing ? 'Edit Sleep' : 'Add Sleep'} back backLabel="Cancel" onBack={cancel}>
    <DateField label="Fell asleep" value={new Date(times.bed)} onChange={(v) => { setTimes((t) => ({ ...t, bed: v.toISOString() })); setChanged(true); setError(null); }} />
    <DateField label="Woke up" value={new Date(times.wake)} onChange={(v) => { setTimes((t) => ({ ...t, wake: v.toISOString() })); setChanged(true); setError(null); }} />
    <Text style={[styles.body, { color: c.inkSoft }]}>Counted on the day you woke up. Replaces the total for that day.</Text>
    <ExportOption type="sleep" choice={choice} note="Saved to Apple Health as time asleep. Group sharing is separate." />
    <ErrorText>{error}</ErrorText><Button label={editing ? 'Save Changes' : 'Save Sleep'} busy={busy} onPress={() => void save()} />
  </Screen>;
  if (view === 'detail' && selected) return <Screen title="Sleep Entry" back onBack={() => { setSelected(null); setView('history'); }} headerActions={selected.source === 'manual' && <Button plain label="Edit" disabled={busy} onPress={() => begin(selected)} />}>
    <Section><Row wrap label="Duration" value={formatSleep(selected.value)} /><Row wrap label="Fell asleep" value={new Date(selected.windowStart).toLocaleString()} /><Row wrap label="Woke up" value={new Date(selected.windowEnd).toLocaleString()} /><Row wrap label="Source" value={selected.source === 'manual' ? 'Manual' : healthProviderName()} last /></Section>
    <ErrorText>{error}</ErrorText>{selected.source === 'manual' ? <Overflow name="sleep entry"><Row wrap label="Delete Entry" danger last disabled={busy} onPress={remove} /></Overflow> : <Text style={[styles.body, { color: c.inkSoft }]}>Imported sleep can be changed in {healthProviderName()}.</Text>}
  </Screen>;
  return <Screen title="My Sleep" back>
    <BarHistory fetch={fetchSleep} hasAny={hasSleepHistory} fmt={formatSleep} noun="sleep" refresh={tries} />
    <Button label="Add Sleep" onPress={() => begin()} />
    {draft && <Button secondary label="Resume Sleep Draft" onPress={() => { setTimes(draft.times); setEditing(draft.editing); setChanged(true); setView('edit'); }} />}
    {loadError ? <View><ErrorText>{loadError}</ErrorText><Button plain label="Try Again" onPress={() => setTries((n) => n + 1)} /></View> : rows === null ? <Skeleton label="Loading sleep entries" /> : rows.length > 0 && <Section title="History · last 90 days">{rows.slice().reverse().map((d, i, all) => <Row wrap key={d.date} label={dateFromKey(d.date).toLocaleDateString(undefined, { dateStyle: 'medium' })} value={`${formatSleep(d.value)} · ${d.source === 'manual' ? 'Manual' : healthProviderName()}`} last={i === all.length - 1} onPress={() => { setSelected(d); setError(null); setView('detail'); }} />)}</Section>}
  </Screen>;
}
