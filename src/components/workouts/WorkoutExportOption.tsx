import { useEffect, useState } from 'react';
import { Switch, Text, View } from 'react-native';

import { Button, styles } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { getHealthWriteAccess, isHealthAvailable } from '@/lib/health/healthkit';
import { useHealthExport } from '@/lib/health/sync';
import { canExportWorkout, WORKOUT_KIND, WORKOUT_WRITE_TYPE, workoutPayload } from '@/lib/health/workout-export';
import { secureStorage } from '@/lib/secure-storage';
import { useTheme } from '@/theme';

const DENIED = 'Health did not allow saving workouts. Turn it on in Settings, Health, Data Access & Devices, then try again.';
const NOTE = 'Saves the activity, start and end time as a Health workout. Exercises, sets, reps, load and notes stay in this app.';

// The "Also save to Apple Health" choice for a workout. A workout already in Health starts on, so turning it off
// removes it from Health; otherwise the choice is remembered per account on this device. Turning it on asks Health
// for permission to write workouts, and nothing else.
export function useWorkoutExport(source: string) {
  const { session } = useAuth();
  const exp = useHealthExport();
  const key = `health-export-${session?.user.id}-workout`;
  const [remembered, setRemembered] = useState(false);
  const [chosen, setChosen] = useState<boolean | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    secureStorage.getItem(key).then((v) => live && setRemembered(v === '1'), () => {});
    return () => { live = false; };
  }, [key]);
  const inHealth = (id: string) => exp.entries.some((e) => e.kind === WORKOUT_KIND && e.recordId === id && e.op === 'save');
  const eligible = canExportWorkout(source) && isHealthAvailable();
  // The remembered choice only covers workouts logged here; one imported from another app starts off.
  const wanted = (id?: string) => eligible && (chosen ?? ((id !== undefined && inHealth(id)) || (remembered && source === 'manual')));
  const set = async (next: boolean) => {
    setMessage(null);
    if (next) {
      try { await exp.allowWrite([WORKOUT_WRITE_TYPE]); } catch { /* the access check below reports it */ }
      if (getHealthWriteAccess(WORKOUT_WRITE_TYPE) !== 'granted') return setMessage(DENIED);
    }
    setChosen(next);
    try { await secureStorage.setItem(key, next ? '1' : '0'); } catch { /* applies until the screen closes */ }
  };
  // A queue error never undoes the saved workout; the option shows what failed.
  const send = (id: string, op: 'save' | 'delete', payload: unknown) => exp.enqueue(WORKOUT_KIND, id, op, payload).catch(() => {});
  return {
    eligible, message, set, on: (id?: string) => wanted(id) === true,
    // After a save: write (or replace) the Health workout, or remove it if the user turned the choice off.
    saved: (id: string, w: Parameters<typeof workoutPayload>[0]) => {
      if (wanted(id)) return send(id, 'save', workoutPayload(w));
      if (inHealth(id)) return send(id, 'delete', null);
    },
    // After a delete: a workout this device exported leaves Health too.
    deleted: (id: string) => (inHealth(id) ? send(id, 'delete', null) : undefined),
  };
}

export function WorkoutExportOption({ id, choice }: { id?: string; choice: ReturnType<typeof useWorkoutExport> }) {
  const c = useTheme();
  const exp = useHealthExport();
  if (!choice.eligible) return null;
  const failed = exp.entries.filter((e) => e.kind === WORKOUT_KIND && e.status === 'failed' && e.recordId === id);
  const denied = failed.some((e) => e.reason === 'permission');
  // Entries stay on the phone until they save, so Retry never loses an entry.
  const retry = () => (denied ? exp.allowWrite([WORKOUT_WRITE_TYPE]) : exp.retry());
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <Text style={[styles.bodyStrong, { color: c.ink, flex: 1 }]}>Also save to Apple Health</Text>
        <Switch accessibilityLabel="Also save to Apple Health" value={choice.on(id)} onValueChange={(v) => void choice.set(v)} />
      </View>
      <Text style={[styles.caption, { color: choice.message ? c.danger : c.inkSoft }]}>{choice.message ?? NOTE}</Text>
      {failed.length > 0 && (
        <View>
          <Text accessibilityLiveRegion="polite" style={[styles.caption, { color: c.danger }]}>
            {denied ? 'Not saved to Apple Health yet. Allow saving workouts in Health, then retry. Your workout is kept here.' : "Couldn't save to Apple Health. Your workout is kept here."}
          </Text>
          <Button plain label="Retry Saving to Health" busy={exp.processing} onPress={() => void retry()} />
        </View>
      )}
    </View>
  );
}
