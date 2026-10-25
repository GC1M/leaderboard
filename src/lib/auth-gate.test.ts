import type { Session } from '@supabase/supabase-js';

import { authGate } from './auth-gate';

const session = { user: { id: 'u1' } } as Session;

test('loading wins until the stored session is read', () => {
  expect(authGate(true, null)).toBe('loading');
  expect(authGate(true, session)).toBe('loading');
});

test('no session means signed out (sign-in screen)', () => {
  expect(authGate(false, null)).toBe('signed-out');
});

test('a session means signed in (home)', () => {
  expect(authGate(false, session)).toBe('signed-in');
});
