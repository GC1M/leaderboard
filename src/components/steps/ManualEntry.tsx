import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { validateSteps, type StepRow } from '@/lib/health/rules';
import { upsertDailyMetrics } from '@/lib/metrics';

import { useStepsTheme } from './theme';

type Props = { dates: string[]; rows: StepRow[]; onSaved: () => void };

// `dates` is oldest first; chips show newest first.
export function ManualEntry({ dates, rows, onSaved }: Props) {
  const t = useStepsTheme();
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
      <Text style={[styles.heading, { color: t.ink }]}>Add steps manually</Text>
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
      <TextInput
        value={text}
        onChangeText={(s) => {
          setText(s);
          setError(null);
        }}
        keyboardType="number-pad"
        placeholder="8000"
        placeholderTextColor={t.inkSoft}
        accessibilityLabel="Steps"
        style={[styles.input, { color: t.ink, backgroundColor: t.surface, borderColor: error ? t.danger : t.border }]}
      />
      {error && (
        <Text accessibilityLiveRegion="polite" style={[styles.caption, { color: t.danger }]}>
          {error}
        </Text>
      )}
      <Text style={[styles.caption, { color: t.inkSoft }]}>Manual entries are marked &quot;Manual&quot; on the leaderboard.</Text>
      <Pressable
        onPress={onPress}
        disabled={busy || text.trim() === ''}
        accessibilityRole="button"
        accessibilityLabel={existing ? 'Replace steps' : 'Save steps'}
        style={({ pressed }) => [styles.button, { backgroundColor: t.accent, opacity: busy || text.trim() === '' ? 0.5 : pressed ? 0.7 : 1 }]}
      >
        {busy ? <ActivityIndicator color={t.onAccent} /> : <Text style={[styles.buttonText, { color: t.onAccent }]}>{existing ? 'Replace steps' : 'Save steps'}</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 20, fontWeight: '700', marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: { minHeight: 44, minWidth: 44, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', borderRadius: 8, borderWidth: 1 },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, fontSize: 16 },
  caption: { fontSize: 13, marginTop: 6 },
  button: { minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  buttonText: { fontSize: 16, fontWeight: '600' },
});
