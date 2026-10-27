import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { Segmented } from '@/components/history/Segmented';
import { WeightChart } from '@/components/history/WeightChart';
import { ExportOption, useExportChoice } from '@/components/health/ExportOption';
import { Button, ErrorText, Field, Screen, Skeleton, styles, useLargeText } from '@/components/ui';
import { alert } from '@/lib/alert';
import { useAuth } from '@/lib/auth';
import { formatLocalDateTime, parseLocalDateTime, readingDateLabel, startOfLocalDay } from '@/lib/health/dates';
import { formatWeight, RANGES, type Range } from '@/lib/health/format';
import { canExport, MANUAL_KINDS } from '@/lib/health/manual-export';
import { validateWeight } from '@/lib/health/rules';
import { useHealthExport } from '@/lib/health/sync';
import { displayWeight } from '@/lib/health/weight';
import { useWeightUnit } from '@/lib/weight-unit';
import { deleteManualWeight, getMyLatestWeight, getMyWeightHistory, saveManualWeight } from '@/lib/weight';
import { useTheme } from '@/theme';

type Reading = { id?: string; kg: number; measuredAt: string; source?: string };
type Result = { days: number; rows?: Reading[]; latest?: Reading | null; error?: string };

export default function Weight() {
  const c = useTheme();
  const large = useLargeText();
  const { session } = useAuth();
  const me = session?.user.id ?? '';
  const [unit, setUnit] = useWeightUnit();
  const [days, setDays] = useState<Range>(30);
  const [tries, setTries] = useState(0);
  // Keyed by range, so switching range shows the loading state until its own result arrives.
  const [res, setRes] = useState<Result | null>(null);

  useEffect(() => {
    let live = true;
    const now = new Date();
    Promise.all([getMyWeightHistory(me, startOfLocalDay(now, days - 1)), getMyLatestWeight(me)]).then(
      ([rows, latest]) => live && setRes({ days, rows, latest }),
      (e) => live && setRes({ days, error: e instanceof Error ? e.message : "Couldn't load your weight." }),
    );
    return () => { live = false; };
  }, [me, days, tries]);

  const current = res?.days === days ? res : null;
  const latest = current?.latest;

  // Only manual readings can be edited, deleted or exported; imported ones are read-only.
  const exp = useHealthExport();
  const choice = useExportChoice('weight');
  const [text, setText] = useState('');
  const [when, setWhen] = useState(() => formatLocalDateTime(new Date()));
  const [editing, setEditing] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [whenError, setWhenError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const manual = (current?.rows ?? []).filter((r) => canExport(r.source ?? '')).reverse();
  const reset = () => { setText(''); setWhen(formatLocalDateTime(new Date())); setEditing(null); setFormError(null); setWhenError(null); };
  // A queue error never undoes the saved entry; the Health status line shows what failed.
  const send = (id: string, op: 'save' | 'delete', payload: unknown) => { void exp.enqueue(MANUAL_KINDS.weight, id, op, payload).catch(() => {}); };
  const save = async () => {
    const v = validateWeight(text, unit);
    const at = parseLocalDateTime(when);
    if (!v.ok) return setFormError(v.message);
    if (!at || at.getTime() > Date.now()) return setWhenError('Enter a time that has passed as YYYY-MM-DD HH:mm.');
    setBusy(true);
    try {
      const id = await saveManualWeight(me, { id: editing ?? undefined, kg: v.kg, measuredAt: at.toISOString() });
      if (choice.on) send(id, 'save', { kg: v.kg, at: at.toISOString() });
      reset();
      setTries((t) => t + 1);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Couldn't save weight.");
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id: string) => {
    try {
      await deleteManualWeight(me, id);
      if (choice.on) send(id, 'delete', null);
      if (editing === id) reset();
      setTries((t) => t + 1);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Couldn't delete weight.");
    }
  };

  const confirmRemove = (id: string) =>
    alert('Delete this weight reading?', "It's removed for good.", [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => void remove(id) }]);

  // At accessibility sizes "YYYY-MM-DD HH:mm" is wider than the screen, so let it wrap onto two lines; Return still submits, never adds a newline.
  const dateTimeWrap = large ? { multiline: true, submitBehavior: 'blurAndSubmit' as const } : {};

  return (
    <Screen title="My Weight" back>
      <Segmented
        label="Weight unit"
        options={[{ value: 'kg', label: 'kg' }, { value: 'lb', label: 'lb' }] as const}
        value={unit}
        onChange={setUnit}
      />
      {latest && (
        <View>
          <Text style={[styles.caption, { color: c.inkSoft }]}>Latest, {readingDateLabel(new Date(latest.measuredAt))}</Text>
          <Text style={[styles.heading, { color: c.ink }]}>{formatWeight(latest.kg, unit)}</Text>
        </View>
      )}
      <Segmented
        label="Time range"
        options={RANGES.map((r) => ({ value: r, label: `${r}D`, a11y: `${r} days` }))}
        value={days}
        onChange={setDays}
      />
      {current?.error ? (
        <View>
          <ErrorText>{current.error}</ErrorText>
          <Button plain label="Try Again" onPress={() => { setRes(null); setTries((t) => t + 1); }} />
        </View>
      ) : !current ? (
        <Skeleton label="Loading weight" rows={2} />
      ) : !latest ? (
        <Text style={[styles.body, { color: c.inkSoft }]}>No weight recorded yet. Readings imported from Apple Health appear here, or add one below.</Text>
      ) : !current.rows?.length ? (
        <Text style={[styles.body, { color: c.inkSoft }]}>{`No weight recorded in the last ${days} days.`}</Text>
      ) : (
        <WeightChart readings={current.rows} days={days} to={new Date()} unit={unit} />
      )}
      <View style={{ gap: 12 }}>
        <Text style={[styles.heading, { color: c.ink }]}>{editing ? 'Edit weight' : 'Add weight'}</Text>
        <Field label={`Weight (${unit})`} value={text} onChangeText={(v) => { setText(v); setFormError(null); setWhenError(null); }} keyboardType="decimal-pad" placeholder={unit === 'lb' ? '165.0' : '75.0'} error={formError} />
        <Field label="When" value={when} onChangeText={(v) => { setWhen(v); setFormError(null); setWhenError(null); }} placeholder="YYYY-MM-DD HH:mm" autoCapitalize="none" autoCorrect={false} error={whenError} {...dateTimeWrap} />
        <ExportOption type="weight" choice={choice} note="Saved as a body mass sample at that time." />
        <Button label={editing ? 'Save Changes' : 'Save Weight'} busy={busy} disabled={text.trim() === ''} onPress={() => void save()} />
        {editing && <Button plain label="Cancel Edit" onPress={reset} />}
        {manual.map((r) => (
          <View key={r.id} style={{ gap: 4 }}>
            <Text style={[styles.body, { color: c.ink }]}>{`${formatWeight(r.kg, unit)} on ${formatLocalDateTime(new Date(r.measuredAt))}`}</Text>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <Button plain label="Edit" onPress={() => { setEditing(r.id!); setText(displayWeight(r.kg, unit).toFixed(1)); setWhen(formatLocalDateTime(new Date(r.measuredAt))); setFormError(null); setWhenError(null); }} />
              <Button plain danger label="Delete" onPress={() => confirmRemove(r.id!)} />
            </View>
          </View>
        ))}
      </View>
      <Text style={[styles.caption, { color: c.inkSoft }]}>Readings are plotted at the time they were taken. Only you can see this.</Text>
    </Screen>
  );
}
