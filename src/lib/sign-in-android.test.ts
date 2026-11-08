import * as AppleAuthentication from 'expo-apple-authentication';
import { Platform } from 'react-native';

import { supabase } from './supabase';

// Android with only the web client ID set, as an Android-only build would have.
process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = 'web-id';
delete process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;

jest.mock('./supabase', () => ({
  supabase: { auth: { signInWithIdToken: jest.fn().mockResolvedValue({ error: null }) } },
}));
jest.mock('expo-crypto', () => ({}));
jest.mock('expo-apple-authentication', () => ({ isAvailableAsync: jest.fn().mockResolvedValue(true) }));
const mockGoogle = {
  configure: jest.fn(),
  hasPlayServices: jest.fn(),
  signOut: jest.fn(),
  signIn: jest.fn(),
};
jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: mockGoogle,
  isSuccessResponse: (r: { type: string }) => r.type === 'success',
}));

const platform = Platform as { OS: string };
const ios = platform.OS;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const signIn: typeof import('./sign-in') = require('./sign-in');
const idToken = supabase.auth.signInWithIdToken as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  platform.OS = 'android';
  mockGoogle.hasPlayServices.mockResolvedValue(true);
  mockGoogle.signOut.mockResolvedValue(null);
  mockGoogle.signIn.mockResolvedValue({ type: 'success', data: { idToken: 'gtok' } });
});
afterAll(() => {
  platform.OS = ios;
});

test('Google is offered on Android with just the web client ID; iOS still needs its own', () => {
  expect(signIn.googleAvailable()).toBe(true);
  platform.OS = 'ios';
  expect(signIn.googleAvailable()).toBe(false);
});

test('Sign in with Apple is hidden on Android', async () => {
  expect(await signIn.appleAvailable()).toBe(false);
  expect(AppleAuthentication.isAvailableAsync).not.toHaveBeenCalled();
  platform.OS = 'ios';
  expect(await signIn.appleAvailable()).toBe(true);
});

test('Android Google sign-in checks Play services, forgets the last account, then signs in to Supabase', async () => {
  expect(await signIn.signInWithGoogle()).toBe(true);
  expect(mockGoogle.configure).toHaveBeenCalledWith({ webClientId: 'web-id', iosClientId: undefined });
  expect(mockGoogle.hasPlayServices).toHaveBeenCalledWith({ showPlayServicesUpdateDialog: true });
  expect(mockGoogle.signOut.mock.invocationCallOrder[0]).toBeLessThan(mockGoogle.signIn.mock.invocationCallOrder[0]);
  expect(idToken).toHaveBeenCalledWith({ provider: 'google', token: 'gtok' });
});

test('iOS Google sign-in is unchanged: no Play services check or account reset', async () => {
  platform.OS = 'ios';
  expect(await signIn.signInWithGoogle()).toBe(true);
  expect(mockGoogle.hasPlayServices).not.toHaveBeenCalled();
  expect(mockGoogle.signOut).not.toHaveBeenCalled();
});

test('cancel returns false without touching Supabase', async () => {
  mockGoogle.signIn.mockResolvedValue({ type: 'cancelled', data: null });
  expect(await signIn.signInWithGoogle()).toBe(false);
  expect(idToken).not.toHaveBeenCalled();
});

test('missing Play services stops before the account picker and gets a plain message', async () => {
  const e = Object.assign(new Error('no play'), { code: 'PLAY_SERVICES_NOT_AVAILABLE' });
  mockGoogle.hasPlayServices.mockRejectedValue(e);
  await expect(signIn.signInWithGoogle()).rejects.toBe(e);
  expect(mockGoogle.signIn).not.toHaveBeenCalled();
  expect(signIn.friendly(e, 'fb')).toMatch(/Google Play services/);
});

test('DEVELOPER_ERROR (SHA-1 or client mismatch) says Google is not set up, not to retry', () => {
  expect(signIn.friendly({ code: '10' }, 'fb')).toMatch(/isn't set up for this version/);
});
