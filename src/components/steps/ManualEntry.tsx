import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ExportOption, type useExportChoice } from '@/components/health/ExportOption';
import { Button, Screen } from '@/components/ui';

import { DateField, NumberField } from '@/components/inputs';
import { alert } from '@/lib/alert';
import { readDailySteps } from '@/lib/health/healthkit';
import { MANUAL_KINDS, stepsPayload } from '@/lib/health/manual-export';
import { validateSteps, type StepRow } from '@/lib/health/rules';
import { useHealthExport } from '@/lib/health/sync';
import { upsertDailyMetrics } from '@/lib/metrics';

import { localDateKey } from '@/lib/health/dates';
import { dateFromKey } from '@/lib/health/format';
import { useEditorNavigation } from '@/lib/editor-navigation';
import { useAuth } from '@/lib/auth';
import { clearMeasurementDraft, loadMeasurementDraft, saveMeasurementDraft } from '@/lib/measurement-draft';
import { isDay } from '@/lib/workout-template-form';

type Props = { initialDate?: string; initialText?: string; dates: string[]; rows: StepRow[]; onSaved: () => void; onCancel?: () => void; choice: ReturnType<typeof useExportChoice> };

// `dates` is oldest first; chips show newest first.
export function ManualEntry({ dates, rows, onSaved, choice, initialDate, initialText = '', onCancel }: Props) {
  const uid = useAuth().session?.user.id ?? '';
  const [draft, setDraft] = useState<{ date: string; text: string } | null>(null);
  const exp = useHealthExport();
  const today = dates[dates.length - 1];
  const [date, setDate] = useState(initialDate ?? today);
  const [text, setText] = useState(initialText);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);
  const persist = async () => { if (changed) await saveMeasurementDraft(uid, 'steps', { date, text }); };
  const clear = async () => { setChanged(false); await clearMeasurementDraft(uid, 'steps'); };
  const leave = useEditorNavigation(changed && !busy, persist, clear);
  useEffect(() => {
    let live = true;
    void loadMeasurementDraft(uid, 'steps').then((raw) => { const d = raw as { date?: unknown; text?: unknown } | null; if (live && d && typeof d.date === 'string' && isDay(d.date) && typeof d.text === 'string') setDraft({ date: d.date, text: d.text }); });
    return () => { live = false; };
  }, [uid]);
  useEffect(() => { const timer = setTimeout(() => { if (changed) void saveMeasurementDraft(uid, 'steps', { date, text }); }, 400); return () => clearTimeout(timer); }, [uid, changed, date, text]);
  const cancel = () => {
    if (!changed) return onCancel?.();
    alert('Unsaved changes', 'Keep editing, save a draft for later, or discard.', [
      { text: 'Keep Editing', style: 'cancel' },
      { text: 'Save Draft', onPress: () => void persist().then(() => { setChanged(false); leave(() => onCancel?.()); }) },
      { text: 'Discard Changes', style: 'destructive', onPress: () => void clear().then(() => leave(() => onCancel?.())) },
    ]);
  };
  const existing = rows.find((r) => r.date === date);

  const save = async (toHealth: boolean) => {
    const v = validateSteps(text);
    if (!v.ok) return setError(v.message);
    setError(null);
    setBusy(true);
    try {
      await upsertDailyMetrics([{ date, value: v.value, source: 'manual' }]);
      // A queue error never undoes the saved entry; the Health status line shows what failed.
      if (toHealth) void exp.enqueue(MANUAL_KINDS.steps, date, 'save', stepsPayload(date, v.value)).catch(() => {});
      await clear();
      setText('');
      leave(onSaved);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save your steps.");
    } finally {
      setBusy(false);
    }
  };

  // Steps Health already holds for the day, not counting ones this app exported. Writing a manual total adds to them.
  const healthSteps = async () => {
    const fromHealth = (await readDailySteps(dates.length).catch(() => [])).find((r) => r.date === date)?.value ?? 0;
    return Math.round(Math.max(fromHealth, existing?.source === 'healthkit' ? existing.value : 0));
  };

  const onPress = async () => {
    if (date > localDateKey(new Date())) return setError('Choose a date that has passed.');
    const v = validateSteps(text);
    const have = choice.on && v.ok ? await healthSteps() : 0;
    if (v.ok && have > 0) {
      alert(
        'Health already has steps for this day',
        `Health has ${have.toLocaleString()} steps. Saving ${v.value.toLocaleString()} to Health adds them on top, so Health would show ${(have + v.value).toLocaleString()}. The leaderboard counts ${v.value.toLocaleString()}.`,
        [{ text: 'Cancel', style: 'cancel' }, { text: 'Save Without Health', onPress: () => void save(false) }, { text: 'Add to Health', onPress: () => void save(true) }],
      );
    } else if (existing?.source === 'healthkit') {
      alert(
        'Replace Health data?',
        `Health already has ${existing.value.toLocaleString()} steps for this day. A manual number will replace it and be marked Manual.`,
        [{ text: 'Cancel', style: 'cancel' }, { text: 'Replace', onPress: () => void save(choice.on) }],
      );
    } else void save(choice.on);
  };

  return (
    <Screen title={initialText ? 'Edit Steps' : 'Add Steps'} back backLabel="Cancel" onBack={cancel}>
      {draft && <View style={{ gap: 8 }}><Button secondary label="Resume Steps Draft" onPress={() => { setDate(draft.date); setText(draft.text); setChanged(true); setDraft(null); }} /><Button plain label="Discard Previous Draft" onPress={() => { void clearMeasurementDraft(uid, 'steps'); setDraft(null); }} /></View>}
      <DateField label="Date" mode="date" value={dateFromKey(date)} onChange={(v) => { setDate(localDateKey(v)); setChanged(true); }} />
      <NumberField whole
        label="Steps"
        value={text}
        onChangeText={(v) => {
          setText(v);
          setChanged(true);
          setError(null);
        }}
        keyboardType="number-pad"
        placeholder="8000"
        helper='Manual entries are marked "Manual" on the leaderboard.'
        error={error}
      />
      <ExportOption type="steps" choice={choice} note="Adds a step sample for that day. If Health already counts steps that day, they add together, so you will be asked first." />
      <View style={styles.save}>
        <Button label={existing ? 'Replace Steps' : 'Save Steps'} busy={busy} disabled={text.trim() === ''} onPress={() => void onPress()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: { minHeight: 44, minWidth: 44, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', borderRadius: 8, borderWidth: 1 },
  save: { marginTop: 16 },
});
