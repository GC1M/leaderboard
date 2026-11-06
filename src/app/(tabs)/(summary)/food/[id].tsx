import * as Crypto from 'expo-crypto';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { Segmented } from '@/components/history/Segmented';
import { DateField, DropdownField, NumberField } from '@/components/inputs';
import { Button, ErrorText, Row, Screen, Section, Skeleton, styles } from '@/components/ui';
import { formatNutrient } from '@/lib/food/format';
import { amountMessage, consumedNutrients, defaultMeal, logFood, MEALS, type Meal, type Quantity } from '@/lib/food/log';
import { ESTIMATE_NOTE, FDC_ATTRIBUTION, type Food, getFood } from '@/lib/food/search';
import { localDateKey } from '@/lib/health/dates';
import { decimalValue } from '@/lib/numeric-input';
import { useTheme } from '@/theme';

type Mode = 'grams' | 'portion';

// Pick an amount (grams, or a portion that has a gram weight), see the nutrition for it, and log it.
export default function FoodDetail() {
  const c = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [food, setFood] = useState<Food | null | undefined>();
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  const [mode, setMode] = useState<Mode>('grams');
  const [grams, setGrams] = useState('100');
  const [portionId, setPortionId] = useState('');
  const [count, setCount] = useState('1');
  const [meal, setMeal] = useState<Meal>(() => defaultMeal(new Date()));
  const [when, setWhen] = useState(() => new Date());
  // One id per screen visit: logging again after a failed save, with the same or changed values, updates one entry.
  const [clientId] = useState(() => Crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logged, setLogged] = useState<'synced' | 'saved' | null>(null);

  useEffect(() => {
    let live = true;
    getFood(id).then(
      (f) => live && (setFood(f), setLoadError(null)),
      (e) => live && setLoadError(e instanceof Error ? e.message : "Couldn't load that food. Try again."),
    );
    return () => {
      live = false;
    };
  }, [id, tries]);

  if (loadError || food === null) {
    return (
      <Screen title="Food" back>
        <ErrorText>{loadError ?? 'That food is no longer available.'}</ErrorText>
        {loadError && <Button plain label="Try Again" onPress={() => { setLoadError(null); setTries((t) => t + 1); }} />}
      </Screen>
    );
  }
  if (!food) {
    return (
      <Screen title="Food" back>
        <Skeleton label="Loading food" rows={3} />
      </Screen>
    );
  }

  const portion = food.portions.find((p) => p.id === portionId) ?? food.portions[0];
  const amount = decimalValue(mode === 'grams' ? grams : count);
  const quantity: Quantity | null =
    amount === null ? null : mode === 'portion' && portion ? { mode: 'portion', portion, count: amount } : { mode: 'grams', amount };
  const nutrients = quantity ? consumedNutrients(food, quantity) : null;
  const custom = food.provider === 'custom';

  const log = async () => {
    if (!quantity) return;
    setBusy(true);
    setError(null);
    try {
      setLogged((await logFood({ food, quantity, meal, consumedAt: when, clientId })) ? 'synced' : 'saved');
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't log that food. Try again.");
    }
    setBusy(false);
  };

  if (logged) {
    return (
      <Screen title="Logged">
        <Text accessibilityLiveRegion="polite" style={[styles.body, { color: c.ink }]}>
          {`${food.name} was added to ${MEALS.find((m) => m.value === meal)?.label.toLowerCase()}. Calories: ${formatNutrient('energy_kcal', nutrients?.energy_kcal ?? null)}.`}
        </Text>
        {logged === 'saved' && <Text style={[styles.body, { color: c.danger }]}>Saved on this device but not synced yet. It stays in your diary marked Not synced, and you can retry there.</Text>}
        <Button label="View Diary" onPress={() => router.replace({ pathname: '/food/diary', params: { date: localDateKey(when) } })} />
        <Button plain label="Log Another Food" onPress={() => router.replace('/food')} />
        <Button plain label="Done" onPress={() => router.replace('/')} />
        <Text style={[styles.caption, { color: c.inkSoft }]}>{ESTIMATE_NOTE}</Text>
      </Screen>
    );
  }

  return (
    <Screen title={food.name} back>
      <Text style={[styles.caption, { color: c.inkSoft }]}>
        {[food.brand, custom ? 'Custom food' : food.sourceDataType, `${formatNutrient('energy_kcal', food.per100g.energy_kcal)} per 100 g`].filter(Boolean).join(' · ')}
      </Text>
      {food.portions.length > 0 && (
        <Segmented
          label="Amount type"
          options={[{ value: 'grams', label: 'Grams' }, { value: 'portion', label: 'Portion' }]}
          value={mode}
          onChange={setMode}
        />
      )}
      {mode === 'grams' || !portion ? (
        <NumberField label="Amount (g)" value={grams} onChangeText={setGrams} />
      ) : (
        <View style={{ gap: 16 }}>
          <DropdownField
            label="Portion"
            options={food.portions.map((p) => ({ value: p.id, label: `${p.label} (${Math.round(p.gramWeight * 10) / 10} g)` }))}
            value={portion.id}
            onChange={setPortionId}
          />
          <NumberField label="Number of portions" value={count} onChangeText={setCount} />
        </View>
      )}
      <Segmented label="Meal" options={MEALS} value={meal} onChange={setMeal} />
      <DateField label="When" value={when} onChange={setWhen} />
      <Section title="For this amount" footer={nutrients ? undefined : amountMessage(mode === 'portion' && portion ? 'portion' : 'grams')}>
        <Row label="Calories" value={nutrients ? formatNutrient('energy_kcal', nutrients.energy_kcal) : '-'} />
        <Row label="Protein" value={nutrients ? formatNutrient('protein_g', nutrients.protein_g) : '-'} />
        <Row label="Carbs" value={nutrients ? formatNutrient('carbs_g', nutrients.carbs_g) : '-'} />
        <Row label="Fat" value={nutrients ? formatNutrient('fat_g', nutrients.fat_g) : '-'} last />
      </Section>
      {nutrients && [nutrients.energy_kcal, nutrients.protein_g, nutrients.carbs_g, nutrients.fat_g].some((v) => v === null) && (
        <Text style={[styles.caption, { color: c.inkSoft }]}>Some values are unknown for this food.</Text>
      )}
      <ErrorText>{error}</ErrorText>
      <Button label="Log Food" busy={busy} disabled={!nutrients} onPress={log} />
      <Text style={[styles.caption, { color: c.inkSoft }]}>{ESTIMATE_NOTE}</Text>
      {!custom && <Text style={[styles.caption, { color: c.inkSoft }]}>{FDC_ATTRIBUTION}</Text>}
    </Screen>
  );
}
