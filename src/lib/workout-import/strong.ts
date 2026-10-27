import { parseCsv } from './csv';
import { checkSet, headerIndex, type ImportFormat, kg, type Marker, meters, num, parseDate, type ReadResult } from './shared';

// Strong: Settings > Export Strong Data, one row per set. Two layouts are known from public examples:
//   older: Date;Workout Name;Duration;Exercise Name;Set Order;Weight;Reps;Distance;Seconds;Notes;Workout Notes;RPE
//          (Duration like "1h 5m", weight and distance in the user's Strong units, which the file doesn't name)
//   newer: Workout #,Date,Workout Name,Duration (sec),Exercise Name,Set Order,Weight (kg),Reps,RPE,Distance (meters),...
// Strong writes 0 in the columns a set doesn't use, so a 0 here means "not recorded". Set Order is the set number,
// or W/D/F for warm-up, drop and failure sets; "Rest Timer" rows are timers, not sets, and are left out.

const MARKERS: Record<string, Marker> = { w: 'warm-up', d: 'drop', f: 'failure' };
const header = (text: string) => headerIndex(parseCsv(text.slice(0, 2000))[0] ?? []);
const zeroIsEmpty = (n: number | null) => (n === 0 ? null : n);

// "1h 5m", "45m", "30s"; a bare number is seconds.
function duration(s: string, unit: string): number | null {
  if (!s) return null;
  const n = num(s);
  if (n !== null && !Number.isNaN(n)) return unit === 'min' ? n * 60 : n;
  const m = s.match(/^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m(?:in)?)?\s*(?:(\d+)\s*s)?$/i);
  return m && m[0].trim() ? +(m[1] ?? 0) * 3600 + +(m[2] ?? 0) * 60 + +(m[3] ?? 0) : null;
}

export const strong: ImportFormat = {
  app: 'strong',
  label: 'Strong',
  detect: (text) => header(text).has('date', 'workout name', 'exercise name', 'set order'),
  statesUnits: (text) => header(text).unit('weight') !== '',
  read(text, units): ReadResult {
    const [head = [], ...records] = parseCsv(text);
    const h = headerIndex(head);
    const wUnit = h.unit('weight'), dUnit = h.unit('distance'), durUnit = h.unit('duration');
    const out: ReadResult = { rows: [], skipped: [] };
    records.forEach((r, i) => {
      const row = i + 2;
      const order = h.get(r, 'set order');
      if (/^rest/i.test(order)) return;
      const startedAt = parseDate(h.get(r, 'date'));
      if (!startedAt) return out.skipped.push({ row, reason: 'a date that could not be read' });
      const exercise = h.get(r, 'exercise name');
      if (!exercise) return out.skipped.push({ row, reason: 'no exercise name' });
      const set = {
        reps: zeroIsEmpty(num(h.get(r, 'reps'))),
        loadKg: kg(zeroIsEmpty(num(h.get(r, 'weight'))), wUnit, units.weight),
        durationS: zeroIsEmpty(num(h.get(r, 'seconds'))),
        distanceM: meters(zeroIsEmpty(num(h.get(r, 'distance'))), dUnit, units.distance),
      };
      const problem = checkSet(set);
      if (problem) return out.skipped.push({ row, reason: problem });
      out.rows.push({
        row,
        workout: { name: h.get(r, 'workout name') || 'Strong Workout', startedAt, durationS: duration(h.get(r, 'duration'), durUnit), notes: h.get(r, 'workout notes') },
        exercise,
        setNote: h.get(r, 'notes'),
        marker: MARKERS[order.toLowerCase()] ?? null,
        set,
      });
    });
    return out;
  },
};
