import { useLocalSearchParams } from 'expo-router';

import { RecipeEditor } from '@/components/food/RecipeEditor';

export default function NewRecipe() {
  const { duplicate } = useLocalSearchParams<{ duplicate?: string }>();
  return <RecipeEditor key={duplicate ?? 'new'} duplicateId={duplicate} />;
}
