import { Text, View } from 'react-native';
import { useRef, useState } from 'react';
import { Segmented } from '@/components/history/Segmented';
import { Button, Field, styles, useLargeText } from '@/components/ui';
import { DateField, DropdownField, DurationField, NumberField, RemoveButton } from '@/components/inputs';
import { categoryForActivity, changeCategory, convertUnits, emptySet, fieldsFor, WORKOUT_CATEGORIES, type WorkoutForm } from '@/lib/workout-form';
import { formatLocalDateTime, localDateKey, parseLocalDateTime } from '@/lib/health/dates';
import { useTheme } from '@/theme';

// Shared editor surface keeps templates and workouts consistent. Dates only belong to a workout.
export function WorkoutFields({ form, edit, template, onAddExercise, onError, durationError }: { form: WorkoutForm; edit: (f: (x: WorkoutForm) => WorkoutForm) => void; template?: boolean; onAddExercise: () => void; onError: (s: string) => void; durationError?: string | null }) {
  const c = useTheme();
  const large = useLargeText();
  const [units, setUnits] = useState(false);
  const category = form.category ?? categoryForActivity(form.activityType);
  const at = parseLocalDateTime(`${form.date} ${form.time}`) ?? new Date();
  // Switching units back, with no edits in between, restores the exact values rather than rounded conversions.
  const unitUndo = useRef<{ from: WorkoutForm; to: WorkoutForm } | null>(null);
  const changeUnits = (weight: WorkoutForm['weightUnit'], distance: WorkoutForm['distanceUnit']) => {
    try {
      const back = unitUndo.current;
      const next = back && back.to === form && back.from.weightUnit === weight && back.from.distanceUnit === distance ? back.from : convertUnits(form, weight, distance);
      unitUndo.current = { from: form, to: next };
      edit(() => next);
    } catch (e) { onError((e as Error).message); }
  };
  return <>
    <DropdownField label="Workout type" options={WORKOUT_CATEGORIES} value={category} onChange={(v) => edit((f) => changeCategory(f, v))} />
    {category !== 'full_body' && form.exercises.some((e) => e.category !== category) && <Text style={[styles.caption, { color: c.inkSoft }]}>Your existing exercises and measurements are kept when the workout type changes.</Text>}
    {!template && <>
      <DateField label="Date" mode="date" value={at} onChange={(v) => edit((f) => ({ ...f, date: localDateKey(v) }))} />
      <DateField label="Start time" mode="time" value={at} onChange={(v) => edit((f) => ({ ...f, time: formatLocalDateTime(v).slice(11) }))} />
    </>}
    <DurationField label={template ? 'Planned duration' : 'Duration'} value={form.durationMin} optional={template} saveError={durationError} onChange={(v) => edit((f) => ({ ...f, durationMin: v }))} />
    <Button plain label={`Units: ${form.weightUnit}, ${form.distanceUnit} · Change for this entry`} onPress={() => setUnits((v) => !v)} />
    {units && <View style={{ gap: 8 }}>
      <Text style={[styles.bodyStrong, { color: c.ink }]}>Weight and load</Text>
      <Segmented label="Weight and load unit for this entry" options={[{ value: 'kg', label: 'kg' }, { value: 'lb', label: 'lb' }] as const} value={form.weightUnit} onChange={(u) => changeUnits(u, form.distanceUnit)} />
      <Text style={[styles.bodyStrong, { color: c.ink }]}>Distance</Text>
      <Segmented label="Distance unit for this entry" options={[{ value: 'km', label: 'km' }, { value: 'mi', label: 'mi' }] as const} value={form.distanceUnit} onChange={(u) => changeUnits(form.weightUnit, u)} />
      <Text style={[styles.caption, { color: c.inkSoft }]}>Converts entered values. Set defaults in Profile → Preferences → Units.</Text>
    </View>}
    <Text accessibilityRole="header" style={[styles.heading, { color: c.ink }]}>Exercises</Text>
    {form.exercises.map((e, i) => <View key={`${i}-${e.exerciseId}`} style={{ gap: 12, borderWidth: 1, borderColor: c.border, borderRadius: 12, padding: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text accessibilityRole="header" style={[styles.heading, { color: c.ink, flex: 1 }]}>{e.name}</Text>
        <RemoveButton label={`Remove ${e.name}`} onPress={() => edit((f) => ({ ...f, exercises: f.exercises.filter((_, n) => n !== i) }))} />
      </View>
      {e.sets.map((s, j) => {
        const shown = [...new Set([...fieldsFor(e.category), ...(['reps', 'load', 'duration', 'distance'] as const).filter((k) => s[k])])];
        const update = (key: keyof typeof s, value: string) => edit((f) => ({ ...f, exercises: f.exercises.map((x, n) => n !== i ? x : { ...x, sets: x.sets.map((t, m) => m !== j ? t : { ...t, [key]: value }) }) }));
        return <View key={j} style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}><Text style={[styles.bodyStrong, { color: c.ink }]}>{`Set ${j + 1}`}</Text><RemoveButton label={`Remove ${e.name} set ${j + 1}`} onPress={() => edit((f) => ({ ...f, exercises: f.exercises.map((x, n) => n !== i ? x : { ...x, sets: x.sets.filter((_, m) => m !== j) }) }))} /></View>
          <View style={{ flexDirection: large ? 'column' : 'row', flexWrap: 'wrap', gap: 8 }}>
            {shown.map((k) => k === 'duration' ? <View key={k} style={{ width: '100%' }}><DurationField label={`${e.name} set ${j + 1} time`} value={s[k]} onChange={(v) => update(k, v)} /></View> : <View key={k} style={{ flex: large ? undefined : 1, minWidth: large ? undefined : 90 }}><NumberField label={k === 'reps' ? 'Reps' : k === 'load' ? `Load (${form.weightUnit})` : `Distance (${form.distanceUnit})`} accessibilityLabel={`${e.name} set ${j + 1} ${k}`} value={s[k]} whole={k === 'reps'} onChangeText={(v) => update(k, v)} /></View>)}
          </View>
        </View>;
      })}
      <Button secondary label={`Add Set to ${e.name}`} onPress={() => edit((f) => ({ ...f, exercises: f.exercises.map((x, n) => n !== i ? x : { ...x, sets: [...x.sets, { ...(x.sets.at(-1) ?? emptySet()) }] }) }))} />
    </View>)}
    <Button secondary label="Add Exercise" onPress={onAddExercise} />
    <Field label="Notes" value={form.notes} onChangeText={(v) => edit((f) => ({ ...f, notes: v }))} multiline />
  </>;
}
