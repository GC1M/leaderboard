import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';

import { WorkoutDetailView } from '@/components/workouts/WorkoutDetailView';
import { Button, ErrorText, Screen, Skeleton } from '@/components/ui';
import { useWeightUnit } from '@/lib/weight-unit';
import { defaultDistanceUnit } from '@/lib/workout-form';
import { getWorkout, type WorkoutDetail } from '@/lib/workouts';

// Read-only session detail. Manual and file-imported workouts offer Edit; Health ones are changed in Health.
export default function WorkoutDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [unit] = useWeightUnit();
  const [w, setW] = useState<WorkoutDetail | null | undefined>(); // undefined: loading, null: gone
  const [error, setError] = useState<string | null>(null);
  const distanceUnit = defaultDistanceUnit(Intl.DateTimeFormat().resolvedOptions().locale);

  const load = useCallback(() => {
    setError(null);
    getWorkout(id).then(setW, (e) => setError(e instanceof Error ? e.message : "Couldn't load this workout."));
  }, [id]);
  useFocusEffect(load);

  return (
    <Screen title={w?.activity_type ?? 'Workout'} back>
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
          {w.source !== 'healthkit' && <Button label="Edit Workout" onPress={() => router.replace(`/workouts/${w.id}/edit`)} />}
        </>
      )}
    </Screen>
  );
}
