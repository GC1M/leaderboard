import { useLocalSearchParams } from 'expo-router';

import { WorkoutEditor } from '@/components/workouts/WorkoutEditor';

export default function NewWorkout() {
  const { template, date } = useLocalSearchParams<{ template?: string; date?: string }>();
  return <WorkoutEditor templateId={template} day={date} />;
}
