import { buildWorkout, emptyForm, emptySet, serializeDraft, type WorkoutForm } from './workout-form';
import { applyTemplate, buildTemplate, isDay, parseTemplateDraft, serializeTemplateDraft, templateToForm } from './workout-template-form';
import type { TemplateDetail } from './workout-templates';
import type { ExerciseCategory } from './workouts';

const now = new Date(2026, 9, 26, 18, 30);
const categories = new Map<string, ExerciseCategory>([['e1', 'strength'], ['e2', 'cardio']]);

const template = (over: Partial<TemplateDetail> = {}): TemplateDetail => ({
  id: 't1', user_id: 'u1', name: 'Push day', activity_type: 'Strength', duration_s: 3600, notes: 'warm up first', updated_at: '2026-10-20T12:00:00Z',
  exercises: [
    {
      id: 'te1', exerciseId: 'e1', name: 'Squat', notes: null,
      sets: [
        { id: 's1', template_exercise_id: 'te1', position: 0, reps: 5, load_kg: 100, duration_s: null, distance_m: null },
        { id: 's2', template_exercise_id: 'te1', position: 1, reps: 0, load_kg: 0, duration_s: null, distance_m: null },
      ],
    },
    { id: 'te2', exerciseId: 'e2', name: 'Running', notes: null, sets: [{ id: 's3', template_exercise_id: 'te2', position: 0, reps: null, load_kg: null, duration_s: 600, distance_m: 2000 }] },
  ],
  ...over,
});

const apply = (t: TemplateDetail, day = '2026-11-02', unit: 'kg' | 'lb' = 'kg') => applyTemplate(t, day, unit, 'km', categories, now);
const built = (f: WorkoutForm) => {
  const r = buildWorkout(f);
  if (!r.ok) throw new Error(r.message);
  return r.input;
};

describe('templateToForm', () => {
  it('shows canonical values in the display units and keeps order, blanks and zeros', () => {
    const f = templateToForm(template(), 'lb', 'mi', categories, now);
    expect(f).toMatchObject({ activityType: 'Strength', durationMin: '60', notes: 'warm up first', weightUnit: 'lb', distanceUnit: 'mi' });
    expect(f.exercises.map((e) => [e.name, e.category])).toEqual([['Squat', 'strength'], ['Running', 'cardio']]);
    expect(f.exercises[0].sets[0]).toEqual({ reps: '5', load: '220.46', duration: '', distance: '' });
    expect(f.exercises[0].sets[1]).toEqual({ reps: '0', load: '0', duration: '', distance: '' });
    expect(f.exercises[1].sets[0]).toEqual({ reps: '', load: '', duration: '10', distance: '1.24' });
  });

  it('leaves the duration blank when none is planned', () => {
    expect(templateToForm(template({ duration_s: null }), 'kg', 'km', categories, now).durationMin).toBe('');
  });
});

describe('buildTemplate', () => {
  it('round-trips a template through the form without changing a value', () => {
    for (const unit of ['kg', 'lb'] as const) {
      const r = buildTemplate('Push day', templateToForm(template(), unit, 'km', categories, now));
      if (!r.ok) throw new Error(r.message);
      expect(r.input).toMatchObject({ name: 'Push day', activityType: 'Strength', durationS: 3600, notes: 'warm up first' });
      expect(r.input.exercises[0].sets[0].loadKg).toBeCloseTo(100, 1);
      expect(r.input.exercises[0].sets[1]).toEqual({ reps: 0, loadKg: 0, durationS: null, distanceM: null });
      expect(r.input.exercises[1].sets[0]).toEqual({ reps: null, loadKg: null, durationS: 600, distanceM: 2000 });
    }
  });

  it('treats a blank duration as not planned', () => {
    const r = buildTemplate('Push day', { ...apply(template()), durationMin: ' ' });
    expect(r).toMatchObject({ ok: true, input: { durationS: null } });
  });

  it('rejects what applying it would later reject', () => {
    const f = apply(template());
    const fail = (name: string, form: WorkoutForm) => {
      const r = buildTemplate(name, form);
      if (r.ok) throw new Error('expected failure');
      return r.message;
    };
    expect(fail('  ', f)).toMatch(/name/);
    expect(fail('x'.repeat(81), f)).toMatch(/80 characters/);
    expect(fail('Push day', { ...f, activityType: '' })).toMatch(/activity type/);
    expect(fail('Push day', { ...f, durationMin: '0' })).toMatch(/more than zero/);
    expect(fail('Push day', { ...f, exercises: [{ ...f.exercises[0], sets: [emptySet()] }] })).toMatch(/needs reps, load, time, or distance/);
    expect(fail('Push day', { ...f, exercises: [{ ...f.exercises[0], sets: [] }] })).toMatch(/at least one set/);
  });
});

describe('applying a template', () => {
  it('creates a workout on the chosen day with the planned exercises', () => {
    const w = built(apply(template(), '2026-11-02'));
    expect(w.startedAt).toEqual(new Date(2026, 10, 2, 18, 30));
    expect(w.durationS).toBe(3600);
    expect(w.exercises.map((e) => e.exerciseId)).toEqual(['e1', 'e2']);
    expect(w.exercises[0].sets[0]).toEqual({ reps: 5, loadKg: 100, durationS: null, distanceM: null });
  });

  it('can be applied again and again, each a separate copy that edits do not leak between', () => {
    const t = template();
    const first = apply(t, '2026-11-02');
    const second = apply(t, '2026-11-02');
    expect(second).toEqual(first);
    first.exercises[0].sets[0].reps = '99';
    first.exercises.pop();
    first.notes = 'changed';
    expect(second.exercises).toHaveLength(2);
    expect(second.exercises[0].sets[0].reps).toBe('5');
    expect(apply(t, '2026-11-09').exercises[0].sets[0].reps).toBe('5');
    expect(t.exercises[0].sets[0].reps).toBe(5);
    expect(built(second).exercises[0].sets[0].reps).toBe(5);
    expect(apply(t, '2026-11-09').date).toBe('2026-11-09');
  });

  it('is not changed by later edits to the template', () => {
    const t = template();
    const past = apply(t);
    const snapshot = JSON.stringify(past);
    t.name = 'Renamed';
    t.exercises[0].sets[0].load_kg = 140;
    t.exercises.splice(1, 1);
    expect(JSON.stringify(past)).toBe(snapshot);
    expect(apply(t).exercises).toHaveLength(1);
    expect(apply(t).exercises[0].sets[0].load).toBe('140');
  });

  it('keeps the form independent of the template: nothing in it refers back to the template', () => {
    expect(JSON.stringify(apply(template()))).not.toMatch(/te1|t1"|Push day/);
  });
});

describe('isDay', () => {
  it('accepts real calendar days only', () => {
    expect(isDay('2026-11-02')).toBe(true);
    expect(isDay(' 2026-11-02 ')).toBe(true);
    expect(isDay('2026-02-30')).toBe(false);
    expect(isDay('2026-13-01')).toBe(false);
    expect(isDay('11/02/2026')).toBe(false);
    expect(isDay('')).toBe(false);
  });
});

describe('template drafts', () => {
  const draft = { editingId: 't1', name: 'Push day', form: apply(template()) };

  it('recovers exactly what was typed, name included', () => {
    expect(parseTemplateDraft(serializeTemplateDraft(draft))).toEqual(draft);
    expect(parseTemplateDraft(serializeTemplateDraft({ ...draft, editingId: null }))).toEqual({ ...draft, editingId: null });
  });

  it('is no draft when the value is missing, corrupt, from another version or lacks a name', () => {
    expect(parseTemplateDraft(null)).toBeNull();
    expect(parseTemplateDraft('{nope')).toBeNull();
    expect(parseTemplateDraft(JSON.stringify({ v: 2, ...draft }))).toBeNull();
    expect(parseTemplateDraft(JSON.stringify({ v: 1, editingId: 't1', form: draft.form }))).toBeNull();
    expect(parseTemplateDraft(JSON.stringify({ v: 1, ...draft, name: 5 }))).toBeNull();
    expect(parseTemplateDraft(JSON.stringify({ v: 1, ...draft, form: { ...draft.form, weightUnit: 'stone' } }))).toBeNull();
  });

  it('keeps a half-typed template and an unfinished workout apart', () => {
    const workout = serializeDraft({ editingId: null, form: emptyForm(now, 'kg', 'km') });
    expect(parseTemplateDraft(workout)).toBeNull();
  });
});
