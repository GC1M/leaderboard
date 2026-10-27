import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';

import { WeeklyHistory } from '@/components/workouts/WeeklyHistory';
import { WorkoutRow } from '@/components/workouts/WorkoutRow';
import { Button, ErrorText, Row, Screen, Section, Skeleton, styles } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { listDrafts } from '@/lib/workout-draft';
import { defaultDistanceUnit } from '@/lib/workout-form';
import { listWorkouts, listWorkoutsSince, type Workout } from '@/lib/workouts';
import { useTheme } from '@/theme';

// Weekly history, then sessions newest first (summaries only). Each opens a read-only detail; manual ones can be edited there.
export default function Workouts() {
  const c = useTheme();
  const router = useRouter();
  const uid = useAuth().session?.user.id ?? '';
  const [rows, setRows] = useState<Workout[] | null>(null);
  const [drafts, setDrafts] = useState<(string | null)[]>([]); // null: unsaved new workout, string: unsaved edit of that id
  const [error, setError] = useState<string | null>(null);
  const [loads, setLoads] = useState(0); // bumps on every focus so the history refetches too
  const unit = defaultDistanceUnit(Intl.DateTimeFormat().resolvedOptions().locale);

  const load = useCallback(() => {
    setError(null);
    setLoads((n) => n + 1);
    listWorkouts().then(setRows, (e) => setError(e instanceof Error ? e.message : "Couldn't load your workouts."));
    void listDrafts(uid).then(setDrafts);
  }, [uid]);
  useFocusEffect(load);

  return (
    <Screen title="Workouts" back>
      <Button label="New Workout" onPress={() => router.push('/workouts/new')} />
      <Button secondary label="Start from Template" onPress={() => router.push('/workouts/templates')} />
      <Button secondary label="Import from Another App" onPress={() => router.push('/workouts/import')} />
      {drafts.length > 0 && (
        <Section>
          {drafts.map((d, i) => (
            <Row key={d ?? 'new'} action last={i === drafts.length - 1} label={d === null ? 'Resume unfinished workout' : 'Resume unfinished edit'} onPress={() => router.push(d === null ? '/workouts/new' : `/workouts/${d}/edit`)} />
          ))}
        </Section>
      )}
      <WeeklyHistory fetch={listWorkoutsSince} unit={unit} refresh={loads} />
      <Text accessibilityRole="header" style={[styles.heading, { color: c.ink }]}>Sessions</Text>
      {error ? (
        <View>
          <ErrorText>{error}</ErrorText>
          <Button plain label="Try Again" onPress={load} />
        </View>
      ) : !rows ? (
        <Skeleton label="Loading workouts" />
      ) : rows.length === 0 ? (
        <Text style={[styles.body, { color: c.inkSoft }]}>No workouts yet. Log one, or import them from Apple Health or another workout app.</Text>
      ) : (
        <Section>
          {rows.map((w, i) => (
            <WorkoutRow key={w.id} w={w} unit={unit} last={i === rows.length - 1} onPress={() => router.push(`/workouts/${w.id}`)} />
          ))}
        </Section>
      )}
    </Screen>
  );
}
