import { Text, View } from 'react-native';

import { Row, Section, styles } from '@/components/ui';
import { readingDateLabel } from '@/lib/health/dates';
import { formatSleep, type WeightUnit } from '@/lib/health/format';
import { setText, sourceLabel, workoutSeconds } from '@/lib/workout-history';
import { type DistanceUnit, fromMeters } from '@/lib/workout-form';
import type { WorkoutDetail } from '@/lib/workouts';
import { useTheme } from '@/theme';

const NOT_RECORDED = 'Not recorded';

// Read-only view of one session. Distance and calories say "Not recorded" when they are missing, never 0.
export function WorkoutDetailView({ w, weightUnit, distanceUnit, now }: { w: WorkoutDetail; weightUnit: WeightUnit; distanceUnit: DistanceUnit; now?: Date }) {
  const c = useTheme();
  const start = new Date(w.started_at);
  const time = start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const imported = w.source === 'healthkit';
  return (
    <>
      <Section
        footer={
          imported
            ? "Imported from Apple Health. Change it in Health, and it updates here after the next import. Exercises and sets aren't part of an import."
            : "Logged in this app. Calories aren't tracked for manual workouts."
        }
      >
        <Row label="Date" value={`${readingDateLabel(start, now)}, ${time}`} />
        <Row label="Source" value={sourceLabel(w.source)} />
        <Row label="Duration" value={formatSleep(workoutSeconds(w) / 60)} />
        <Row label="Distance" value={w.distance_m != null ? `${fromMeters(Number(w.distance_m), distanceUnit)} ${distanceUnit}` : NOT_RECORDED} />
        <Row label="Calories" value={w.energy_kcal != null ? `${Math.round(Number(w.energy_kcal))} kcal` : NOT_RECORDED} last />
      </Section>
      {w.notes ? (
        <Section title="Notes">
          <Text style={[styles.body, { color: c.ink, padding: 16 }]}>{w.notes}</Text>
        </Section>
      ) : null}
      {!imported &&
        (w.exercises.length === 0 ? (
          <Text style={[styles.body, { color: c.inkSoft }]}>No exercises logged for this workout.</Text>
        ) : (
          w.exercises.map((e) => (
            <Section key={e.id} title={e.name || 'Exercise'} footer={e.notes ?? undefined}>
              {e.sets.length === 0 ? (
                <Row label="No sets logged" last />
              ) : (
                e.sets.map((s, i) => (
                  <Row key={s.id} label={`Set ${i + 1}`} value={setText(s, weightUnit, distanceUnit) ?? NOT_RECORDED} last={i === e.sets.length - 1} />
                ))
              )}
            </Section>
          ))
        ))}
      <View>
        <Text style={[styles.caption, { color: c.inkSoft }]}>
          Only you can see this. Groups you share workouts with see a weekly count and total time only, never exercises, sets or notes.
        </Text>
      </View>
    </>
  );
}
