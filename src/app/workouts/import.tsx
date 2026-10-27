import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Text } from 'react-native';

import { Segmented } from '@/components/history/Segmented';
import { Button, ErrorText, Row, Screen, Section, styles } from '@/components/ui';
import type { WeightUnit } from '@/lib/health/format';
import { useWeightUnit } from '@/lib/weight-unit';
import { defaultDistanceUnit, type DistanceUnit } from '@/lib/workout-form';
import { FORMATS, importWorkouts, newExercises, previewImport } from '@/lib/workout-import';
import { listExercises } from '@/lib/workouts';
import { useTheme } from '@/theme';

const READ_ERROR = "Couldn't open that file. Export it again from the other app and try again.";
const LIST_MAX = 20;
const dateText = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

// Import workout history from another app's CSV export. Reached from the Workouts screen (file picker) or the share
// sheet (`file` is the shared file's URL, see +native-intent). Nothing is saved until the user taps Import.
export default function ImportWorkouts() {
  const c = useTheme();
  const router = useRouter();
  const { file } = useLocalSearchParams<{ file?: string }>();
  const [appWeight] = useWeightUnit();
  const [weight, setWeight] = useState<WeightUnit | null>(null);
  const [distance, setDistance] = useState<DistanceUnit>(() => defaultDistanceUnit(Intl.DateTimeFormat().resolvedOptions().locale));
  const [text, setText] = useState<string | null>(null);
  const [known, setKnown] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ added: number; existing: number } | null>(null);

  useEffect(() => {
    listExercises().then((es) => setKnown(es.map((e) => e.name)), () => {});
  }, []);
  useEffect(() => {
    if (file) new File(file).text().then(setText, () => setError(READ_ERROR));
  }, [file]);

  const units = { weight: weight ?? appWeight, distance };
  const result = useMemo(() => {
    if (text === null) return null;
    try {
      return { preview: previewImport(text, units) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : READ_ERROR };
    }
    // units is rebuilt every render; its two fields are the real inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, units.weight, units.distance]);
  const preview = result?.preview;
  const added = useMemo(() => (preview ? newExercises(preview.workouts, known) : []), [preview, known]);

  const pick = async () => {
    setError(null);
    setDone(null);
    try {
      const r = await DocumentPicker.getDocumentAsync({ type: ['text/csv', 'text/comma-separated-values', 'text/plain'], copyToCacheDirectory: true });
      if (r.canceled) return;
      const a = r.assets[0];
      setText(a.file ? await a.file.text() : await new File(a.uri).text());
    } catch {
      setError(READ_ERROR);
    }
  };

  const save = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      setDone(await importWorkouts(preview, Intl.DateTimeFormat().resolvedOptions().timeZone));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't import your workouts.");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Screen title="Import Workouts" back>
        <Text accessibilityLiveRegion="polite" style={[styles.body, { color: c.ink }]}>
          {done.added === 1 ? 'Imported 1 workout.' : `Imported ${done.added} workouts.`}
          {done.existing ? ` ${done.existing} ${done.existing === 1 ? 'was' : 'were'} already here and stayed as they are.` : ''}
        </Text>
        <Button label="Done" onPress={() => router.replace('/workouts')} />
      </Screen>
    );
  }

  return (
    <Screen title="Import Workouts" back>
      {!preview && (
        <Text style={[styles.body, { color: c.inkSoft }]}>
          Bring in your history from {FORMATS.map((f) => f.label).join(', ')}. Export a CSV in that app, then share it to Leaderboard or choose it here.
          You&apos;ll see what&apos;s in it before anything is saved.
        </Text>
      )}
      <Button secondary={!!preview} label={preview ? 'Choose Another File' : 'Choose File'} onPress={() => void pick()} />
      <ErrorText>{error ?? result?.error}</ErrorText>
      {preview && (
        <>
          <Section title="In this file" footer="Imported workouts are private until you share workouts with a group, and you can edit them like ones you log here.">
            <Row label="App" value={preview.format.label} />
            <Row label="Workouts" value={String(preview.workouts.length)} />
            <Row label="Dates" value={preview.first.toDateString() === preview.last.toDateString() ? dateText(preview.first) : `${dateText(preview.first)} to ${dateText(preview.last)}`} />
            <Row label="Sets" value={String(preview.sets)} last />
          </Section>
          {!preview.unitsInFile && (
            <>
              <Text style={[styles.body, { color: c.ink }]}>
                This file doesn&apos;t say which units it uses. Pick the ones you use in {preview.format.label}.
              </Text>
              <Segmented label="Weight unit" options={[{ value: 'kg', label: 'kg' }, { value: 'lb', label: 'lb' }] as const} value={units.weight} onChange={setWeight} />
              <Segmented label="Distance unit" options={[{ value: 'km', label: 'km' }, { value: 'mi', label: 'mi' }] as const} value={distance} onChange={setDistance} />
            </>
          )}
          {added.length > 0 && (
            <Section title={`New exercises (${added.length})`} footer="These don't match an exercise you have, so they'll be added as your own exercises.">
              {added.slice(0, LIST_MAX).map((n, i, all) => (
                <Row key={n} label={n} last={i === all.length - 1 && added.length <= LIST_MAX} />
              ))}
              {added.length > LIST_MAX && <Row label={`And ${added.length - LIST_MAX} more`} last />}
            </Section>
          )}
          {preview.skipped.length > 0 && (
            <Section title={`Skipped rows (${preview.skipped.length})`} footer="These rows won't be imported. Everything else will.">
              {preview.skipped.slice(0, LIST_MAX).map((s, i, all) => (
                <Row key={s.row} label={`Row ${s.row}`} value={s.reason} last={i === all.length - 1 && preview.skipped.length <= LIST_MAX} />
              ))}
              {preview.skipped.length > LIST_MAX && <Row label={`And ${preview.skipped.length - LIST_MAX} more`} last />}
            </Section>
          )}
          <Text style={[styles.caption, { color: c.inkSoft }]}>
            Not saved to Apple Health: {preview.format.label} usually does that already. When Apple Health has the same session, Leaderboard counts it once, using the detailed one from this file.
          </Text>
          <Button
            label={preview.workouts.length === 1 ? 'Import 1 Workout' : `Import ${preview.workouts.length} Workouts`}
            busy={busy}
            onPress={() => void save()}
          />
        </>
      )}
    </Screen>
  );
}
