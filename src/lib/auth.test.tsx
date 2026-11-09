import { act } from 'react';
import { createRoot } from 'test-renderer';

import { AuthProvider } from './auth';

const mockAuth = {
  getSession: jest.fn(),
  getUser: jest.fn(),
  signOut: jest.fn(() => Promise.resolve({ error: null })),
  onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
};
jest.mock('./supabase', () => ({ supabase: { get auth() { return mockAuth; } } }));
jest.mock('./timezone', () => ({ syncTimezone: () => Promise.resolve() }));

const session = { user: { id: 'u1' } };

beforeEach(() => jest.clearAllMocks());

test('signs out a stored session whose account no longer exists', async () => {
  mockAuth.getSession.mockResolvedValue({ data: { session } });
  mockAuth.getUser.mockResolvedValue({ data: { user: null }, error: { code: 'user_not_found' } });
  await act(async () => createRoot().render(<AuthProvider>{null}</AuthProvider>));
  expect(mockAuth.signOut).toHaveBeenCalledWith({ scope: 'local' });
});

test('keeps the session when the check fails for another reason, like being offline', async () => {
  mockAuth.getSession.mockResolvedValue({ data: { session } });
  mockAuth.getUser.mockResolvedValue({ data: { user: null }, error: { code: undefined, message: 'Network request failed' } });
  await act(async () => createRoot().render(<AuthProvider>{null}</AuthProvider>));
  expect(mockAuth.getUser).toHaveBeenCalled();
  expect(mockAuth.signOut).not.toHaveBeenCalled();
});
