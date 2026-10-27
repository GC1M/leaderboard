import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Text, View } from 'react-native';

import { Segmented } from '@/components/history/Segmented';
import { ExercisePicker } from '@/components/workouts/ExercisePicker';
import { useWorkoutExport, WorkoutExportOption } from '@/components/workouts/WorkoutExportOption';
import { Button, ErrorText, Field, Row, Screen, Section, Skeleton, styles } from '@/components/ui';
import { alert } from '@/lib/alert';
import { useAuth } from '@/lib/auth';
import { localDateKey, readingDateLabel } from '@/lib/health/dates';
import { loadWeightUnit, saveWeightUnit } from '@/lib/weight-unit';
import { clearDraft, loadDraft, saveDraft } from '@/lib/workout-draft';
import {
  buildWorkout, convertUnits, defaultDistanceUnit, type DistanceUnit, emptyForm, emptySet, type ExerciseForm, fieldsFor, formFromDetail,
  type SetField, type WorkoutForm, workoutSummary,
} from '@/lib/workout-form';
import { applyTemplate, buildTemplate, isDay } from '@/lib/workout-template-form';
import { createTemplate, getTemplate } from '@/lib/workout-templates';
import {
  createManualWorkout, deleteWorkout, type Exercise, type ExerciseCategory, getWorkout, listExercises, updateManualWorkout, type WorkoutDetail,
} from '@/lib/workouts';
import { useTheme } from '@/theme';

type Draft = NonNullable<Awaited<ReturnType<typeof loadDraft>>>;

const LABEL: Record<SetField, (f: WorkoutForm) => string> = {
  reps: () => 'Reps',
  load: (f) => `Load (${f.weightUnit})`,
  duration: () => 'Time (min)',
  distance: (f) => `Distance (${f.distanceUnit})`,
};

// New workout (no id) or edit a manual one. Typing is kept as a local draft until saved or discarded.
// A new workout can start from a template (a copy on the given day, not linked to it).
export function WorkoutEditor({ id, templateId, day }: { id?: string; templateId?: string; day?: string }) {
  const c = useTheme();
  const router = useRouter();
  const uid = useAuth().session?.user.id ?? '';
  const [form, setForm] = useState<WorkoutForm | null>(null);
  const [detail, setDetail] = useState<WorkoutDetail | null>(null);
  const [pending, setPending] = useState<Draft | null>(null);
  const [picking, setPicking] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [tries, setTries] = useState(0);
  const dirty = useRef(false);
  const done = useRef(false);
  const health = useWorkoutExport(detail?.source ?? 'manual');

  useEffect(() => {
    let live = true;
    (async () => {
      const [weightUnit, w, draft, catalog, template] = await Promise.all([
        loadWeightUnit(),
        id ? getWorkout(id) : null,
        loadDraft(uid, id ?? null),
        listExercises().catch(() => [] as Exercise[]),
        !id && templateId ? getTemplate(templateId) : null,
      ]);
      if (!live) return;
      if (id && !w) return setLoadError("That workout doesn't exist anymore.");
      if (!id && templateId && !template) return setLoadError("That template doesn't exist anymore.");
      const distanceUnit = defaultDistanceUnit(Intl.DateTimeFormat().resolvedOptions().locale);
      const categories = new Map<string, ExerciseCategory>(catalog.map((e) => [e.id, e.category]));
      setDetail(w);
      const now = new Date();
      setForm(
        w ? formFromDetail(w, weightUnit, distanceUnit, categories)
          : template ? applyTemplate(template, day && isDay(day) ? day : localDateKey(now), weightUnit, distanceUnit, categories, now)
          : emptyForm(now, weightUnit, distanceUnit),
      );
      if (draft) setPending(draft);
    })().catch((e) => live && setLoadError(e instanceof Error ? e.message : "Couldn't load this workout."));
    return () => { live = false; };
  }, [id, templateId, day, uid, tries]);

  // Keep the draft: a moment after the last keystroke, and at once when the screen loses focus or
  // unmounts or the app goes to the background. Not while the resume offer is open, never after finishing.
  const latest = useRef({ form, pending, uid, id });
  useEffect(() => { latest.current = { form, pending, uid, id }; });
  const flush = useCallback(() => {
    const { form: f, pending: p, uid: u, id: i } = latest.current;
    if (f && dirty.current && !p && !done.current) void saveDraft(u, { editingId: i ?? null, form: f });
  }, []);
  useEffect(() => {
    const t = setTimeout(flush, 400);
    return () => clearTimeout(t);
  }, [form, flush]);
  useFocusEffect(useCallback(() => flush, [flush]));
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s !== 'active' && flush());
    return () => { sub.remove(); flush(); };
  }, [flush]);

  const edit = (f: (x: WorkoutForm) => WorkoutForm) => {
    dirty.current = true;
    setError(null);
    setForm((x) => (x ? f(x) : x));
  };
  const setExercise = (i: number, f: (e: ExerciseForm) => ExerciseForm) =>
    edit((x) => ({ ...x, exercises: x.exercises.map((e, j) => (j === i ? f(e) : e)) }));
  const finish = async () => {
    done.current = true;
    await clearDraft(uid, id ?? null);
    router.replace('/workouts');
  };

  if (loadError)
    return (
      <Screen title="Workout" back>
        <ErrorText>{loadError}</ErrorText>
        {!/exist/.test(loadError) && <Button plain label="Try Again" onPress={() => { setLoadError(null); setTries((t) => t + 1); }} />}
      </Screen>
    );
  if (!form) return <Screen title="Workout" back><Skeleton label="Loading workout" /></Screen>;

  if (detail?.source === 'healthkit') return <ImportedWorkout w={detail} unit={form.distanceUnit} />;

  if (pending)
    return (
      <Screen title={id ? 'Edit Workout' : 'New Workout'} back>
        <Text style={[styles.body, { color: c.ink }]}>You have an unfinished {id ? 'edit' : 'workout'} from earlier. Pick up where you left off?</Text>
        <Button label="Resume Draft" onPress={() => { setForm(pending.form); setPending(null); }} />
        <Button label="Start Over" secondary onPress={() => { void clearDraft(uid, id ?? null); setPending(null); }} />
      </Screen>
    );

  if (picking)
    return (
      <Screen title="Add Exercise" back>
        <ExercisePicker
          onCancel={() => setPicking(false)}
          onPick={(e) => {
            edit((x) => ({ ...x, exercises: [...x.exercises, { exerciseId: e.id, name: e.name, category: e.category, sets: [emptySet()] }] }));
            setPicking(false);
          }}
        />
      </Screen>
    );

  const save = async () => {
    const r = buildWorkout(form);
    if (!r.ok) return setError(r.message);
    setError(null);
    setBusy(true);
    try {
      let savedId = id;
      if (id) await updateManualWorkout(id, r.input);
      else savedId = await createManualWorkout(r.input);
      void health.saved(savedId!, r.input);
      await finish();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save your workout.");
      setBusy(false);
    }
  };

  const confirm = (title: string, message: string, action: string, run: () => Promise<void>) =>
    alert(title, message, [{ text: 'Cancel', style: 'cancel' }, { text: action, style: 'destructive', onPress: () => void run() }]);

  // Keeps what is on screen as a template named after the activity, then opens it to rename or refine.
  const saveAsTemplate = async () => {
    if (!form.activityType.trim()) return setError('Enter an activity type first. It names the template.');
    const r = buildTemplate(form.activityType, form);
    if (!r.ok) return setError(r.message);
    setError(null);
    setSavingTemplate(true);
    try {
      router.push(`/workouts/templates/${await createTemplate(r.input)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save your template.");
    }
    setSavingTemplate(false);
  };

  const remove = () =>
    confirm('Delete this workout?', 'It and its exercises are removed for good.', 'Delete', async () => {
      try {
        await deleteWorkout(id!);
        void health.deleted(id!);
        await finish();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't delete that workout.");
      }
    });

  const changeUnits = (w: WorkoutForm['weightUnit'], d: DistanceUnit) => {
    if (w !== form.weightUnit) void saveWeightUnit(w);
    edit((x) => convertUnits(x, w, d));
  };

  return (
    <Screen title={id ? 'Edit Workout' : 'New Workout'} back>
      <Field label="Activity" value={form.activityType} onChangeText={(v) => edit((x) => ({ ...x, activityType: v }))} placeholder="Strength, Running, Yoga" autoCapitalize="words" />
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Field label="Date" value={form.date} onChangeText={(v) => edit((x) => ({ ...x, date: v }))} placeholder="2026-10-26" keyboardType="numbers-and-punctuation" autoCorrect={false} />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Start time" value={form.time} onChangeText={(v) => edit((x) => ({ ...x, time: v }))} placeholder="18:30" keyboardType="numbers-and-punctuation" autoCorrect={false} />
        </View>
      </View>
      <Field label="Duration (min)" value={form.durationMin} onChangeText={(v) => edit((x) => ({ ...x, durationMin: v }))} keyboardType="decimal-pad" placeholder="45" />
      <Field label="Notes" value={form.notes} onChangeText={(v) => edit((x) => ({ ...x, notes: v }))} multiline />

      <Segmented label="Weight unit" options={[{ value: 'kg', label: 'kg' }, { value: 'lb', label: 'lb' }] as const} value={form.weightUnit} onChange={(w) => changeUnits(w, form.distanceUnit)} />
      <Segmented label="Distance unit" options={[{ value: 'km', label: 'km' }, { value: 'mi', label: 'mi' }] as const} value={form.distanceUnit} onChange={(d) => changeUnits(form.weightUnit, d)} />

      {form.exercises.map((e, i) => (
        <View key={i} style={{ gap: 12 }}>
          <Text accessibilityRole="header" style={[styles.heading, { color: c.ink }]}>{e.name}</Text>
          {e.sets.map((s, j) => {
            const shown = fieldsFor(e.category).concat((['reps', 'load', 'duration', 'distance'] as const).filter((k) => s[k] && !fieldsFor(e.category).includes(k)));
            return (
              <View key={j} style={{ gap: 8 }}>
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  {shown.map((k) => (
                    <View key={k} style={{ flex: 1 }}>
                      <Field
                        label={LABEL[k](form)}
                        accessibilityLabel={`${e.name} set ${j + 1} ${LABEL[k](form)}`}
                        value={s[k]}
                        keyboardType={k === 'reps' ? 'number-pad' : 'decimal-pad'}
                        onChangeText={(v) => setExercise(i, (x) => ({ ...x, sets: x.sets.map((t, n) => (n === j ? { ...t, [k]: v } : t)) }))}
                      />
                    </View>
                  ))}
                </View>
                <Button plain danger label={`Remove ${e.name} set ${j + 1}`} onPress={() => setExercise(i, (x) => ({ ...x, sets: x.sets.filter((_, n) => n !== j) }))} />
              </View>
            );
          })}
          <Button secondary label={`Add Set to ${e.name}`} onPress={() => setExercise(i, (x) => ({ ...x, sets: [...x.sets, { ...(x.sets[x.sets.length - 1] ?? emptySet()) }] }))} />
          <Button plain danger label={`Remove ${e.name}`} onPress={() => edit((x) => ({ ...x, exercises: x.exercises.filter((_, n) => n !== i) }))} />
        </View>
      ))}
      <Button secondary label="Add Exercise" onPress={() => setPicking(true)} />

      <WorkoutExportOption id={id} choice={health} />
      <Text style={[styles.caption, { color: c.inkSoft }]}>Only you can see your workouts. Calories are not tracked for manual entries.</Text>
      <ErrorText>{error}</ErrorText>
      <Button label="Save Workout" busy={busy} onPress={save} />
      <Button secondary label="Save as Template" busy={savingTemplate} onPress={saveAsTemplate} />
      <Button
        plain
        label={id ? 'Discard Changes' : 'Discard'}
        onPress={() => confirm('Discard this entry?', 'Your unsaved changes are deleted.', 'Discard', async () => { await finish(); })}
      />
      {id && <Button plain danger label="Delete Workout" onPress={remove} />}
    </Screen>
  );
}

// Imported from Health: shown, never editable here.
function ImportedWorkout({ w, unit }: { w: WorkoutDetail; unit: DistanceUnit }) {
  const c = useTheme();
  return (
    <Screen title={w.activity_type} back>
      <Section footer="Imported from Apple Health. Change it in Health, and it updates here after the next import.">
        <Row label="Date" value={readingDateLabel(new Date(w.started_at))} />
        <Row label="Summary" value={workoutSummary(w, unit)} last />
      </Section>
      {w.notes && <Text style={[styles.body, { color: c.ink }]}>{w.notes}</Text>}
    </Screen>
  );
}
