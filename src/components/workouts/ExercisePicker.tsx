import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { Segmented } from '@/components/history/Segmented';
import { Button, ErrorText, Field, Row, Section, Skeleton, styles } from '@/components/ui';
import { filterExercises, type WorkoutCategory } from '@/lib/workout-form';
import { createCustomExercise, type Exercise, type ExerciseCategory, listExercises } from '@/lib/workouts';
import { useTheme } from '@/theme';

const CATEGORIES = [
  { value: 'strength', label: 'Strength' },
  { value: 'cardio', label: 'Cardio' },
  { value: 'core', label: 'Core' },
  { value: 'mobility', label: 'Mobility' },
] as const;

// Search the starter catalog and your own exercises, or create a custom one from what you typed.
export function ExercisePicker({ onPick, onCancel, initialCategory = 'strength' }: { initialCategory?: WorkoutCategory; onPick: (e: Exercise) => void; onCancel: () => void }) {
  const c = useTheme();
  const [all, setAll] = useState<Exercise[] | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<ExerciseCategory>(initialCategory === 'full_body' ? 'strength' : initialCategory);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tries, setTries] = useState(0);

  useEffect(() => {
    let live = true;
    listExercises().then(
      (rows) => live && setAll(rows),
      (e) => live && setError(e instanceof Error ? e.message : "Couldn't load exercises."),
    );
    return () => { live = false; };
  }, [tries]);

  const name = query.trim();
  const hits = all ? filterExercises(showAll || initialCategory === 'full_body' ? all : all.filter((e) => e.category === initialCategory), query) : [];
  const canCreate = !!all && name !== '' && !all.some((e) => e.name.toLowerCase() === name.toLowerCase());

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      onPick(await createCustomExercise(name, category));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that exercise. Try again.");
      setBusy(false);
    }
  };

  return (
    <>
      <Field label="Search exercises" value={query} onChangeText={setQuery} autoFocus autoCapitalize="words" autoCorrect={false} returnKeyType="search" />
      <Text style={[styles.caption, { color: c.inkSoft }]}>{showAll || initialCategory === 'full_body' ? 'All workout types' : `${initialCategory} exercises`}</Text>
      {initialCategory !== 'full_body' && <Button plain label={showAll ? 'Show Selected Type' : 'Show All'} onPress={() => setShowAll((v) => !v)} />}
      {!all && !error && <Skeleton label="Loading exercises" rows={4} />}
      {!all && error && (
        <View>
          <ErrorText>{error}</ErrorText>
          <Button plain label="Try Again" onPress={() => { setError(null); setTries((t) => t + 1); }} />
        </View>
      )}
      {all && (
        <>
          {hits.length > 0 && (
            <Section>
              {hits.map((e, i) => (
                <Row key={e.id} label={e.name} value={e.isCustom ? 'Custom' : e.category} onPress={() => onPick(e)} last={i === hits.length - 1} />
              ))}
            </Section>
          )}
          {hits.length === 0 && !canCreate && <Text style={[styles.body, { color: c.inkSoft }]}>No exercises yet. Type a name to create one.</Text>}
          {canCreate && (
            <View style={{ gap: 12 }}>
              <Text style={[styles.bodyStrong, { color: c.ink }]}>{`Create "${name}"`}</Text>
              <Segmented label="Exercise type" options={CATEGORIES} value={category} onChange={setCategory} />
              <ErrorText>{error}</ErrorText>
              <Button label="Create Custom Exercise" busy={busy} onPress={create} />
            </View>
          )}
        </>
      )}
      <Button plain label="Cancel" onPress={onCancel} />
    </>
  );
}
