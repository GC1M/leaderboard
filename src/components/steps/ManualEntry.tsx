import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button, Field, styles as ui } from '@/components/ui';

import { validateSteps, type StepRow } from '@/lib/health/rules';
import { upsertDailyMetrics } from '@/lib/metrics';

import { useTheme } from '@/theme';

type Props = { dates: string[]; rows: StepRow[]; onSaved: () => void };

// `dates` is oldest first; chips show newest first.
export function ManualEntry({ dates, rows, onSaved }: Props) {
  const t = useTheme();
  const today = dates[dates.length - 1];
  const [date, setDate] = useState(today);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const existing = rows.find((r) => r.date === date);

  const save = async () => {
    const v = validateSteps(text);
    if (!v.ok) return setError(v.message);
    setError(null);
    setBusy(true);
    try {
      await upsertDailyMetrics([{ date, value: v.value, source: 'manual' }]);
      setText('');
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save your steps.");
    } finally {
      setBusy(false);
    }
  };

  const onPress = () => {
    if (existing?.source === 'healthkit') {
      Alert.alert(
        'Replace Health data?',
        `Health already has ${existing.value.toLocaleString()} steps for this day. A manual number will replace it and be marked Manual.`,
        [{ text: 'Cancel', style: 'cancel' }, { text: 'Replace', onPress: save }],
      );
    } else void save();
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
      <View style={styles.save}>
        <Button label={existing ? 'Replace steps' : 'Save steps'} busy={busy} disabled={text.trim() === ''} onPress={onPress} />
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
