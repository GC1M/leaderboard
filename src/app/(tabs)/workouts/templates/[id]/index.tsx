import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text } from 'react-native';
import { Button, ErrorText, Row, Screen, Section, Skeleton, styles } from '@/components/ui';
import { DateField, Overflow } from '@/components/inputs';
import { alert } from '@/lib/alert';
import { localDateKey } from '@/lib/health/dates';
import { formatSleep } from '@/lib/health/format';
import { deleteTemplate, getTemplate, type TemplateDetail } from '@/lib/workout-templates';
import { useTheme } from '@/theme';
export default function TemplateDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const c = useTheme();
  const [template, setTemplate] = useState<TemplateDetail | null>();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [day, setDay] = useState(new Date());
  const load = useCallback(() => { let live = true; setError(null); void getTemplate(id).then((t) => { if (live) setTemplate(t); }, (e) => { if (live) setError(e.message); }); return () => { live = false; }; }, [id]);
  useFocusEffect(load);
  const remove = () => alert(`Delete ${template?.name}?`, 'This cannot be undone. Existing workouts are kept.', [
    { text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => { if (busy) return; setBusy(true); try { await deleteTemplate(id); router.dismissTo('/workouts/templates'); } catch (e) { setError((e as Error).message); setBusy(false); } } },
  ]);
  return <Screen title={template?.name ?? 'Template'} back headerActions={template && <Button plain label="Edit" onPress={() => router.push(`/workouts/templates/${id}/edit`)} />}>
    <ErrorText>{error}</ErrorText>{error && <Button plain label="Try Again" onPress={load} />}
    {template === undefined ? <Skeleton label="Loading template" /> : template === null ? <ErrorText>That template no longer exists.</ErrorText> : <>
      <Section><Row label="Workout type" value={template.activity_type} /><Row label="Planned duration" value={template.duration_s == null ? 'Not planned' : formatSleep(template.duration_s / 60)} last /></Section>
      <Section title="Exercises">{template.exercises.map((e, i, all) => <Row key={e.id} label={e.name} value={`${e.sets.length} ${e.sets.length === 1 ? 'set' : 'sets'}`} last={i === all.length - 1} />)}</Section>
      {!!template.notes && <Text style={[styles.body, { color: c.ink }]}>{template.notes}</Text>}
      <DateField label="Start a workout on" mode="date" value={day} onChange={setDay} />
      <Button label="Start Workout" disabled={busy} onPress={() => router.push(`/workouts/new?template=${id}&date=${localDateKey(day)}`)} />
      <Button secondary label="Duplicate Template" disabled={busy} onPress={() => router.push(`/workouts/templates/new?duplicate=${id}`)} />
      <Overflow name={template.name}><Row label="Delete Template" danger last disabled={busy} onPress={remove} /></Overflow>
    </>}
  </Screen>;
}
