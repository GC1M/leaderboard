// QA (#64): Sign in with Apple and the iOS Google client rule are unchanged on iOS after the Android sign-in work.
import * as AppleAuthentication from 'expo-apple-authentication';
import { Platform } from 'react-native';

process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = 'web-id';
process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID = 'ios-id';
jest.mock('./supabase', () => ({ supabase: { auth: {} } }));
jest.mock('expo-crypto', () => ({}));
jest.mock('expo-apple-authentication', () => ({ isAvailableAsync: jest.fn().mockResolvedValue(true) }));
jest.mock('@react-native-google-signin/google-signin', () => ({ GoogleSignin: {} }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const signIn: typeof import('./sign-in') = require('./sign-in');
beforeEach(() => jest.replaceProperty(Platform, 'OS', 'ios'));

test('Sign in with Apple is offered on iOS when the device supports it', async () => {
  expect(await signIn.appleAvailable()).toBe(true);
  expect(AppleAuthentication.isAvailableAsync).toHaveBeenCalled();
});

test('Apple stays hidden when the device says it is unavailable or the check throws', async () => {
  (AppleAuthentication.isAvailableAsync as jest.Mock).mockResolvedValueOnce(false);
  expect(await signIn.appleAvailable()).toBe(false);
  (AppleAuthentication.isAvailableAsync as jest.Mock).mockRejectedValueOnce(new Error('x'));
  expect(await signIn.appleAvailable()).toBe(false);
});

test('Google on iOS still needs both the web and the iOS client IDs', () => {
  expect(signIn.googleAvailable()).toBe(true);
});
