import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { NumberField } from '@/components/inputs';
import { Button, ErrorText, Field, Row, Screen, Section, Skeleton, styles } from '@/components/ui';
import { formatNutrient } from '@/lib/food/format';
import { type Ingredient, type Recipe, validateRecipe } from '@/lib/food/recipe';
import { getRecipe, saveRecipe } from '@/lib/food/recipes';
import { type Food, FoodSearchError, searchCachedFoods, searchFoods } from '@/lib/food/search';
import { decimalValue } from '@/lib/numeric-input';
import { useTheme } from '@/theme';

type Line = Ingredient & { amount: string };
type Form = { name: string; notes: string; servings: string; yieldG: string; lines: Line[] };

const blank: Form = { name: '', notes: '', servings: '1', yieldG: '', lines: [] };
const toForm = (r: Recipe, copy: boolean): Form => ({
  name: copy ? `${r.name.slice(0, 195)} copy` : r.name,
  notes: r.notes ?? '',
  servings: String(r.servings),
  yieldG: r.yieldG == null ? '' : String(r.yieldG),
  lines: r.ingredients.map((i) => ({ ...i, amount: String(i.grams) })),
});

// Null amounts become NaN, which validateRecipe rejects.
function toRecipe(f: Form): Recipe {
  return {
    id: null,
    name: f.name,
    notes: f.notes,
    servings: decimalValue(f.servings) ?? Number.NaN,
    yieldG: f.yieldG.trim() ? (decimalValue(f.yieldG) ?? Number.NaN) : null,
    ingredients: f.lines.map((l) => ({ foodId: l.foodId, name: l.name, grams: decimalValue(l.amount) ?? Number.NaN, per100g: l.per100g })),
  };
}

// Search USDA foods and your own foods; if the server fails, saved foods still show.
function IngredientPicker({ onPick, onCancel }: { onPick: (f: Food) => void; onCancel: () => void }) {
  const c = useTheme();
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
  return (
    <Screen title="Add Ingredient" back onBack={onCancel}>
      <Field label="Search foods" value={q} onChangeText={setQ} autoFocus autoCorrect={false} returnKeyType="search" onSubmitEditing={() => void search()} helper="Enter at least 3 letters, then search. Pick the form you cooked, such as raw or cooked." />
      <Button label="Search" busy={busy} disabled={q.trim().length < 3} onPress={() => void search()} />
      <ErrorText>{error}</ErrorText>
      {foods && foods.length === 0 && <Text style={[styles.body, { color: c.inkSoft }]}>No matches. Add it as a custom food from Food, then pick it here.</Text>}
      {foods && foods.length > 0 && (
        <Section>
          {foods.map((f, i) => (
            <Row key={f.id} label={f.name} wrap value={[f.brand, f.provider === 'custom' ? 'Custom food' : null, `${formatNutrient('energy_kcal', f.per100g.energy_kcal)} per 100 g`].filter(Boolean).join(' · ')} onPress={() => onPick(f)} last={i === foods.length - 1} />
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
  const [form, setForm] = useState<Form | null>(id || duplicateId ? null : blank);
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
      (r) => live && (r ? setForm(toForm(r, !!duplicateId)) : setLoadError("That recipe doesn't exist anymore.")),
      (e) => live && setLoadError(e instanceof Error ? e.message : "Couldn't load that recipe."),
    );
    return () => { live = false; };
  }, [id, duplicateId, tries]);

  const title = id ? 'Edit Recipe' : duplicateId ? 'Duplicate Recipe' : 'New Recipe';
  if (loadError) return <Screen title="Recipe" back><ErrorText>{loadError}</ErrorText><Button plain label="Try Again" onPress={() => { setLoadError(null); setTries((t) => t + 1); }} /></Screen>;
  if (!form) return <Screen title="Recipe" back><Skeleton label="Loading recipe" /></Screen>;
  const edit = (patch: Partial<Form>) => { setError(null); setForm({ ...form, ...patch }); };
  const editLine = (i: number, patch: Partial<Line>) => edit({ lines: form.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });

  if (picking) {
    return <IngredientPicker onCancel={() => setPicking(false)} onPick={(f) => { edit({ lines: [...form.lines, { foodId: f.id, name: f.name, grams: 100, per100g: f.per100g, amount: '100' }] }); setPicking(false); }} />;
  }

  const save = async () => {
    const r = toRecipe(form);
    const problem = validateRecipe(r);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    try {
      const saved = await saveRecipe(id ?? null, r);
      router.dismissTo('/food/recipes');
      router.push({ pathname: '/food/recipes/[id]', params: { id: saved } });
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
          <NumberField label={`${l.name} (g)`} value={l.amount} onChangeText={(v) => editLine(i, { amount: v })} />
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
