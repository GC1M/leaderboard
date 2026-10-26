import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';

import { Button, ErrorText, Row, Screen, Section, Skeleton, styles } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { readingDateLabel } from '@/lib/health/dates';
import { listDrafts } from '@/lib/workout-draft';
import { defaultDistanceUnit, workoutSummary } from '@/lib/workout-form';
import { listWorkouts, type Workout } from '@/lib/workouts';
import { useTheme } from '@/theme';

// Newest first, summaries only. Imported Health workouts open read-only.
export default function Workouts() {
  const c = useTheme();
  const router = useRouter();
  const uid = useAuth().session?.user.id ?? '';
  const [rows, setRows] = useState<Workout[] | null>(null);
  const [drafts, setDrafts] = useState<(string | null)[]>([]); // null: unsaved new workout, string: unsaved edit of that id
  const [error, setError] = useState<string | null>(null);
  const unit = defaultDistanceUnit(Intl.DateTimeFormat().resolvedOptions().locale);

  const load = useCallback(() => {
    setError(null);
    listWorkouts().then(setRows, (e) => setError(e instanceof Error ? e.message : "Couldn't load your workouts."));
    void listDrafts(uid).then(setDrafts);
  }, [uid]);
  useFocusEffect(load);

  return (
    <Screen title="Workouts" back>
      <Button label="New Workout" onPress={() => router.push('/workouts/new')} />
      <Button secondary label="Start from Template" onPress={() => router.push('/workouts/templates')} />
      {drafts.length > 0 && (
        <Section>
          {drafts.map((d, i) => (
            <Row key={d ?? 'new'} action last={i === drafts.length - 1} label={d === null ? 'Resume unfinished workout' : 'Resume unfinished edit'} onPress={() => router.push(d === null ? '/workouts/new' : `/workouts/${d}`)} />
          ))}
        </Section>
      )}
      {error ? (
        <View>
          <ErrorText>{error}</ErrorText>
          <Button plain label="Try Again" onPress={load} />
        </View>
      ) : !rows ? (
        <Skeleton label="Loading workouts" />
      ) : rows.length === 0 ? (
        <Text style={[styles.body, { color: c.inkSoft }]}>No workouts yet. Log one, or import them from Apple Health.</Text>
      ) : (
        <Section>
          {rows.map((w, i) => (
            <Row
              key={w.id}
              label={`${w.activity_type}, ${readingDateLabel(new Date(w.started_at))}`}
              value={workoutSummary(w, unit)}
              last={i === rows.length - 1}
              onPress={() => router.push(`/workouts/${w.id}`)}
            />
          ))}
        </Section>
      )}
    </Screen>
  );
}
