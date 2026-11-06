import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';

import { NumberField } from '@/components/inputs';
import { Button, ErrorText, Field, Screen, styles } from '@/components/ui';
import { ESTIMATE_NOTE, createCustomFood } from '@/lib/food/search';
import { decimalValue } from '@/lib/numeric-input';
import { emptyNutrients } from '@/lib/food/nutrition';
import { useTheme } from '@/theme';

const FIELDS = [
  { key: 'energy_kcal', label: 'Calories (kcal) per 100 g' },
  { key: 'protein_g', label: 'Protein (g) per 100 g' },
  { key: 'carbs_g', label: 'Carbs (g) per 100 g' },
  { key: 'fat_g', label: 'Fat (g) per 100 g' },
] as const;

// Your own food. A blank nutrient is saved as unknown, not as 0.
export default function CustomFood() {
  const c = useTheme();
  const router = useRouter();
  const { name: initial } = useLocalSearchParams<{ name?: string }>();
  const [name, setName] = useState(initial ?? '');
  const [brand, setBrand] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const per100g = emptyNutrients();
    for (const f of FIELDS) {
      const raw = values[f.key] ?? '';
      if (raw.trim() === '') continue;
      const n = decimalValue(raw);
      if (n === null) return setError(`Use a number for ${f.label}.`);
      per100g[f.key] = n;
    }
    setBusy(true);
    setError(null);
    try {
      const food = await createCustomFood({ name, brand, per100g });
      router.replace({ pathname: '/food/[id]', params: { id: food.id } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that food. Try again.");
      setBusy(false);
    }
  };

  return (
    <Screen title="Custom Food" back>
      <Field label="Name" value={name} onChangeText={setName} autoCapitalize="sentences" maxLength={200} />
      <Field label="Brand (optional)" value={brand} onChangeText={setBrand} autoCapitalize="words" maxLength={200} />
      <Text style={[styles.caption, { color: c.inkSoft }]}>Copy these from the nutrition label, per 100 g. Leave a field blank if you do not know it.</Text>
      {FIELDS.map((f) => (
        <NumberField key={f.key} label={f.label} value={values[f.key] ?? ''} onChangeText={(v) => setValues((s) => ({ ...s, [f.key]: v }))} helper="Optional." />
      ))}
      <ErrorText>{error}</ErrorText>
      <Button label="Save Food" busy={busy} onPress={save} />
      <Text style={[styles.caption, { color: c.inkSoft }]}>{ESTIMATE_NOTE}</Text>
    </Screen>
  );
}
