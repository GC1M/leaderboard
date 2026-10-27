import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { BarHistory } from '@/components/history/BarHistory';
import { ExportOption, useExportChoice } from '@/components/health/ExportOption';
import { Button, Field, Screen, styles, useLargeText } from '@/components/ui';
import { alert } from '@/lib/alert';
import { useAuth } from '@/lib/auth';
import { formatLocalDateTime, parseLocalDateTime } from '@/lib/health/dates';
import { formatSleep } from '@/lib/health/format';
import { MANUAL_KINDS } from '@/lib/health/manual-export';
import { validateSleep } from '@/lib/health/rules';
import type { SleepDay } from '@/lib/health/sleep';
import { useHealthExport, useHealthSync } from '@/lib/health/sync';
import { deleteManualSleep, getMyManualSleep, getMyRecentSleep, saveManualSleep } from '@/lib/sleep';
import { useTheme } from '@/theme';

// Last night: fell asleep at 23:00, woke up at 07:00 (the previous night when it isn't 07:00 yet).
const defaultTimes = () => {
  const wake = new Date(); wake.setHours(7, 0, 0, 0);
  if (wake > new Date()) wake.setDate(wake.getDate() - 1);
  const bed = new Date(wake); bed.setDate(bed.getDate() - 1); bed.setHours(23);
  return { bed: formatLocalDateTime(bed), wake: formatLocalDateTime(wake) };
};

export default function Sleep() {
  const c = useTheme();
  const large = useLargeText();
  const { session } = useAuth();
  const me = session?.user.id ?? '';
  const fetchSleep = useCallback((days: number) => getMyRecentSleep(me, days), [me]);
  const exp = useHealthExport();
  const health = useHealthSync();
  const choice = useExportChoice('sleep');
  const [tries, setTries] = useState(0);
  const [manual, setManual] = useState<SleepDay[]>([]);
  const [times, setTimes] = useState(defaultTimes);
  const [editing, setEditing] = useState<string | null>(null); // wake-up date of the entry being edited
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    getMyManualSleep(me, 14).then((rows) => live && setManual(rows), () => {});
    return () => { live = false; };
  }, [me, tries]);

  const reset = () => { setTimes(defaultTimes()); setEditing(null); setError(null); };
  // A queue error never undoes the saved entry; the Health status line shows what failed.
  const send = (date: string, op: 'save' | 'delete', payload: unknown) => { void exp.enqueue(MANUAL_KINDS.sleep, date, op, payload).catch(() => {}); };

  const save = async () => {
    const start = parseLocalDateTime(times.bed), end = parseLocalDateTime(times.wake);
    const v = validateSleep(start, end);
    if (!v.ok) return setError(v.message);
    setBusy(true);
    try {
      const date = await saveManualSleep(me, start!, end!);
      // Editing the wake time can move the entry to another day; the old day's entry goes away.
      if (editing && editing !== date) {
        await deleteManualSleep(me, editing);
        if (choice.on) send(editing, 'delete', null);
      }
      if (choice.on) send(date, 'save', { start: start!.toISOString(), end: end!.toISOString() });
      reset();
      setTries((t) => t + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save sleep.");
    } finally {
      setBusy(false);
    }
  };
  const remove = async (date: string) => {
    try {
      await deleteManualSleep(me, date);
      if (choice.on) send(date, 'delete', null);
      if (editing === date) reset();
      // Let Health fill the day again.
      if (health.connected) await health.recheck().catch(() => {});
      setTries((t) => t + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete sleep.");
    }
  };

  const confirmRemove = (date: string) =>
    alert('Delete this sleep entry?', "It's removed for good.", [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => void remove(date) }]);

  // At accessibility sizes "YYYY-MM-DD HH:mm" is wider than the screen, so let it wrap onto two lines; Return still submits, never adds a newline.
  const dateTimeWrap = large ? { multiline: true, submitBehavior: 'blurAndSubmit' as const } : {};

  return (
    <Screen title="My Sleep" back>
      <BarHistory fetch={fetchSleep} fmt={formatSleep} noun="sleep" refresh={tries} />
      <View style={{ gap: 12 }}>
        <Text style={[styles.heading, { color: c.ink }]}>{editing ? 'Edit sleep' : 'Add sleep'}</Text>
        <Field label="Fell asleep" value={times.bed} onChangeText={(v) => { setTimes({ ...times, bed: v }); setError(null); }} placeholder="YYYY-MM-DD HH:mm" autoCapitalize="none" autoCorrect={false} {...dateTimeWrap} />
        <Field label="Woke up" value={times.wake} onChangeText={(v) => { setTimes({ ...times, wake: v }); setError(null); }} placeholder="YYYY-MM-DD HH:mm" autoCapitalize="none" autoCorrect={false} {...dateTimeWrap}
          helper="Counted on the day you woke up. It replaces Health's total for that day." error={error} />
        <ExportOption type="sleep" choice={choice} note="Saved to Health as time asleep, from bedtime to wake time." />
        <Button label={editing ? 'Save Changes' : 'Save Sleep'} busy={busy} onPress={() => void save()} />
        {editing && <Button plain label="Cancel Edit" onPress={reset} />}
        {manual.map((d) => (
          <View key={d.date} style={{ gap: 4 }}>
            <Text style={[styles.body, { color: c.ink }]}>{`${d.date}: ${formatSleep(d.value)}`}</Text>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <Button plain label="Edit" onPress={() => { setEditing(d.date); setTimes({ bed: formatLocalDateTime(new Date(d.windowStart)), wake: formatLocalDateTime(new Date(d.windowEnd)) }); setError(null); }} />
              <Button plain danger label="Delete" onPress={() => confirmRemove(d.date)} />
            </View>
          </View>
        ))}
      </View>
      <Text style={[styles.caption, { color: c.inkSoft }]}>Time asleep, counted on the day you woke up. Only you can see this.</Text>
    </Screen>
  );
}
