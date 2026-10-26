import { act } from 'react';
import { createRoot } from 'test-renderer';

import type { WeekTotals } from '@/lib/workout-history';
import type { Workout, WorkoutDetail } from '@/lib/workouts';

import { WeeklyHistoryView } from './WeeklyHistory';
import { WorkoutDetailView } from './WorkoutDetailView';
import { WorkoutRow } from './WorkoutRow';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));

async function render(el: React.ReactElement) {
  const r = createRoot();
  await act(async () => {
    r.render(el);
  });
  return JSON.stringify(r.container);
}

const now = new Date(2026, 9, 26, 12);
const week = (weekStart: string, over: Partial<WeekTotals> = {}): WeekTotals => ({
  weekStart, count: 0, durationS: 0, distanceM: null, distanceCount: 0, energyKcal: null, energyCount: 0, imported: 0, manual: 0, ...over,
});

describe('WeeklyHistoryView', () => {
  it('says so when no week has workouts', async () => {
    const out = await render(<WeeklyHistoryView totals={[week('2026-10-12'), week('2026-10-19'), week('2026-10-26')]} unit="km" now={now} />);
    expect(out).toContain('No workouts recorded in the last 3 weeks.');
  });

  it('shows totals, source split and missing weeks without zeros', async () => {
    const out = await render(
      <WeeklyHistoryView
        totals={[
          week('2026-10-19', { count: 2, durationS: 4500, distanceM: 5000, distanceCount: 1, imported: 1, manual: 1 }),
          week('2026-10-26', { count: 1, durationS: 3600, manual: 1 }),
        ]}
        unit="km"
        now={now}
      />,
    );
    expect(out).toContain('1 workout, 1h 0m');
    expect(out).toContain('2 workouts, 1h 15m, 5 km (1 of 2)');
    expect(out).toContain('1 from Apple Health, 1 manual');
    expect(out).not.toContain('kcal'); // nobody recorded calories
    const empty = await render(<WeeklyHistoryView totals={[week('2026-10-12'), week('2026-10-19', { count: 1, durationS: 600, manual: 1 }), week('2026-10-26')]} unit="km" now={now} />);
    expect(empty).toContain('No workouts yet');
    expect(empty).toContain('"borderStyle":"dashed"');
  });
});

const base: Workout = {
  id: 'w1', user_id: 'u', source: 'healthkit', activity_type: 'Running', started_at: new Date(2026, 9, 26, 7).toISOString(),
  ended_at: new Date(2026, 9, 26, 7, 30).toISOString(), timezone: 'UTC', duration_s: 1800, distance_m: null, energy_kcal: null,
  notes: null, health_uuid: 'h', health_device_id: 'd', updated_at: '',
};

describe('WorkoutRow', () => {
  it('names the source and the totals recorded', async () => {
    const out = await render(<WorkoutRow w={{ ...base, distance_m: 5000, energy_kcal: 300 }} unit="km" now={now} onPress={() => {}} />);
    expect(out).toContain('Running, Today, 30m, 5 km, 300 kcal, Apple Health');
    const manual = await render(<WorkoutRow w={{ ...base, source: 'manual', health_uuid: null, health_device_id: null }} unit="km" now={now} onPress={() => {}} />);
    expect(manual).toContain('Running, Today, 30m, Manual');
  });
});

describe('WorkoutDetailView', () => {
  const detail = (over: Partial<WorkoutDetail>): WorkoutDetail => ({ ...base, exercises: [], ...over });

  it('imported: missing distance and calories read Not recorded, never 0', async () => {
    const out = await render(<WorkoutDetailView w={detail({})} weightUnit="kg" distanceUnit="km" now={now} />);
    expect(out).toContain('Apple Health');
    expect(out).toContain('Distance, Not recorded');
    expect(out).toContain('Calories, Not recorded');
    expect(out).not.toContain('0 km');
    expect(out).not.toContain('No exercises logged');
  });

  it('imported: a recorded zero stays a zero', async () => {
    const out = await render(<WorkoutDetailView w={detail({ distance_m: 0, energy_kcal: 0 })} weightUnit="kg" distanceUnit="km" now={now} />);
    expect(out).toContain('0 km');
    expect(out).toContain('0 kcal');
    expect(out).not.toContain('Not recorded');
  });

  it('manual: lists exercises and sets with only the recorded fields, plus notes', async () => {
    const out = await render(
      <WorkoutDetailView
        w={detail({
          source: 'manual', notes: 'felt strong',
          exercises: [
            { id: 'e1', exerciseId: 'x', name: 'Deadlift', notes: 'belt on', sets: [{ id: 's1', workout_exercise_id: 'e1', position: 0, reps: 5, load_kg: 100, duration_s: null, distance_m: null }] },
            { id: 'e2', exerciseId: 'y', name: 'Plank', notes: null, sets: [{ id: 's2', workout_exercise_id: 'e2', position: 0, reps: null, load_kg: null, duration_s: 45, distance_m: null }] },
          ],
        })}
        weightUnit="lb"
        distanceUnit="mi"
        now={now}
      />,
    );
    expect(out).toContain('Manual');
    expect(out).toContain('felt strong');
    expect(out).toContain('Deadlift');
    expect(out).toContain('5 × 220.5 lb');
    expect(out).toContain('belt on');
    expect(out).toContain('45s');
  });

  it('manual without exercises says so', async () => {
    const out = await render(<WorkoutDetailView w={detail({ source: 'manual' })} weightUnit="kg" distanceUnit="km" now={now} />);
    expect(out).toContain('No exercises logged for this workout.');
  });
});
