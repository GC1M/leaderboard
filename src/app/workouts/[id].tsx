import { useLocalSearchParams } from 'expo-router';

import { WorkoutEditor } from '@/components/workouts/WorkoutEditor';

export default function EditWorkout() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <WorkoutEditor id={id} />;
}
