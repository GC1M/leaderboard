import { needsTimezoneUpdate } from './timezone';

jest.mock('./supabase', () => ({ supabase: {} }));

test('updates when stored differs from device', () => {
  expect(needsTimezoneUpdate('UTC', 'America/Chicago')).toBe(true);
  expect(needsTimezoneUpdate(null, 'America/Chicago')).toBe(true);
});

test('no update when equal', () => {
  expect(needsTimezoneUpdate('America/Chicago', 'America/Chicago')).toBe(false);
});

test('no update when the device timezone is unknown', () => {
  expect(needsTimezoneUpdate('America/Chicago', undefined)).toBe(false);
  expect(needsTimezoneUpdate('America/Chicago', '')).toBe(false);
});
