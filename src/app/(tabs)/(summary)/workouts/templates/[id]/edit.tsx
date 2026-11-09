import { useLocalSearchParams } from 'expo-router';
import { TemplateEditor } from '@/components/workouts/TemplateEditor';
export default function EditTemplate() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <TemplateEditor key={id} id={id} />;
}
