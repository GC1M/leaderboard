import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { ExportOption, type useExportChoice } from '@/components/health/ExportOption';
import { Button, Field, styles as ui } from '@/components/ui';

import { readDailySteps } from '@/lib/health/healthkit';
import { MANUAL_KINDS, stepsPayload } from '@/lib/health/manual-export';
import { validateSteps, type StepRow } from '@/lib/health/rules';
import { useHealthExport } from '@/lib/health/sync';
import { upsertDailyMetrics } from '@/lib/metrics';

import { useTheme } from '@/theme';

type Props = { dates: string[]; rows: StepRow[]; onSaved: () => void; choice: ReturnType<typeof useExportChoice> };

// `dates` is oldest first; chips show newest first.
export function ManualEntry({ dates, rows, onSaved, choice }: Props) {
  const t = useTheme();
  const exp = useHealthExport();
  const today = dates[dates.length - 1];
  const [date, setDate] = useState(today);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
      setText('');
      onSaved();
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
    const v = validateSteps(text);
    const have = choice.on && v.ok ? await healthSteps() : 0;
    if (v.ok && have > 0) {
      Alert.alert(
        'Health already has steps for this day',
        `Health has ${have.toLocaleString()} steps. Saving ${v.value.toLocaleString()} to Health adds them on top, so Health would show ${(have + v.value).toLocaleString()}. The leaderboard counts ${v.value.toLocaleString()}.`,
        [{ text: 'Cancel', style: 'cancel' }, { text: 'Save Without Health', onPress: () => void save(false) }, { text: 'Add to Health', onPress: () => void save(true) }],
      );
    } else if (existing?.source === 'healthkit') {
      Alert.alert(
        'Replace Health data?',
        `Health already has ${existing.value.toLocaleString()} steps for this day. A manual number will replace it and be marked Manual.`,
        [{ text: 'Cancel', style: 'cancel' }, { text: 'Replace', onPress: () => void save(choice.on) }],
      );
    } else void save(choice.on);
  };

  return (
    <View>
      <Text style={[ui.heading, styles.heading, { color: t.ink }]}>Add steps manually</Text>
      <View style={styles.chips} accessibilityRole="radiogroup">
        {[...dates].reverse().map((d) => (
          <Pressable
            key={d}
            onPress={() => setDate(d)}
            accessibilityRole="radio"
            accessibilityState={{ selected: d === date }}
            accessibilityLabel={d === today ? 'Today' : d}
            style={[styles.chip, { borderColor: d === date ? t.accent : t.border, backgroundColor: d === date ? t.accent : t.surface }]}
          >
            <Text style={{ color: d === date ? t.onAccent : t.ink, fontWeight: '600' }}>{d === today ? 'Today' : d.slice(5)}</Text>
          </Pressable>
        ))}
      </View>
      <Field
        label="Steps"
        value={text}
        onChangeText={(v) => {
          setText(v);
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
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: { minHeight: 44, minWidth: 44, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', borderRadius: 8, borderWidth: 1 },
  save: { marginTop: 16 },
});
