import { useLocalSearchParams } from 'expo-router';
import { TemplateEditor } from '@/components/workouts/TemplateEditor';
export default function NewTemplate() {
  const { duplicate } = useLocalSearchParams<{ duplicate?: string }>();
  return <TemplateEditor key={duplicate ?? 'new'} duplicateId={duplicate} />;
}
