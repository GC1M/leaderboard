import { useLocalSearchParams } from 'expo-router';

import { RecipeEditor } from '@/components/food/RecipeEditor';

export default function EditRecipe() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <RecipeEditor key={id} id={id} />;
}
