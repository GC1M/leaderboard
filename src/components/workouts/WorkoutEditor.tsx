import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Text } from 'react-native';

import { WorkoutFields } from './WorkoutFields';
import { useEditorNavigation } from '@/lib/editor-navigation';
import { loadDistanceUnit } from '@/lib/distance-unit';
import { ExercisePicker } from '@/components/workouts/ExercisePicker';
import { useWorkoutExport, WorkoutExportOption } from '@/components/workouts/WorkoutExportOption';
import { Button, ErrorText, Row, Screen, Section, Skeleton, styles } from '@/components/ui';
import { alert } from '@/lib/alert';
import { useAuth } from '@/lib/auth';
import { localDateKey, readingDateLabel } from '@/lib/health/dates';
import { loadWeightUnit } from '@/lib/weight-unit';
import { clearDraft, loadDraft, saveDraft } from '@/lib/workout-draft';
import {
  buildWorkout, categoryForActivity, durationError, type DistanceUnit, emptyForm, emptySet, formFromDetail,
  type WorkoutForm, workoutSummary,
} from '@/lib/workout-form';
import { applyTemplate, buildTemplate, isDay } from '@/lib/workout-template-form';
import { createTemplate, getTemplate } from '@/lib/workout-templates';
import {
  createManualWorkout, type Exercise, type ExerciseCategory, getWorkout, listExercises, updateManualWorkout, type WorkoutDetail,
} from '@/lib/workouts';
import { useTheme } from '@/theme';

type Draft = NonNullable<Awaited<ReturnType<typeof loadDraft>>>;

// New workout (no id) or edit a manual one. Typing is kept as a local draft until saved or discarded.
// A new workout can start from a template (a copy on the given day, not linked to it).
export function WorkoutEditor({ id, templateId, day }: { id?: string; templateId?: string; day?: string }) {
  const c = useTheme();
  const router = useRouter();
  const uid = useAuth().session?.user.id ?? '';
  const [changed, setChanged] = useState(false);
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
      const [weightUnit, w, draft, catalog, template, distanceUnit] = await Promise.all([
        loadWeightUnit(),
        id ? getWorkout(id) : null,
        loadDraft(uid, id ?? null),
        listExercises().catch(() => [] as Exercise[]),
        !id && templateId ? getTemplate(templateId) : null,
        loadDistanceUnit(),
      ]);
      if (!live) return;
      if (id && !w) return setLoadError("That workout doesn't exist anymore.");
      if (!id && templateId && !template) return setLoadError("That template doesn't exist anymore.");
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
    setChanged(true);
    setError(null);
    setForm((x) => (x ? f(x) : x));
  };
  const leave = useEditorNavigation(changed && !busy, async () => {
    if (form) await saveDraft(uid, { editingId: id ?? null, form });
    done.current = true;
  }, async () => { done.current = true; await clearDraft(uid, id ?? null); });
  const finish = async (savedId?: string) => {
    done.current = true;
    await clearDraft(uid, id ?? null);
    leave(() => {
      // Remove completed routes, including an editor opened through a direct link.
      router.dismissTo('/workouts');
      if (savedId) router.push(`/workouts/${savedId}`);
    });
  };
  const cancel = () => router.canGoBack() ? router.back() : (changed
    ? alert('Unsaved changes', 'Keep editing, save a draft, or discard.', [
      { text: 'Keep Editing', style: 'cancel' },
      { text: 'Save Draft', onPress: () => { flush(); done.current = true; leave(() => router.dismissTo('/workouts')); } },
      { text: 'Discard Changes', style: 'destructive', onPress: () => void finish() },
    ]) : router.dismissTo('/workouts'));

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
      <Screen title={id ? 'Edit Workout' : 'New Workout'} back backLabel="Cancel" onBack={cancel}>
        <Text style={[styles.body, { color: c.ink }]}>You have an unfinished {id ? 'edit' : 'workout'} from earlier. Pick up where you left off?</Text>
        <Button label="Resume Draft" onPress={() => { dirty.current = true; setChanged(true); setForm(pending.form); setPending(null); }} />
        <Button label="Start Over" secondary onPress={() => { void clearDraft(uid, id ?? null); setPending(null); }} />
      </Screen>
    );

  if (picking)
    return (
      <Screen title="Add Exercise" back onBack={() => setPicking(false)}>
        <ExercisePicker
          initialCategory={form.category ?? categoryForActivity(form.activityType)}
          onCancel={() => setPicking(false)}
          onPick={(e) => {
            edit((x) => ({ ...x, exercises: [...x.exercises, { exerciseId: e.id, name: e.name, category: e.category, sets: [emptySet()] }] }));
            setPicking(false);
          }}
        />
      </Screen>
    );

  const save = async () => {
    if (busy) return;
    const r = buildWorkout(form);
    if (!r.ok) return setError(r.message);
    setError(null);
    setBusy(true);
    try {
      let savedId = id;
      if (id) await updateManualWorkout(id, r.input);
      else savedId = await createManualWorkout(r.input);
      void health.saved(savedId!, r.input);
      await finish(savedId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save your workout.");
      setBusy(false);
    }
  };

  // Keeps what is on screen as a template named after the activity, then opens it to rename or refine.
  const saveAsTemplate = async () => {
    if (!form.activityType.trim()) return setError('Choose a workout type first. It names the template.');
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

  return (
    <Screen title={id ? 'Edit Workout' : 'New Workout'} back backLabel="Cancel" onBack={cancel}>
      <WorkoutFields form={form} edit={edit} onAddExercise={() => setPicking(true)} onError={setError} durationError={error ? durationError(form) : null} />

      <WorkoutExportOption id={id} choice={health} />
      <Text style={[styles.caption, { color: c.inkSoft }]}>Only you can see your workouts. Calories are not tracked for manual entries.</Text>
      <ErrorText>{error}</ErrorText>
      <Button label="Save Workout" busy={busy} onPress={save} />
      <Button secondary label="Save as Template" busy={savingTemplate} onPress={saveAsTemplate} />
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
