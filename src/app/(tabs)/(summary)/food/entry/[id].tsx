import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Switch, Text, View } from 'react-native';

import { Segmented } from '@/components/history/Segmented';
import { DateField, DropdownField, NumberField } from '@/components/inputs';
import { Button, ErrorText, Row, Screen, Section, Skeleton, styles } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { alert } from '@/lib/alert';
import { discardPending, type Entry, getEntry, removeEntry, saveEdit } from '@/lib/food/diary';
import { entryTags, formatNutrient } from '@/lib/food/format';
import { MEALS, type Meal, type Quantity } from '@/lib/food/log';
import { NUTRIENT_KEYS } from '@/lib/food/nutrition';
import { ESTIMATE_NOTE, FDC_ATTRIBUTION, type Food, getFood } from '@/lib/food/search';
import { decimalValue } from '@/lib/numeric-input';
import { useTheme } from '@/theme';

const NAMES = { energy_kcal: 'Calories', protein_g: 'Protein', carbs_g: 'Carbs', fat_g: 'Fat', fiber_g: 'Fiber', sugars_g: 'Sugars', sat_fat_g: 'Saturated fat', sodium_mg: 'Sodium' } as const;

const when = (e: Entry) => {
  const at = new Date(e.consumedAt);
  try {
    return `${at.toLocaleString(undefined, { timeZone: e.timezone, dateStyle: 'medium', timeStyle: 'short' })} (${e.timezone})`;
  } catch {
    return `${at.toLocaleString()} (${e.timezone})`;
  }
};

const amountSig = (mode: string, grams: string, portionId: string | undefined, count: string) => JSON.stringify(mode === 'grams' ? [mode, grams] : [mode, portionId ?? '', count]);

// An entry's snapshot and where it came from, with its amount, meal, time and estimate flag editable in place.
export default function EntryDetail() {
  const c = useTheme();
  const router = useRouter();
  const { session } = useAuth();
  const uid = session?.user.id ?? '';
  const { id } = useLocalSearchParams<{ id: string }>();
  const [entry, setEntry] = useState<Entry | null | undefined>();
  const [food, setFood] = useState<Food | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  const [mode, setMode] = useState<'grams' | 'portion'>('grams');
  const [grams, setGrams] = useState('');
  const [portionId, setPortionId] = useState('');
  const [count, setCount] = useState('1');
  const [meal, setMeal] = useState<Meal>('snack');
  const [at, setAt] = useState(() => new Date());
  const [estimate, setEstimate] = useState(false);
  const [start, setStart] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const e = await getEntry(uid, id);
        const f = e?.foodId ? await getFood(e.foodId).catch(() => null) : null;
        if (!live) return;
        setEntry(e);
        setFood(f);
        if (e) {
          const p = f?.portions.find((x) => x.label === e.portionLabel);
          const m = p && e.portionCount ? 'portion' : 'grams';
          const g = String(Math.round(e.grams * 10) / 10);
          const n = String(e.portionCount ?? 1);
          setMode(m);
          setGrams(g);
          setPortionId(p?.id ?? '');
          setCount(n);
          setStart(amountSig(m, g, p?.id, n));
          setMeal(e.meal);
          setAt(new Date(e.consumedAt));
          setEstimate(e.isEstimated);
        }
        setLoadError(null);
      } catch (e) {
        if (live) setLoadError(e instanceof Error ? e.message : "Couldn't load that entry. Try again.");
      }
    })();
    return () => { live = false; };
  }, [uid, id, tries]);

  if (loadError || entry === null) {
    return (
      <Screen title="Entry" back>
        <ErrorText>{loadError ?? 'That entry is no longer available.'}</ErrorText>
        {loadError && <Button plain label="Try Again" onPress={() => { setLoadError(null); setTries((t) => t + 1); }} />}
      </Screen>
    );
  }
  if (!entry) {
    return (
      <Screen title="Entry" back>
        <Skeleton label="Loading entry" rows={3} />
      </Screen>
    );
  }

  const portion = food?.portions.find((p) => p.id === portionId) ?? food?.portions[0];
  const amount = decimalValue(mode === 'grams' ? grams : count);
  const quantity: Quantity | null = amount === null ? null : mode === 'portion' && portion ? { mode: 'portion', portion, count: amount } : { mode: 'grams', amount };
  // Only a changed amount recomputes the snapshot; unchanged grams text must not re-round it.
  const amountChanged = amountSig(mode, grams, portion?.id, count) !== start;
  const tags = entryTags(entry);

  const save = async () => {
    if (!quantity || busy) return;
    setBusy(true);
    setError(null);
    try {
      await saveEdit(uid, entry, { quantity: amountChanged ? quantity : undefined, meal, consumedAt: at, isEstimated: estimate });
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that entry. Try again.");
      setBusy(false);
    }
  };
  const remove = () =>
    alert('Delete this entry?', `${entry.name} is removed from your diary for good.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          if (busy) return;
          setBusy(true);
          try {
            await removeEntry(uid, entry);
            router.back();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Couldn't delete that entry. Try again.");
            setBusy(false);
          }
        },
      },
    ]);

  return (
    <Screen title={entry.name} back>
      <Text style={[styles.caption, { color: c.inkSoft }]}>{[entry.brand, ...tags].filter(Boolean).join(' · ')}</Text>
      {entry.pending && (
        <View style={{ gap: 4 }}>
          <Text accessibilityLiveRegion="polite" style={[styles.body, { color: c.danger }]}>{`Not synced. ${entry.syncError ?? 'Open the diary to retry.'}`}</Text>
          {entry.pending === 'edit' && (
            <Button plain danger label="Discard Unsynced Edit" onPress={async () => { await discardPending(uid, entry); setTries((t) => t + 1); }} />
          )}
        </View>
      )}
      <Section title="Nutrition for this amount" footer="These are the values saved when you logged this food, scaled if you changed the amount.">
        {NUTRIENT_KEYS.map((k, i) => <Row key={k} label={NAMES[k]} value={formatNutrient(k, entry.nutrients[k])} last={i === NUTRIENT_KEYS.length - 1} />)}
      </Section>
      <Section title="Source">
        <Row label="Provider" value={entry.provider === 'custom' ? 'Custom food (your estimate)' : 'USDA FoodData Central'} wrap />
        {entry.sourceDataType && <Row label="Data type" value={entry.sourceDataType} wrap />}
        {entry.sourceVersion && <Row label="Source version" value={entry.sourceVersion} wrap />}
        <Row label="Logged" value={when(entry)} wrap last />
      </Section>

      {food && food.portions.length > 0 && (
        <Segmented label="Amount type" options={[{ value: 'grams', label: 'Grams' }, { value: 'portion', label: 'Portion' }]} value={mode} onChange={setMode} />
      )}
      {mode === 'grams' || !portion || !food ? (
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
      {!food && entry.foodId === null && <Text style={[styles.caption, { color: c.inkSoft }]}>This food was deleted, so the amount is scaled from the saved values.</Text>}
      <Segmented label="Meal" options={MEALS} value={meal} onChange={setMeal} />
      <DateField label="When" value={at} onChange={setAt} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Text style={[styles.body, { color: c.ink, flex: 1 }]}>Mark as an estimate</Text>
        <Switch accessibilityLabel="Mark as an estimate" value={estimate} onValueChange={setEstimate} />
      </View>
      <ErrorText>{error}</ErrorText>
      <Button label="Save Changes" busy={busy} disabled={!quantity} onPress={save} />
      <Button plain danger label="Delete Entry" disabled={busy} onPress={remove} />
      <Text style={[styles.caption, { color: c.inkSoft }]}>{ESTIMATE_NOTE}</Text>
      {entry.provider === 'usda_fdc' && <Text style={[styles.caption, { color: c.inkSoft }]}>{FDC_ATTRIBUTION}</Text>}
    </Screen>
  );
}
