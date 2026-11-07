import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';

import { Button, ErrorText, Row, Screen, Section, Skeleton, styles } from '@/components/ui';
import { listRecipes, type RecipeSummary } from '@/lib/food/recipes';
import { ESTIMATE_NOTE } from '@/lib/food/search';
import { useTheme } from '@/theme';

// Your recipes and meals, most recently changed first. Open one to see its nutrition and log it.
export default function Recipes() {
  const c = useTheme();
  const router = useRouter();
  const [rows, setRows] = useState<RecipeSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    listRecipes().then(setRows, (e) => setError(e instanceof Error ? e.message : "Couldn't load your recipes."));
  }, []);
  useFocusEffect(load);

  return (
    <Screen title="Recipes and Meals" back>
      <Button label="New Recipe or Meal" onPress={() => router.push('/food/recipes/new')} />
      {error ? (
        <View>
          <ErrorText>{error}</ErrorText>
          <Button plain label="Try Again" onPress={load} />
        </View>
      ) : !rows ? (
        <Skeleton label="Loading recipes" />
      ) : rows.length === 0 ? (
        <Text style={[styles.body, { color: c.inkSoft }]}>No recipes yet. Create one from foods, or save a meal you eat often as a recipe with 1 serving.</Text>
      ) : (
        <Section footer="Only you can see your recipes.">
          {rows.map((r, i) => (
            <Row key={r.id} label={r.name} wrap value={`${r.servings} ${r.servings === 1 ? 'serving' : 'servings'}`} last={i === rows.length - 1} onPress={() => router.push({ pathname: '/food/recipes/[id]', params: { id: r.id } })} />
          ))}
        </Section>
      )}
      <Text style={[styles.caption, { color: c.inkSoft }]}>{ESTIMATE_NOTE}</Text>
    </Screen>
  );
}
