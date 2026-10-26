import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';

import { Button, ErrorText, Row, Screen, Section, Skeleton, styles } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { listTemplateDrafts } from '@/lib/workout-template-draft';
import { listTemplates, type WorkoutTemplate } from '@/lib/workout-templates';
import { useTheme } from '@/theme';

// Your templates, most recently changed first. Open one to start a workout from it, edit, duplicate or delete it.
export default function Templates() {
  const c = useTheme();
  const router = useRouter();
  const uid = useAuth().session?.user.id ?? '';
  const [rows, setRows] = useState<WorkoutTemplate[] | null>(null);
  const [drafts, setDrafts] = useState<(string | null)[]>([]); // null: unsaved new template, string: unsaved edit of that id
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    listTemplates().then(setRows, (e) => setError(e instanceof Error ? e.message : "Couldn't load your templates."));
    void listTemplateDrafts(uid).then(setDrafts);
  }, [uid]);
  useFocusEffect(load);

  return (
    <Screen title="Templates" back>
      <Button label="New Template" onPress={() => router.push('/workouts/templates/new')} />
      {drafts.length > 0 && (
        <Section>
          {drafts.map((d, i) => (
            <Row key={d ?? 'new'} action last={i === drafts.length - 1} label={d === null ? 'Resume unfinished template' : 'Resume unfinished edit'} onPress={() => router.push(d === null ? '/workouts/templates/new' : `/workouts/templates/${d}`)} />
          ))}
        </Section>
      )}
      {error ? (
        <View>
          <ErrorText>{error}</ErrorText>
          <Button plain label="Try Again" onPress={load} />
        </View>
      ) : !rows ? (
        <Skeleton label="Loading templates" />
      ) : rows.length === 0 ? (
        <Text style={[styles.body, { color: c.inkSoft }]}>No templates yet. Create one, or save a workout as a template from its Edit screen.</Text>
      ) : (
        <Section footer="Only you can see your templates.">
          {rows.map((t, i) => (
            <Row key={t.id} label={t.name} value={t.activity_type} last={i === rows.length - 1} onPress={() => router.push(`/workouts/templates/${t.id}`)} />
          ))}
        </Section>
      )}
    </Screen>
  );
}
