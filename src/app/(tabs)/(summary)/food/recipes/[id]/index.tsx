import * as Crypto from 'expo-crypto';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Switch, Text, View } from 'react-native';

import { Segmented } from '@/components/history/Segmented';
import { DateField, NumberField, Overflow } from '@/components/inputs';
import { Button, ErrorText, Row, Screen, Section, Skeleton, styles } from '@/components/ui';
import { alert } from '@/lib/alert';
import { formatNutrient, NUTRIENT_NAMES } from '@/lib/food/format';
import { defaultMeal, MEALS, type Meal } from '@/lib/food/log';
import { per100g, perServing, type Recipe, recipeAmountMessage, recipeCaveats, type RecipeQuantity, recipeSnapshot, recipeTotals } from '@/lib/food/recipe';
import { deleteRecipe, getRecipe, logRecipe } from '@/lib/food/recipes';
import { ESTIMATE_NOTE } from '@/lib/food/search';
import { SUMMARY_KEYS } from '@/lib/food/diary';
import { localDateKey } from '@/lib/health/dates';
import { decimalValue } from '@/lib/numeric-input';
import type { NutrientKey, Nutrients } from '@/lib/food/nutrition';
import { useTheme } from '@/theme';

type Mode = RecipeQuantity['mode'];

// A recipe's nutrition, how it was worked out, and logging a portion of it as one entry.
export default function RecipeDetail() {
  const c = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [recipe, setRecipe] = useState<Recipe | null | undefined>();
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('servings');
  const [servings, setServings] = useState('1');
  const [grams, setGrams] = useState('');
  const [meal, setMeal] = useState<Meal>(() => defaultMeal(new Date()));
  const [estimate, setEstimate] = useState(true);
  const [when, setWhen] = useState(() => new Date());
  // One id per screen visit: logging again after a failed save updates one entry, never two.
  const [clientId] = useState(() => Crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logged, setLogged] = useState<'synced' | 'saved' | null>(null);

  const load = useCallback(() => {
    let live = true;
    setLoadError(null);
    getRecipe(id).then(
      (r) => live && setRecipe(r),
      (e) => live && setLoadError(e instanceof Error ? e.message : "Couldn't load that recipe."),
    );
    return () => { live = false; };
  }, [id]);
  useFocusEffect(load);

  if (loadError || recipe === null) {
    return (
      <Screen title="Recipe" back>
        <ErrorText>{loadError ?? 'That recipe no longer exists.'}</ErrorText>
        {loadError && <Button plain label="Try Again" onPress={load} />}
      </Screen>
    );
  }
  if (!recipe) {
    return (
      <Screen title="Recipe" back>
        <Skeleton label="Loading recipe" />
      </Screen>
    );
  }

  const { totals, incomplete } = recipeTotals(recipe);
  const show = (n: Nutrients, k: NutrientKey, lower = false) => `${lower && incomplete.includes(k) && n[k] !== null ? 'At least ' : ''}${formatNutrient(k, n[k])}`;
  const rows = (n: Nutrients, lower: boolean) => SUMMARY_KEYS.map((k, i) => <Row key={k} label={NUTRIENT_NAMES[k]} value={show(n, k, lower)} wrap last={i === SUMMARY_KEYS.length - 1} />);

  const effective: Mode = mode === 'grams' && recipe.yieldG ? 'grams' : 'servings';
  const amount = decimalValue(effective === 'grams' ? grams : servings);
  const quantity: RecipeQuantity | null = amount === null ? null : effective === 'grams' ? { mode: 'grams', amount } : { mode: 'servings', count: amount };
  const snap = quantity ? recipeSnapshot(recipe, quantity) : null;

  const log = async () => {
    if (!quantity) return;
    setBusy(true);
    setError(null);
    try {
      setLogged((await logRecipe({ recipe, quantity, meal, consumedAt: when, clientId, isEstimated: estimate })) ? 'synced' : 'saved');
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't log that recipe. Try again.");
    }
    setBusy(false);
  };

  const remove = () =>
    alert(`Delete ${recipe.name}?`, 'This cannot be undone. Entries already in your diary are kept.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          if (busy) return;
          setBusy(true);
          try {
            await deleteRecipe(id);
            router.dismissTo('/food/recipes');
          } catch (e) {
            setError(e instanceof Error ? e.message : "Couldn't delete that recipe.");
            setBusy(false);
          }
        },
      },
    ]);

  if (logged) {
    return (
      <Screen title="Logged">
        <Text accessibilityLiveRegion="polite" style={[styles.body, { color: c.ink }]}>
          {`${recipe.name} was added to ${MEALS.find((m) => m.value === meal)?.label.toLowerCase()}. Calories: ${snap && snap.incomplete.includes('energy_kcal') ? 'unknown' : formatNutrient('energy_kcal', snap?.nutrients.energy_kcal ?? null)}.`}
        </Text>
        {logged === 'saved' && <Text style={[styles.body, { color: c.danger }]}>Saved on this device but not synced yet. It stays in your diary marked Not synced, and you can retry there.</Text>}
        <Button label="View Diary" onPress={() => router.replace({ pathname: '/food/diary', params: { date: localDateKey(when) } })} />
        <Button plain label="Done" onPress={() => router.replace('/')} />
        <Text style={[styles.caption, { color: c.inkSoft }]}>{ESTIMATE_NOTE}</Text>
      </Screen>
    );
  }

  return (
    <Screen title={recipe.name} back headerActions={<Button plain label="Edit" onPress={() => router.push({ pathname: '/food/recipes/[id]/edit', params: { id } })} />}>
      <Text style={[styles.caption, { color: c.inkSoft }]}>{`${recipe.servings} ${recipe.servings === 1 ? 'serving' : 'servings'} · ${recipe.yieldG ? `cooked weight ${Math.round(recipe.yieldG * 10) / 10} g` : 'no cooked weight'}`}</Text>
      <Section title="Ingredients">
        {recipe.ingredients.map((i, k) => <Row key={`${i.foodId ?? 'x'}-${k}`} label={i.name} value={`${Math.round(i.grams * 10) / 10} g`} wrap last={k === recipe.ingredients.length - 1} />)}
      </Section>
      <Section title="Whole recipe">{rows(totals, true)}</Section>
      <Section title="Per serving">{rows(perServing(recipe, totals), true)}</Section>
      <Section title={recipe.yieldG ? 'Per 100 g of cooked weight' : 'Per 100 g of ingredients'}>{rows(per100g(recipe, totals), true)}</Section>
      {recipeCaveats(recipe, incomplete).map((line) => <Text key={line} style={[styles.caption, { color: c.inkSoft }]}>{line}</Text>)}

      <Text style={[styles.bodyStrong, { color: c.ink }]}>Log this recipe</Text>
      {recipe.yieldG ? (
        <Segmented label="Amount type" options={[{ value: 'servings', label: 'Servings' }, { value: 'grams', label: 'Grams' }]} value={effective} onChange={setMode} />
      ) : null}
      {effective === 'grams' ? <NumberField label="Amount (g of cooked weight)" value={grams} onChangeText={setGrams} /> : <NumberField label="Number of servings" value={servings} onChangeText={setServings} />}
      <Segmented label="Meal" options={MEALS} value={meal} onChange={setMeal} />
      <DateField label="When" value={when} onChange={setWhen} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Text style={[styles.body, { color: c.ink, flex: 1 }]}>Mark as an estimate</Text>
        <Switch accessibilityLabel="Mark as an estimate" value={estimate} onValueChange={setEstimate} />
      </View>
      <Section title="For this amount" footer={snap ? undefined : recipeAmountMessage(effective)}>
        {SUMMARY_KEYS.map((k, i) => (
          <Row key={k} label={NUTRIENT_NAMES[k]} value={snap ? (snap.nutrients[k] === null ? 'Unknown' : formatNutrient(k, snap.nutrients[k])) : '-'} last={i === SUMMARY_KEYS.length - 1} />
        ))}
      </Section>
      {snap && snap.incomplete.length > 0 && <Text style={[styles.caption, { color: c.inkSoft }]}>Values missing from some ingredients are saved as unknown, not as a partial total.</Text>}
      <ErrorText>{error}</ErrorText>
      <Button label="Log Recipe" busy={busy} disabled={!snap} onPress={log} />
      <Button secondary label="Duplicate Recipe" disabled={busy} onPress={() => router.push({ pathname: '/food/recipes/new', params: { duplicate: id } })} />
      <Overflow name={recipe.name}><Row label="Delete Recipe" danger last disabled={busy} onPress={remove} /></Overflow>
      <Text style={[styles.caption, { color: c.inkSoft }]}>{ESTIMATE_NOTE}</Text>
    </Screen>
  );
}
