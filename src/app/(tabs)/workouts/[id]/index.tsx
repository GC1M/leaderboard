import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';

import { WorkoutDetailView } from '@/components/workouts/WorkoutDetailView';
import { Button, ErrorText, Row, Screen, Skeleton } from '@/components/ui';
import { useWeightUnit } from '@/lib/weight-unit';
import { useDistanceUnit } from '@/lib/distance-unit';
import { Overflow } from '@/components/inputs';
import { alert } from '@/lib/alert';
import { useWorkoutExport } from '@/components/workouts/WorkoutExportOption';
import { deleteWorkout, getWorkout, type WorkoutDetail } from '@/lib/workouts';

// Read-only session detail. Manual and file-imported workouts offer Edit; Health ones are changed in Health.
export default function WorkoutDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [unit] = useWeightUnit();
  const [w, setW] = useState<WorkoutDetail | null | undefined>(); // undefined: loading, null: gone
  const [error, setError] = useState<string | null>(null);
  const [distanceUnit] = useDistanceUnit();
  const [busy, setBusy] = useState(false);
  const health = useWorkoutExport(w?.source ?? 'manual');
  const remove = () => alert(`Delete ${w?.activity_type} workout?`, 'This workout and its sets are removed for good.', [
    { text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => { if (busy) return; setBusy(true); try { await deleteWorkout(id); void health.deleted(id); router.dismissTo('/workouts'); } catch (e) { setError((e as Error).message); setBusy(false); } } },
  ]);

  const load = useCallback(() => {
    setError(null);
    getWorkout(id).then(setW, (e) => setError(e instanceof Error ? e.message : "Couldn't load this workout."));
  }, [id]);
  useFocusEffect(load);

  return (
    <Screen title={w?.activity_type ?? 'Workout'} back headerActions={w && w.source !== 'healthkit' && <Button plain label="Edit" disabled={busy} onPress={() => router.push(`/workouts/${w.id}/edit`)} />}>
      {error ? (
        <>
          <ErrorText>{error}</ErrorText>
          <Button plain label="Try Again" onPress={load} />
        </>
      ) : w === undefined ? (
        <Skeleton label="Loading workout" />
      ) : w === null ? (
        <ErrorText>{"That workout doesn't exist anymore."}</ErrorText>
      ) : (
        <>
          <WorkoutDetailView w={w} weightUnit={unit} distanceUnit={distanceUnit} />
          {w.source !== 'healthkit' && <Overflow name={w.activity_type}><Row label="Delete Workout" danger last disabled={busy} onPress={remove} /></Overflow>}
        </>
      )}
    </Screen>
  );
}
