import { usePreventRemove, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { Segmented } from '@/components/history/Segmented';
import { DropdownField, NumberField } from '@/components/inputs';
import { Button, ErrorText, Field, Row, Screen, Section, Skeleton, styles } from '@/components/ui';
import { alert } from '@/lib/alert';
import { formatNutrient } from '@/lib/food/format';
import { type Quantity } from '@/lib/food/log';
import { ingredientFromFood, validateRecipe } from '@/lib/food/recipe';
import { blankForm, type Form, formChanged, type Line, toForm, toRecipe } from '@/lib/food/recipe-form';
import { getRecipe, saveRecipe } from '@/lib/food/recipes';
import { type Food, FoodSearchError, searchCachedFoods, searchFoods } from '@/lib/food/search';
import { decimalValue } from '@/lib/numeric-input';
import { useTheme } from '@/theme';

// Search USDA foods and your own foods; if the server fails, saved foods still show.
function IngredientPicker({ onPick, onCancel }: { onPick: (l: Line) => void; onCancel: () => void }) {
  const c = useTheme();
  const [chosen, setChosen] = useState<Food | null>(null);
  const [mode, setMode] = useState<'grams' | 'portion'>('grams');
  const [grams, setGrams] = useState('100');
  const [portionId, setPortionId] = useState('');
  const [count, setCount] = useState('1');
  const [q, setQ] = useState('');
  const [foods, setFoods] = useState<Food[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const search = async () => {
    const query = q.trim().replace(/\s+/g, ' ');
    if (query.length < 3 || busy) return;
    setBusy(true);
    setError(null);
    const [remote, mine] = await Promise.allSettled([searchFoods(query), searchCachedFoods(query, true)]);
    const own = mine.status === 'fulfilled' ? mine.value : [];
    if (remote.status === 'fulfilled') {
      const seen = new Set(own.map((f) => f.id));
      setFoods([...own, ...remote.value.foods.filter((f) => !seen.has(f.id))]);
      if (remote.value.fromCache) setError(`${new FoodSearchError(remote.value.failure ?? 'unknown').message} Showing saved results.`);
    } else {
      setError(remote.reason instanceof FoodSearchError ? remote.reason.message : "Couldn't search foods. Try again.");
      setFoods(await searchCachedFoods(query).catch(() => own));
    }
    setBusy(false);
  };
  if (chosen) {
    const portion = chosen.portions.find((p) => p.id === portionId) ?? chosen.portions[0];
    const amount = decimalValue(mode === 'grams' ? grams : count);
    const quantity: Quantity | null = amount === null ? null : mode === 'portion' && portion ? { mode: 'portion', portion, count: amount } : { mode: 'grams', amount };
    const ingredient = quantity ? ingredientFromFood(chosen, quantity) : null;
    return (
      <Screen title={chosen.name} back onBack={() => setChosen(null)}>
        {chosen.portions.length > 0 && (
          <Segmented label="Amount type" options={[{ value: 'grams', label: 'Grams' }, { value: 'portion', label: 'Portion' }]} value={mode} onChange={setMode} />
        )}
        {mode === 'grams' || !portion ? (
          <NumberField label="Amount (g)" value={grams} onChangeText={setGrams} />
        ) : (
          <View style={{ gap: 16 }}>
            <DropdownField label="Portion" options={chosen.portions.map((p) => ({ value: p.id, label: `${p.label} (${Math.round(p.gramWeight * 10) / 10} g)` }))} value={portion.id} onChange={setPortionId} />
            <NumberField label="Number of portions" value={count} onChangeText={setCount} />
          </View>
        )}
        <Text accessibilityLiveRegion="polite" style={[styles.body, { color: c.inkSoft }]}>
          {ingredient ? `${ingredient.note ? `${ingredient.note} = ` : ''}${Math.round(ingredient.grams * 10) / 10} g` : 'Enter an amount above 0 and up to 100,000 g.'}
        </Text>
        <Button label="Add Ingredient" disabled={!ingredient} onPress={() => ingredient && onPick({ ...ingredient, amount: String(Math.round(ingredient.grams * 100) / 100) })} />
      </Screen>
    );
  }
  return (
    <Screen title="Add Ingredient" back onBack={onCancel}>
      <Field label="Search foods" value={q} onChangeText={setQ} autoFocus autoCorrect={false} returnKeyType="search" onSubmitEditing={() => void search()} helper="Enter at least 3 letters, then search. Pick the form you cooked, such as raw or cooked." />
      <Button label="Search" busy={busy} disabled={q.trim().length < 3} onPress={() => void search()} />
      <ErrorText>{error}</ErrorText>
      {foods && foods.length === 0 && <Text style={[styles.body, { color: c.inkSoft }]}>No matches. Add it as a custom food from Food, then pick it here.</Text>}
      {foods && foods.length > 0 && (
        <Section>
          {foods.map((f, i) => (
            <Row key={f.id} label={f.name} wrap value={[f.brand, f.provider === 'custom' ? 'Custom food' : null, `${formatNutrient('energy_kcal', f.per100g.energy_kcal)} per 100 g`].filter(Boolean).join(' · ')} onPress={() => { setChosen(f); setMode('grams'); setGrams('100'); setPortionId(''); setCount('1'); }} last={i === foods.length - 1} />
          ))}
        </Section>
      )}
    </Screen>
  );
}

// New, edit (id) or duplicate (duplicateId) a recipe or meal. Nothing is saved until Save Recipe. A meal is a
// recipe with 1 serving and no cooked weight.
export function RecipeEditor({ id, duplicateId }: { id?: string; duplicateId?: string }) {
  const c = useTheme();
  const router = useRouter();
  const [form, setForm] = useState<Form | null>(id || duplicateId ? null : blankForm);
  // What the form held when loaded. A duplicate is new until saved, so it always counts as changed.
  const [initial, setInitial] = useState<Form>(blankForm);
  // Set once the user has chosen to leave (discard, or saved): the guard is off and the navigation runs from the effect below.
  const [exit, setExit] = useState<{ repeat?: () => void; savedId?: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const src = id ?? duplicateId;
    if (!src) return;
    let live = true;
    getRecipe(src).then(
      (r) => live && (r ? (setForm(toForm(r, !!duplicateId)), setInitial(duplicateId ? blankForm : toForm(r, false))) : setLoadError("That recipe doesn't exist anymore.")),
      (e) => live && setLoadError(e instanceof Error ? e.message : "Couldn't load that recipe."),
    );
    return () => { live = false; };
  }, [id, duplicateId, tries]);

  usePreventRemove(!!form && !exit && formChanged(form, initial), ({ repeat }) => {
    alert('Unsaved changes', 'Keep editing, or discard these changes.', [
      { text: 'Keep Editing', style: 'cancel' },
      { text: 'Discard Changes', style: 'destructive', onPress: () => setExit({ repeat }) },
    ]);
  });
  useEffect(() => {
    if (exit?.repeat) exit.repeat();
    else if (exit?.savedId) {
      router.dismissTo('/food/recipes');
      router.push({ pathname: '/food/recipes/[id]', params: { id: exit.savedId } });
    }
  }, [exit, router]);
  const title = id ? 'Edit Recipe' : duplicateId ? 'Duplicate Recipe' : 'New Recipe';
  if (loadError) return <Screen title="Recipe" back><ErrorText>{loadError}</ErrorText><Button plain label="Try Again" onPress={() => { setLoadError(null); setTries((t) => t + 1); }} /></Screen>;
  if (!form) return <Screen title="Recipe" back><Skeleton label="Loading recipe" /></Screen>;
  const edit = (patch: Partial<Form>) => { setError(null); setForm({ ...form, ...patch }); };
  const editLine = (i: number, patch: Partial<Line>) => edit({ lines: form.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });

  if (picking) {
    return <IngredientPicker onCancel={() => setPicking(false)} onPick={(l) => { edit({ lines: [...form.lines, l] }); setPicking(false); }} />;
  }

  const save = async () => {
    const r = toRecipe(form);
    const problem = validateRecipe(r);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    try {
      const saved = await saveRecipe(id ?? null, r);
      setExit({ savedId: saved });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save your recipe.");
      setBusy(false);
    }
  };

  return (
    <Screen title={title} back backLabel="Cancel">
      <Field label="Recipe name" value={form.name} onChangeText={(v) => edit({ name: v })} placeholder="Chicken salad" />
      <NumberField label="Servings made" value={form.servings} onChangeText={(v) => edit({ servings: v })} helper="Use 1 for a single reusable meal." />
      <NumberField label="Cooked weight (g), optional" value={form.yieldG} onChangeText={(v) => edit({ yieldG: v })} helper="Weigh the finished dish. It lets you log by grams and gives per 100 g values." />
      <Field label="Notes and assumptions, optional" value={form.notes} onChangeText={(v) => edit({ notes: v })} multiline placeholder="Rice is cooked, chicken is raw weight" />
      <Text style={[styles.bodyStrong, { color: c.ink }]}>Ingredients</Text>
      {form.lines.length === 0 && <Text style={[styles.body, { color: c.inkSoft }]}>No ingredients yet.</Text>}
      {form.lines.map((l, i) => (
        <View key={`${l.foodId ?? 'x'}-${i}`} style={{ gap: 4 }}>
          <NumberField label={`${l.name} (g)`} value={l.amount} onChangeText={(v) => editLine(i, { amount: v, note: undefined })} helper={l.note ? `Added as ${l.note}. Edit the grams to change it.` : undefined} />
          <Button plain danger label={`Remove ${l.name}`} onPress={() => edit({ lines: form.lines.filter((_, j) => j !== i) })} />
        </View>
      ))}
      <Button secondary label="Add Ingredient" onPress={() => setPicking(true)} />
      <Text style={[styles.caption, { color: c.inkSoft }]}>Each ingredient keeps the nutrition values it had when you added it. Only you can see your recipes. Values are estimates, not medical advice.</Text>
      <ErrorText>{error}</ErrorText>
      <Button label="Save Recipe" busy={busy} onPress={() => void save()} />
    </Screen>
  );
}
