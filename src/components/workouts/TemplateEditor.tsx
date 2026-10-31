import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Text } from 'react-native';
import { ExercisePicker } from './ExercisePicker';
import { WorkoutFields } from './WorkoutFields';
import { Button, ErrorText, Field, Screen, Skeleton, styles } from '@/components/ui';
import { alert } from '@/lib/alert';
import { useAuth } from '@/lib/auth';
import { useEditorNavigation } from '@/lib/editor-navigation';
import { loadDistanceUnit } from '@/lib/distance-unit';
import { loadWeightUnit } from '@/lib/weight-unit';
import { categoryForActivity, emptyForm, emptySet, type WorkoutForm } from '@/lib/workout-form';
import { clearTemplateDraft, loadTemplateDraft, saveTemplateDraft } from '@/lib/workout-template-draft';
import { buildTemplate, templateToForm, type TemplateDraft } from '@/lib/workout-template-form';
import { createTemplate, getTemplate, updateTemplate } from '@/lib/workout-templates';
import { listExercises } from '@/lib/workouts';
import { useTheme } from '@/theme';

type State = { name: string; form: WorkoutForm };
// Duplicating reads a saved template into an unsaved editor. No server write until Save Template.
export function TemplateEditor({ id, duplicateId }: { id?: string; duplicateId?: string }) {
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
  const [tries, setTries] = useState(0);
  const done = useRef(false);
  useEffect(() => {
    let live = true;
    Promise.all([loadWeightUnit(), loadDistanceUnit(), id || duplicateId ? getTemplate((id || duplicateId)!) : null, loadTemplateDraft(uid, id ?? null), listExercises().catch(() => [])]).then(([weight, distance, t, draft, catalog]) => {
      if (!live) return;
      if ((id || duplicateId) && !t) return setLoadError("That template doesn't exist anymore.");
      const categories = new Map(catalog.map((e) => [e.id, e.category]));
      setState(t ? { name: duplicateId ? `${t.name} (copy)`.slice(0, 80) : t.name, form: templateToForm(t, weight, distance, categories, new Date()) } : { name: '', form: emptyForm(new Date(), weight, distance) });
      setChanged(!!duplicateId);
      done.current = false;
      setPending(draft);
    }).catch((e) => live && setLoadError(e instanceof Error ? e.message : "Couldn't load this template."));
    return () => { live = false; };
  }, [id, duplicateId, uid, tries]);
  const latest = useRef({ state, pending, uid, id, changed });
  useEffect(() => { latest.current = { state, pending, uid, id, changed }; });
  const persist = useCallback(async () => {
    const { state: s, pending: p, uid: u, id: i, changed: dirty } = latest.current;
    if (s && dirty && !p && !done.current) await saveTemplateDraft(u, { editingId: i ?? null, ...s });
  }, []);
  useEffect(() => { const timer = setTimeout(() => void persist(), 400); return () => clearTimeout(timer); }, [state, persist]);
  useFocusEffect(useCallback(() => () => { void persist(); }, [persist]));
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s !== 'active') void persist(); });
    return () => { sub.remove(); void persist(); };
  }, [persist]);
  const clear = async () => { done.current = true; await clearTemplateDraft(uid, id ?? null); };
  const leave = useEditorNavigation(changed && !busy, persist, clear);
  const finish = async (savedId?: string) => {
    await clear();
    leave(() => { router.dismissTo('/workouts/templates'); if (savedId) router.push(`/workouts/templates/${savedId}`); });
  };
  const cancel = () => {
    if (router.canGoBack()) return router.back();
    if (!changed) return router.dismissTo('/workouts/templates');
    alert('Unsaved changes', 'Keep editing, save a draft, or discard.', [
      { text: 'Keep Editing', style: 'cancel' },
      { text: 'Save Draft', onPress: () => void persist().then(() => { done.current = true; leave(() => router.dismissTo('/workouts/templates')); }) },
      { text: 'Discard Changes', style: 'destructive', onPress: () => void finish() },
    ]);
  };
  const edit = (f: (s: State) => State) => { setChanged(true); setError(null); setState((s) => s ? f(s) : s); };
  const editForm = (f: (s: WorkoutForm) => WorkoutForm) => edit((s) => ({ ...s, form: f(s.form) }));
  const save = async () => {
    if (!state || busy) return;
    const r = buildTemplate(state.name, state.form);
    if (!r.ok) return setError(r.message);
    setBusy(true); setError(null);
    try { if (id) await updateTemplate(id, r.input); const savedId = id ?? await createTemplate(r.input); await finish(savedId); }
    catch (e) { setError(e instanceof Error ? e.message : "Couldn't save your template."); setBusy(false); }
  };
  if (loadError) return <Screen title="Template" back><ErrorText>{loadError}</ErrorText><Button plain label="Try Again" onPress={() => { setLoadError(null); setTries((t) => t + 1); }} /></Screen>;
  if (!state) return <Screen title="Template" back><Skeleton label="Loading template" /></Screen>;
  if (pending) return <Screen title="Template" back backLabel="Cancel" onBack={cancel}>
    <Text style={[styles.body, { color: c.ink }]}>You have an unfinished template. Pick up where you left off?</Text>
    <Button label="Resume Draft" onPress={() => { setState({ name: pending.name, form: pending.form }); setChanged(true); setPending(null); }} />
    <Button secondary label="Start Over" onPress={() => { void clearTemplateDraft(uid, id ?? null); setPending(null); }} />
  </Screen>;
  if (picking) return <Screen title="Add Exercise" back onBack={() => setPicking(false)}><ExercisePicker initialCategory={state.form.category ?? categoryForActivity(state.form.activityType)} onCancel={() => setPicking(false)} onPick={(e) => { editForm((f) => ({ ...f, exercises: [...f.exercises, { exerciseId: e.id, name: e.name, category: e.category, sets: [emptySet()] }] })); setPicking(false); }} /></Screen>;
  return <Screen title={id ? 'Edit Template' : duplicateId ? 'Duplicate Template' : 'New Template'} back backLabel="Cancel" onBack={cancel}>
    <Field label="Template name" value={state.name} onChangeText={(v) => edit((s) => ({ ...s, name: v }))} placeholder="Push day" />
    <WorkoutFields template form={state.form} edit={editForm} onAddExercise={() => setPicking(true)} onError={setError} />
    <Text style={[styles.caption, { color: c.inkSoft }]}>Only you can see your templates. Save this template before starting a workout from it.</Text>
    <ErrorText>{error}</ErrorText><Button label="Save Template" busy={busy} onPress={() => void save()} />
  </Screen>;
}
