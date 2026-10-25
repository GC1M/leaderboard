import { act } from 'react';
import { createRoot } from 'test-renderer';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('expo-apple-authentication', () => ({
  AppleAuthenticationScope: {},
  isAvailableAsync: jest.fn().mockResolvedValue(true),
  signInAsync: jest.fn(),
}));
jest.mock('expo-crypto', () => ({}));
// Simulates Expo Go: the native module throws on require.
jest.mock('@react-native-google-signin/google-signin', () => {
  throw new Error('RNGoogleSignin could not be found');
});

test('sign-in screen renders without the Google module, keeps Apple and email', async () => {
  process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = 'web';
  process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID = 'ios';
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const SignIn = require('./sign-in').default;
  const renderer = createRoot();
  await act(async () => {
    renderer.render(<SignIn />);
  });
  const json = JSON.stringify(renderer.container);
  expect(json).toContain('Sign in with Apple');
  expect(json).toContain('Email me a code');
  expect(json).not.toContain('Sign in with Google');
});
