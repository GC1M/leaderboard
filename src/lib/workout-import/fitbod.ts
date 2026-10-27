import { localDateKey } from '../health/dates';
import { parseCsv } from './csv';
import { checkSet, headerIndex, type ImportFormat, kg, meters, num, parseDate, type ReadResult } from './shared';

// Fitbod: Log > Settings (gear) > Export workout data, one row per set:
//   Date,Exercise,Reps,Weight(kg),Duration(s),Distance(m),Incline,Resistance,isWarmup,Note,multiplier
// Dates carry an offset ("2024-03-02 18:30:00 +0000"). The file has no workout column, so all sets on one local day
// are one workout, from the first set's time to the last. Fitbod writes 0 in the columns a set doesn't use, so a 0
// here means "not recorded". Incline, Resistance and multiplier have no place in our sets and are not imported.

const header = (text: string) => headerIndex(parseCsv(text.slice(0, 2000))[0] ?? []);
const zeroIsEmpty = (n: number | null) => (n === 0 ? null : n);

export const fitbod: ImportFormat = {
  app: 'fitbod',
  label: 'Fitbod',
  detect: (text) => header(text).has('date', 'exercise', 'reps', 'iswarmup'),
  statesUnits: (text) => header(text).unit('weight') !== '',
  read(text, units): ReadResult {
    const [head = [], ...records] = parseCsv(text);
    const h = headerIndex(head);
    const wUnit = h.unit('weight'), dUnit = h.unit('distance');
    const out: ReadResult = { rows: [], skipped: [] };
    const days = new Map<string, { first: Date; last: Date }>();
    const sets = records.flatMap((r, i) => {
      const row = i + 2;
      const at = parseDate(h.get(r, 'date'));
      if (!at) return out.skipped.push({ row, reason: 'a date that could not be read' }), [];
      const exercise = h.get(r, 'exercise');
      if (!exercise) return out.skipped.push({ row, reason: 'no exercise name' }), [];
      const set = {
        reps: zeroIsEmpty(num(h.get(r, 'reps'))),
        loadKg: kg(zeroIsEmpty(num(h.get(r, 'weight'))), wUnit, units.weight),
        durationS: zeroIsEmpty(num(h.get(r, 'duration'))),
        distanceM: meters(zeroIsEmpty(num(h.get(r, 'distance'))), dUnit || 'm', units.distance),
      };
      const problem = checkSet(set);
      if (problem) return out.skipped.push({ row, reason: problem }), [];
      const day = localDateKey(at);
      const d = days.get(day);
      if (!d) days.set(day, { first: at, last: at });
      else if (at < d.first) d.first = at;
      else if (at > d.last) d.last = at;
      return [{ row, r, at, day, exercise, set }];
    });
    for (const { row, r, day, exercise, set } of sets) {
      const { first, last } = days.get(day)!;
      const span = (last.getTime() - first.getTime()) / 1000;
      out.rows.push({
        row,
        workout: { name: 'Fitbod Workout', startedAt: first, endedAt: last, durationS: span > 0 ? span : null },
        exercise,
        setNote: h.get(r, 'note'),
        marker: h.get(r, 'iswarmup').toLowerCase() === 'true' ? 'warm-up' : null,
        set,
      });
    }
    return out;
  },
};
