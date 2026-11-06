import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';

import { Button, ErrorText, Field, Row, Screen, Section, Skeleton, styles } from '@/components/ui';
import { formatNutrient } from '@/lib/food/format';
import { ESTIMATE_NOTE, FDC_ATTRIBUTION, type Food, FoodSearchError, searchCachedFoods, searchFoods } from '@/lib/food/search';
import { useTheme } from '@/theme';

type Result = { q: string; mine: Food[]; foods: Food[]; error: string | null; saved?: boolean };

const describe = (f: Food) => [f.brand, f.provider === 'custom' ? 'Custom food' : null, `${formatNutrient('energy_kcal', f.per100g.energy_kcal)} per 100 g`].filter(Boolean).join(' · ');

// Search USDA foods through our server and your own custom foods. If the server or USDA fails, saved foods
// still show and a custom food can always be added.
export default function FoodSearch() {
  const c = useTheme();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [tries, setTries] = useState(0);
  const now = useRef(false);
  const q = query.trim().replace(/\s+/g, ' ');

  useEffect(() => {
    // Typing waits for a pause; pressing search on the keyboard goes straight away.
    const delay = now.current ? 0 : 700;
    now.current = false;
    if (q.length < 3) return;
    let live = true;
    const timer = setTimeout(async () => {
      const [remote, mine] = await Promise.allSettled([searchFoods(q), searchCachedFoods(q, true)]);
      if (!live) return;
      if (remote.status === 'fulfilled') {
        const { foods, fromCache, failure } = remote.value;
        setResult({
          q,
          foods,
          mine: mine.status === 'fulfilled' ? mine.value : [],
          error: fromCache ? `${new FoodSearchError(failure ?? 'unknown').message} Showing saved results.` : null,
          saved: fromCache,
        });
        return;
      }
      const message = remote.reason instanceof FoodSearchError ? remote.reason.message : "Couldn't search foods. Try again.";
      const saved = await searchCachedFoods(q).catch(() => []);
      if (live) setResult({ q, foods: saved, mine: [], error: message });
    }, delay);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [q, tries]);

  // Submitting searches now, unless this query's results are already shown.
  const submit = () => {
    if (q.length < 3 || (result?.q === q && !result.error)) return;
    now.current = true;
    setTries((t) => t + 1);
  };
  const open = (f: Food) => router.push({ pathname: '/food/[id]', params: { id: f.id } });
  const shown = q.length >= 3 && result?.q === q ? result : null;
  const loading = q.length >= 3 && !shown;
  const none = !!shown && !shown.error && shown.foods.length + shown.mine.length === 0;
  const list = (foods: Food[], title?: string) =>
    foods.length > 0 && (
      <Section title={title}>
        {foods.map((f, i) => (
          <Row key={f.id} label={f.name} value={describe(f)} wrap onPress={() => open(f)} last={i === foods.length - 1} />
        ))}
      </Section>
    );

  return (
    <Screen title="Food" back>
      <Field label="Search foods" value={query} onChangeText={setQuery} autoFocus autoCorrect={false} returnKeyType="search" onSubmitEditing={submit} helper="Search starts after 3 letters. Try a food name, such as banana or cheddar." />
      {loading && <Skeleton label="Searching foods" rows={4} />}
      {shown?.error && (
        <View style={{ gap: 4 }}>
          <ErrorText>{shown.error}</ErrorText>
          <Button plain label="Try Again" onPress={() => setTries((t) => t + 1)} />
          {shown.foods.length > 0 && !shown.saved && <Text style={[styles.caption, { color: c.inkSoft }]}>Showing foods saved on this account.</Text>}
        </View>
      )}
      {shown && list(shown.mine, 'Your foods')}
      {shown && list(shown.foods, shown.error ? 'Saved foods' : 'USDA foods')}
      {none && <Text style={[styles.body, { color: c.inkSoft }]}>{`No matches for "${q}". Try another word, or add it as a custom food.`}</Text>}
      <Button
        label="Add a Custom Food"
        secondary
        onPress={() => router.push({ pathname: '/food/custom', params: q ? { name: q } : {} })}
      />
      <Button label="Recipes and Meals" secondary onPress={() => router.push('/food/recipes')} />
      <Text style={[styles.caption, { color: c.inkSoft }]}>{ESTIMATE_NOTE}</Text>
      <Text style={[styles.caption, { color: c.inkSoft }]}>{FDC_ATTRIBUTION}</Text>
    </Screen>
  );
}
