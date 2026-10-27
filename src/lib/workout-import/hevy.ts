import { parseCsv } from './csv';
import { checkSet, headerIndex, type ImportFormat, kg, type Marker, meters, num, parseDate, type ReadResult } from './shared';

// Hevy: Profile > Settings > Export & Import Data > Export Workouts, one row per set:
//   title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,set_type,
//   weight_kg,reps,distance_km,duration_seconds,rpe
// Times look like "26 Oct 2024, 18:05" in local time (checked against the sample in jake-walker/workout-converter).
// Units are in the column names (weight_kg or weight_lbs, distance_km or distance_miles). Unused columns are empty,
// so a 0 is a recorded zero. set_type is normal, warmup (or warm-up), dropset or failure.

const MARKERS: Record<string, Marker> = { warmup: 'warm-up', 'warm-up': 'warm-up', dropset: 'drop', failure: 'failure' };
const header = (text: string) => headerIndex(parseCsv(text.slice(0, 2000))[0] ?? []);

export const hevy: ImportFormat = {
  app: 'hevy',
  label: 'Hevy',
  detect: (text) => header(text).has('title', 'start_time', 'exercise_title', 'set_index'),
  statesUnits: () => true,
  read(text, units): ReadResult {
    const [head = [], ...records] = parseCsv(text);
    const h = headerIndex(head);
    const lb = h.has('weight_lbs'), mi = h.has('distance_miles');
    const out: ReadResult = { rows: [], skipped: [] };
    records.forEach((r, i) => {
      const row = i + 2;
      const startedAt = parseDate(h.get(r, 'start_time'));
      if (!startedAt) return out.skipped.push({ row, reason: 'a date that could not be read' });
      const exercise = h.get(r, 'exercise_title');
      if (!exercise) return out.skipped.push({ row, reason: 'no exercise name' });
      const set = {
        reps: num(h.get(r, 'reps')),
        loadKg: kg(num(h.get(r, 'weight_kg', 'weight_lbs')), lb ? 'lb' : 'kg', units.weight),
        durationS: num(h.get(r, 'duration_seconds')),
        distanceM: meters(num(h.get(r, 'distance_km', 'distance_miles')), mi ? 'mi' : 'km', units.distance),
      };
      const problem = checkSet(set);
      if (problem) return out.skipped.push({ row, reason: problem });
      const end = parseDate(h.get(r, 'end_time'));
      out.rows.push({
        row,
        workout: {
          name: h.get(r, 'title') || 'Hevy Workout', startedAt, notes: h.get(r, 'description'),
          endedAt: end, durationS: end ? Math.max(0, (end.getTime() - startedAt.getTime()) / 1000) : null,
        },
        exercise,
        exerciseNotes: h.get(r, 'exercise_notes'),
        marker: MARKERS[h.get(r, 'set_type').toLowerCase()] ?? null,
        set,
      });
    });
    return out;
  },
};
