import { convertDecimal, decimalValue, numericError } from './numeric-input';
import { validateSteps, validateWeight } from './health/rules';
import { buildWorkout, changeCategory, convertUnits, emptyForm } from './workout-form';
test.each(['75.', '75,', '75.5', '75,5', '.5', ',5'])('supports decimal typing and paste: %s', (s) => {
  expect(decimalValue(s)).not.toBeNull();
  expect(validateWeight(s, 'kg').ok).toBe(true);
});
test.each(['7,5', '1 2', '1e3', '3.0', '-1', '1/2', '8,412'])('does not reinterpret a non-integer steps paste: %s', (s) => expect(validateSteps(s).ok).toBe(false));
test.each(['1,000.5', '75kg', '1e3', '1.2.3', '1,2,3', '-1', 'Infinity'])('rejects invalid decimal text: %s', (s) => {
  expect(decimalValue(s)).toBeNull();
  expect(() => convertDecimal(s, (n) => n * 2)).toThrow();
});
test('keeps blank distinct from a recorded zero', () => {
  expect(decimalValue('')).toBeNull(); expect(decimalValue('0')).toBe(0);
  expect(numericError('')).toBeNull(); expect(validateSteps('0')).toEqual({ ok: true, value: 0 });
});
test('mixed categories retain exercises and canonical measurements through unit overrides', () => {
  const form = { ...emptyForm(new Date(), 'kg', 'km'), durationMin: '30', exercises: [{ exerciseId: 'squat', name: 'Squat', category: 'strength' as const, sets: [{ reps: '5', load: '75.', duration: '', distance: '' }] }] };
  const mixed = changeCategory(form, 'cardio');
  expect(mixed.exercises).toEqual(form.exercises);
  expect(mixed.activityType).toBe('Running');
  const converted = convertUnits(mixed, 'lb', 'mi');
  const built = buildWorkout(converted);
  expect(built.ok).toBe(true);
  if (built.ok) expect(built.input.exercises[0].sets[0].loadKg).toBeCloseTo(75, 5);
  expect(form.weightUnit).toBe('kg');
});
