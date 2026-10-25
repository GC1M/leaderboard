import { act } from 'react';
import { createRoot } from 'test-renderer';

const mockOtp = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { signInWithOtp: (...a: unknown[]) => mockOtp(...a) } },
}));
jest.mock('expo-apple-authentication', () => {
  const { Text } = jest.requireActual('react-native');
  return {
    AppleAuthenticationButtonType: { SIGN_IN: 0 },
    AppleAuthenticationButtonStyle: { BLACK: 2 },
    AppleAuthenticationButton: () => <Text>Apple button</Text>,
    isAvailableAsync: jest.fn().mockResolvedValue(true),
  };
});
jest.mock('expo-crypto', () => ({}));
// Simulates Expo Go: the native module throws on require.
jest.mock('@react-native-google-signin/google-signin', () => {
  throw new Error('RNGoogleSignin could not be found');
});

async function setup() {
  process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = 'web';
  process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID = 'ios';
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const SignIn = require('./sign-in').default;
  const renderer = createRoot();
  await act(async () => {
    renderer.render(<SignIn />);
  });
  const c = renderer.container as any;
  const text = () => JSON.stringify(c);
  const type = (value: string) =>
    act(async () => {
      c.queryAll((n: any) => n.props.onChangeText)[0].props.onChangeText(value);
    });
  const press = (title: string) =>
    act(async () => {
      const btn = c.queryAll((n: any) => n.props.onClick && JSON.stringify(n).includes(`"${title}"`))[0];
      btn.props.onClick();
    });
  return { text, type, press };
}

jest.setTimeout(30000); // first render cold-loads react-native, slow on CI

beforeEach(() => {
  mockOtp.mockReset().mockResolvedValue({ error: null });
});

test('renders without the Google module, keeps Apple and email', async () => {
  const { text } = await setup();
  expect(text()).toContain('Apple button');
  expect(text()).toContain('Send me a code');
  expect(text()).not.toContain('Sign in with Google');
});

test('after sending: shows destination, change link and a 30s resend cooldown', async () => {
  jest.useFakeTimers();
  try {
    const { text, type, press } = await setup();
    await type('a@b.co');
    await press('Send me a code');
    expect(mockOtp).toHaveBeenCalledWith({ email: 'a@b.co' });
    expect(text()).toContain('"Code sent to ","a@b.co"');
    expect(text()).toContain('Change email');
    expect(text()).toContain('Resend code in 30s');
    for (let i = 0; i < 30; i++) await act(async () => jest.advanceTimersByTime(1000));
    expect(text()).not.toContain('Resend code in');
    expect(text()).toContain('Resend code');
    await press('Change email');
    expect(text()).toContain('Send me a code');
  } finally {
    jest.useRealTimers();
  }
});

test('errors show inline, not as an alert', async () => {
  mockOtp.mockResolvedValue({ error: new Error('rate limited') });
  const { text, type, press } = await setup();
  await type('a@b.co');
  await press('Send me a code');
  expect(text()).toContain('rate limited');
  expect(text()).not.toContain('Code sent to');
});
