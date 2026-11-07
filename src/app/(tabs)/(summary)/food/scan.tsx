import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Text } from 'react-native';

import { Segmented } from '@/components/history/Segmented';
import { NumberField } from '@/components/inputs';
import { Button, ErrorText, Field, Row, Screen, Section, Skeleton, styles } from '@/components/ui';
import { NUTRIENT_NAMES } from '@/lib/food/format';
import { emptyNutrients, NUTRIENT_KEYS, type NutrientKey } from '@/lib/food/nutrition';
import { pickPhoto, PhotoError, readPhoto } from '@/lib/food/photo';
import { type Basis, labelToPer100g, linesFromText, MENU_NOTE, type MenuItem, parseLabel, parseMenu, type ScanLine } from '@/lib/food/scan';
import { createCustomFood, ESTIMATE_NOTE } from '@/lib/food/search';
import { decimalValue } from '@/lib/numeric-input';
import { useTheme } from '@/theme';

const UNIT: Record<NutrientKey, string> = { energy_kcal: 'kcal', protein_g: 'g', carbs_g: 'g', fat_g: 'g', fiber_g: 'g', sugars_g: 'g', sat_fat_g: 'g', sodium_mg: 'mg' };
const BASES = [{ value: 'serving', label: 'Per Serving' }, { value: '100g', label: 'Per 100 g' }] as const;

// Photo of a nutrition label or menu (#51 to #53). The text is read on this iPhone and the photo is deleted
// right after. Nothing is saved until the person reviews the values: a label becomes a custom food, a menu
// dish goes to food search with the entry marked as an estimate.
export default function FoodScan() {
  const c = useTheme();
  const router = useRouter();
  const menu = useLocalSearchParams<{ kind?: string }>().kind === 'menu';
  const [phase, setPhase] = useState<'pick' | 'reading' | 'review'>('pick');
  const [error, setError] = useState<string | null>(null);
  const attempt = useRef(0);
  const [text, setText] = useState('');
  const [showText, setShowText] = useState(false);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [name, setName] = useState('');
  const [basis, setBasis] = useState<Basis>('serving');
  const [serving, setServing] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Partial<Record<NutrientKey, string>>>({});
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const apply = (lines: ScanLine[]) => {
    setText(lines.map((l) => l.text).join('\n'));
    if (menu) {
      setItems(parseMenu(lines));
      return;
    }
    const scan = parseLabel(lines);
    setBasis(scan.basis);
    setServing(scan.servingGrams == null ? '' : String(scan.servingGrams));
    setValues(Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, scan.fields[k].value == null ? '' : String(scan.fields[k].value)])));
    setNotes(Object.fromEntries(NUTRIENT_KEYS.flatMap((k) => (scan.fields[k].note ? [[k, scan.fields[k].note]] : []))));
    const found = NUTRIENT_KEYS.some((k) => scan.fields[k].status === 'read');
    setWarnings(found ? scan.warnings : ["Couldn't find nutrition values in this photo. Enter them from the label, or edit the text and read it again.", ...scan.warnings]);
  };

  const run = async (source: 'camera' | 'library') => {
    setError(null);
    let uri: string | null;
    try {
      uri = await pickPhoto(source);
    } catch (e) {
      return setError(e instanceof PhotoError ? e.message : "Couldn't open the photo. Try again.");
    }
    if (!uri) return;
    const id = ++attempt.current;
    setPhase('reading');
    try {
      const lines = await readPhoto(uri);
      if (attempt.current !== id) return;
      if (lines.length === 0) {
        setPhase('pick');
        return setError('No text found. Try a closer, sharper photo with the label filling the frame.');
      }
      apply(lines);
      setPhase('review');
    } catch (e) {
      if (attempt.current !== id) return;
      setPhase('pick');
      setError(e instanceof PhotoError ? e.message : "Couldn't read that photo. Try again.");
    }
  };

  const save = async () => {
    if (busy) return;
    const reviewed = emptyNutrients();
    for (const k of NUTRIENT_KEYS) {
      const raw = (values[k] ?? '').trim();
      if (raw === '') continue;
      const n = decimalValue(raw);
      if (n === null) return setError(`Use a number for ${NUTRIENT_NAMES[k]}.`);
      reviewed[k] = n;
    }
    const grams = serving.trim() === '' ? null : decimalValue(serving);
    const per100g = labelToPer100g(reviewed, basis, grams);
    if (typeof per100g === 'string') return setError(per100g);
    setBusy(true);
    setError(null);
    try {
      const food = await createCustomFood({ name, brand: '', per100g });
      router.replace({ pathname: '/food/[id]', params: { id: food.id } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that food. Try again.");
      setBusy(false);
    }
  };

  const title = menu ? 'Scan a Menu' : 'Scan a Label';
  const textEditor = (
    <>
      <Button plain label={showText ? 'Hide Text from Photo' : 'Show Text from Photo'} onPress={() => setShowText((s) => !s)} />
      {showText && (
        <>
          <Field label="Text read from the photo" value={text} onChangeText={setText} multiline autoCorrect={false} helper="Fix any misread text, then read it again." />
          <Button plain label="Read This Text Again" onPress={() => apply(linesFromText(text))} />
        </>
      )}
    </>
  );

  if (phase === 'reading') {
    return (
      <Screen title={title} back>
        <Skeleton label="Reading the photo" rows={4} />
        <Button plain label="Cancel" onPress={() => (attempt.current++, setPhase('pick'))} />
      </Screen>
    );
  }

  if (phase === 'pick') {
    return (
      <Screen title={title} back>
        <Text style={[styles.body, { color: c.ink }]}>
          {menu
            ? 'Photograph a menu to pick a dish. You then choose the closest food and how much you ate.'
            : 'Photograph the nutrition facts panel, filling the frame. You check every value before anything is saved.'}
        </Text>
        <ErrorText>{error}</ErrorText>
        <Button label="Take Photo" onPress={() => run('camera')} />
        <Button secondary label="Choose Photo" onPress={() => run('library')} />
        <Text style={[styles.caption, { color: c.inkSoft }]}>The photo is read on this iPhone and deleted right after. It is never uploaded or saved.</Text>
      </Screen>
    );
  }

  if (menu) {
    return (
      <Screen title={title} back>
        <Text style={[styles.caption, { color: c.inkSoft }]}>{MENU_NOTE}</Text>
        {items.length === 0 ? (
          <Text style={[styles.body, { color: c.inkSoft }]}>No dishes found. Try another photo, or search for the food.</Text>
        ) : (
          <Section title="Pick a dish">
            {items.map((item, i) => (
              <Row
                key={item.name}
                label={item.name}
                value={item.details ?? undefined}
                wrap={!!item.details}
                last={i === items.length - 1}
                onPress={() => router.push({ pathname: '/food', params: { q: item.name, estimate: '1', ...(item.details ? { details: item.details } : {}) } })}
              />
            ))}
          </Section>
        )}
        {textEditor}
        <Button secondary label="Try Another Photo" onPress={() => setPhase('pick')} />
      </Screen>
    );
  }

  const per = basis === 'serving' ? 'per serving' : 'per 100 g';
  return (
    <Screen title="Check the Label" back>
      <Text style={[styles.body, { color: c.ink }]}>Compare each value with the label. Blank means unknown, not 0.</Text>
      {warnings.map((w) => <ErrorText key={w}>{w}</ErrorText>)}
      <Field label="Name" value={name} onChangeText={setName} autoCapitalize="sentences" maxLength={200} />
      <Segmented label="Values are" options={BASES} value={basis} onChange={setBasis} />
      {basis === 'serving' && <NumberField label="Serving size (g)" value={serving} onChangeText={setServing} helper="Needed to save the values per 100 g." />}
      {NUTRIENT_KEYS.map((k) => (
        <NumberField
          key={k}
          label={`${NUTRIENT_NAMES[k]} (${UNIT[k]}) ${per}`}
          value={values[k] ?? ''}
          onChangeText={(v) => setValues((s) => ({ ...s, [k]: v }))}
          helper={notes[k] ?? undefined}
        />
      ))}
      <ErrorText>{error}</ErrorText>
      <Button label="Save Food" busy={busy} onPress={save} />
      {textEditor}
      <Text style={[styles.caption, { color: c.inkSoft }]}>{ESTIMATE_NOTE}</Text>
    </Screen>
  );
}
