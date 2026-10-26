import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Text, View } from 'react-native';

import { Segmented } from '@/components/history/Segmented';
import { ExercisePicker } from '@/components/workouts/ExercisePicker';
import { Button, ErrorText, Field, Screen, Skeleton, styles } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { localDateKey } from '@/lib/health/dates';
import { loadWeightUnit, saveWeightUnit } from '@/lib/weight-unit';
import { convertUnits, defaultDistanceUnit, type DistanceUnit, emptyForm, emptySet, type ExerciseForm, fieldsFor, type SetField, type WorkoutForm } from '@/lib/workout-form';
import { clearTemplateDraft, loadTemplateDraft, saveTemplateDraft } from '@/lib/workout-template-draft';
import { buildTemplate, isDay, templateToForm, type TemplateDraft } from '@/lib/workout-template-form';
import { createTemplate, deleteTemplate, duplicateTemplate, getTemplate, updateTemplate } from '@/lib/workout-templates';
import { type Exercise, type ExerciseCategory, listExercises } from '@/lib/workouts';
import { useTheme } from '@/theme';

type State = { name: string; form: WorkoutForm };

const LABEL: Record<SetField, (f: WorkoutForm) => string> = {
  reps: () => 'Reps',
  load: (f) => `Load (${f.weightUnit})`,
  duration: () => 'Time (min)',
  distance: (f) => `Distance (${f.distanceUnit})`,
};

// New template (no id) or edit one. Typing is kept as a local draft until saved or discarded. An existing
// template can also start a workout on a chosen day, which opens the workout editor filled in from it.
export function TemplateEditor({ id }: { id?: string }) {
  const c = useTheme();
  const router = useRouter();
  const uid = useAuth().session?.user.id ?? '';
  const [state, setState] = useState<State | null>(null);
  const [pending, setPending] = useState<TemplateDraft | null>(null);
  const [picking, setPicking] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);
  const [day, setDay] = useState(() => localDateKey(new Date()));
  const [tries, setTries] = useState(0);
  const dirty = useRef(false);
  const done = useRef(false);

  useEffect(() => {
    let live = true;
    (async () => {
      const [weightUnit, t, draft, catalog] = await Promise.all([
        loadWeightUnit(),
        id ? getTemplate(id) : null,
        loadTemplateDraft(uid, id ?? null),
        listExercises().catch(() => [] as Exercise[]),
      ]);
      if (!live) return;
      if (id && !t) return setLoadError("That template doesn't exist anymore.");
      const distanceUnit = defaultDistanceUnit(Intl.DateTimeFormat().resolvedOptions().locale);
      const categories = new Map<string, ExerciseCategory>(catalog.map((e) => [e.id, e.category]));
      const now = new Date();
      setState(t ? { name: t.name, form: templateToForm(t, weightUnit, distanceUnit, categories, now) } : { name: '', form: emptyForm(now, weightUnit, distanceUnit) });
      if (draft) setPending(draft);
    })().catch((e) => live && setLoadError(e instanceof Error ? e.message : "Couldn't load this template."));
    return () => { live = false; };
  }, [id, uid, tries]);

  // Keep the draft: a moment after the last keystroke, and at once when the screen loses focus or
  // unmounts or the app goes to the background. Not while the resume offer is open, never after finishing.
  const latest = useRef({ state, pending, uid, id });
  useEffect(() => { latest.current = { state, pending, uid, id }; });
  const flush = useCallback(() => {
    const { state: s, pending: p, uid: u, id: i } = latest.current;
    if (s && dirty.current && !p && !done.current) void saveTemplateDraft(u, { editingId: i ?? null, ...s });
  }, []);
  useEffect(() => {
    const t = setTimeout(flush, 400);
    return () => clearTimeout(t);
  }, [state, flush]);
  useFocusEffect(useCallback(() => flush, [flush]));
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s !== 'active' && flush());
    return () => { sub.remove(); flush(); };
  }, [flush]);

  const edit = (f: (x: State) => State) => {
    dirty.current = true;
    setChanged(true);
    setState((x) => (x ? f(x) : x));
  };
  const editForm = (f: (x: WorkoutForm) => WorkoutForm) => edit((x) => ({ ...x, form: f(x.form) }));
  const setExercise = (i: number, f: (e: ExerciseForm) => ExerciseForm) =>
    editForm((x) => ({ ...x, exercises: x.exercises.map((e, j) => (j === i ? f(e) : e)) }));
  const finish = async () => {
    done.current = true;
    await clearTemplateDraft(uid, id ?? null);
    router.replace('/workouts/templates');
  };

  if (loadError)
    return (
      <Screen title="Template" back>
        <ErrorText>{loadError}</ErrorText>
        {!/exist/.test(loadError) && <Button plain label="Try Again" onPress={() => { setLoadError(null); setTries((t) => t + 1); }} />}
      </Screen>
    );
  if (!state) return <Screen title="Template" back><Skeleton label="Loading template" /></Screen>;
  const { name, form } = state;

  if (pending)
    return (
      <Screen title={id ? 'Edit Template' : 'New Template'} back>
        <Text style={[styles.body, { color: c.ink }]}>You have an unfinished {id ? 'edit' : 'template'} from earlier. Pick up where you left off?</Text>
        <Button label="Resume Draft" onPress={() => { setState({ name: pending.name, form: pending.form }); setChanged(true); setPending(null); }} />
        <Button label="Start Over" secondary onPress={() => { void clearTemplateDraft(uid, id ?? null); setPending(null); }} />
      </Screen>
    );

  if (picking)
    return (
      <Screen title="Add Exercise" back>
        <ExercisePicker
          onCancel={() => setPicking(false)}
          onPick={(e) => {
            editForm((x) => ({ ...x, exercises: [...x.exercises, { exerciseId: e.id, name: e.name, category: e.category, sets: [emptySet()] }] }));
            setPicking(false);
          }}
        />
      </Screen>
    );

  const save = async () => {
    const r = buildTemplate(name, form);
    if (!r.ok) return setError(r.message);
    setError(null);
    setBusy(true);
    try {
      if (id) await updateTemplate(id, r.input);
      else await createTemplate(r.input);
      await finish();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save your template.");
      setBusy(false);
    }
  };

  const duplicate = async () => {
    setError(null);
    setBusy(true);
    try {
      router.replace(`/workouts/templates/${await duplicateTemplate(id!)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't duplicate that template.");
      setBusy(false);
    }
  };

  const start = () => {
    if (!isDay(day)) return setError('Enter the day as YYYY-MM-DD.');
    setError(null);
    router.push(`/workouts/new?template=${id}&date=${day.trim()}`);
  };

  const confirm = (title: string, message: string, action: string, run: () => Promise<void>) =>
    Alert.alert(title, message, [{ text: 'Cancel', style: 'cancel' }, { text: action, style: 'destructive', onPress: () => void run() }]);

  const remove = () =>
    confirm('Delete this template?', 'Workouts you already made from it are not affected.', 'Delete', async () => {
      try {
        await deleteTemplate(id!);
        await finish();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't delete that template.");
      }
    });

  const changeUnits = (w: WorkoutForm['weightUnit'], d: DistanceUnit) => {
    if (w !== form.weightUnit) void saveWeightUnit(w);
    editForm((x) => convertUnits(x, w, d));
  };

  return (
    <Screen title={id ? 'Edit Template' : 'New Template'} back>
      {id && (
        <View style={{ gap: 12 }}>
          <Field label="Start a workout on" value={day} onChangeText={setDay} placeholder="2026-10-26" keyboardType="numbers-and-punctuation" autoCorrect={false} helper={changed ? 'Save your changes first. A workout starts from the saved template.' : 'Opens a new workout filled in from this template. Your template is not changed.'} />
          <Button label="Start Workout" disabled={changed} onPress={start} />
        </View>
      )}

      <Field label="Template name" value={name} onChangeText={(v) => edit((x) => ({ ...x, name: v }))} placeholder="Push day" autoCapitalize="words" />
      <Field label="Activity" value={form.activityType} onChangeText={(v) => editForm((x) => ({ ...x, activityType: v }))} placeholder="Strength, Running, Yoga" autoCapitalize="words" />
      <Field label="Planned duration (min)" value={form.durationMin} onChangeText={(v) => editForm((x) => ({ ...x, durationMin: v }))} keyboardType="decimal-pad" placeholder="Optional" />
      <Field label="Notes" value={form.notes} onChangeText={(v) => editForm((x) => ({ ...x, notes: v }))} multiline />

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
          <Button plain danger label={`Remove ${e.name}`} onPress={() => editForm((x) => ({ ...x, exercises: x.exercises.filter((_, n) => n !== i) }))} />
        </View>
      ))}
      <Button secondary label="Add Exercise" onPress={() => setPicking(true)} />

      <Text style={[styles.caption, { color: c.inkSoft }]}>Only you can see your templates. Loads and times are the plan; you adjust them when you log the workout.</Text>
      <ErrorText>{error}</ErrorText>
      <Button label="Save Template" busy={busy} onPress={save} />
      {id && <Button secondary label="Duplicate Template" disabled={busy || changed} onPress={duplicate} />}
      <Button
        plain
        label={id ? 'Discard Changes' : 'Discard'}
        onPress={() => confirm('Discard this entry?', 'Your unsaved changes are deleted.', 'Discard', async () => { await finish(); })}
      />
      {id && <Button plain danger label="Delete Template" onPress={remove} />}
    </Screen>
  );
}
