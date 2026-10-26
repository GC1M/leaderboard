import { localDateKey } from './health/dates';
import type { WeightUnit } from './health/format';
import { buildWorkout, type DistanceUnit, formFromDetail, parseDraft, type WorkoutForm } from './workout-form';
import type { TemplateDetail, TemplateInput } from './workout-templates';
import type { ExerciseCategory, WorkoutDetail } from './workouts';

// A template is edited in the same form as a workout (its date and time are unused), so units, set fields
// and validation are the workout ones and applying a template is a plain copy of the form.
// Everything here is pure so it can be tested without a screen.

export const TEMPLATE_NAME_MAX = 80;

export type TemplateDraft = { editingId: string | null; name: string; form: WorkoutForm };
export type BuiltTemplate = { ok: true; input: TemplateInput } | { ok: false; message: string };

// A real calendar day written YYYY-MM-DD, for the day picked when applying a template.
export function isDay(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  return !!m && localDateKey(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) === s.trim();
}

// formFromDetail already turns canonical values into display units, so lend it the template as a manual
// workout shell. Times are only placeholders: the form takes today's date and the current time.
export function templateToForm(
  t: TemplateDetail,
  weightUnit: WeightUnit,
  distanceUnit: DistanceUnit,
  categories: ReadonlyMap<string, ExerciseCategory>,
  now: Date,
): WorkoutForm {
  const at = now.toISOString();
  const shell: WorkoutDetail = {
    id: t.id, user_id: t.user_id, source: 'manual', activity_type: t.activity_type, started_at: at, ended_at: at, timezone: '',
    duration_s: t.duration_s, distance_m: null, energy_kcal: null, notes: t.notes, health_uuid: null, health_device_id: null, updated_at: t.updated_at,
    exercises: t.exercises.map((e) => ({
      id: e.id, exerciseId: e.exerciseId, name: e.name, notes: e.notes,
      sets: e.sets.map(({ template_exercise_id, ...s }) => ({ ...s, workout_exercise_id: template_exercise_id })),
    })),
  };
  const form = formFromDetail(shell, weightUnit, distanceUnit, categories);
  return { ...form, durationMin: t.duration_s == null ? '' : form.durationMin };
}

// The workout form for a template applied to a chosen day: a fresh copy with no link back to the template,
// so editing or deleting the template later cannot touch it or anything saved from it. Time is now.
export function applyTemplate(
  t: TemplateDetail,
  day: string,
  weightUnit: WeightUnit,
  distanceUnit: DistanceUnit,
  categories: ReadonlyMap<string, ExerciseCategory>,
  now: Date,
): WorkoutForm {
  return { ...templateToForm(t, weightUnit, distanceUnit, categories, now), date: day.trim() };
}

// Validates and converts to canonical units. Runs the workout validation on the sets, so a template can
// never hold a set that applying it would then reject. A blank duration is "not planned".
export function buildTemplate(name: string, f: WorkoutForm): BuiltTemplate {
  const title = name.trim();
  if (!title) return { ok: false, message: 'Enter a name for the template.' };
  if (title.length > TEMPLATE_NAME_MAX) return { ok: false, message: `The template name must be ${TEMPLATE_NAME_MAX} characters or fewer.` };
  const planned = f.durationMin.trim() !== '';
  const r = buildWorkout({ ...f, date: '2000-01-01', time: '12:00', durationMin: planned ? f.durationMin : '1' });
  if (!r.ok) return r;
  const { activityType, notes, exercises, durationS } = r.input;
  return { ok: true, input: { name: title, activityType, durationS: planned ? durationS : null, notes, exercises } };
}

export const serializeTemplateDraft = (d: TemplateDraft) => JSON.stringify({ v: 1, ...d });

// Anything unexpected (older version, corrupt value) is no draft rather than a crash.
export function parseTemplateDraft(raw: string | null): TemplateDraft | null {
  const d = parseDraft(raw);
  if (!d || !raw) return null;
  const { name } = JSON.parse(raw) as { name?: unknown };
  return typeof name === 'string' ? { ...d, name } : null;
}
