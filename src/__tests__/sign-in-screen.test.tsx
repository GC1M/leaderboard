import { act } from 'react';
import { createRoot } from 'test-renderer';

const mockOtp = jest.fn();
const mockVerify = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { signInWithOtp: (...a: unknown[]) => mockOtp(...a), verifyOtp: (...a: unknown[]) => mockVerify(...a) } },
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
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
// Simulates Expo Go: the native module throws on require.
jest.mock('@react-native-google-signin/google-signin', () => {
  throw new Error('RNGoogleSignin could not be found');
});

async function setup() {
  process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = 'web';
  process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID = 'ios';
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const SignIn = require('@/app/sign-in').default;
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
  mockVerify.mockReset().mockResolvedValue({ error: null });
});

test('renders without the Google module, keeps Apple and email', async () => {
  const { text } = await setup();
  expect(text()).toContain('Apple button');
  expect(text()).toContain('Send Me a Code');
  expect(text()).not.toContain('Sign in with Google');
});

test('after sending: shows destination, change link and a 30s resend cooldown', async () => {
  jest.useFakeTimers();
  try {
    const { text, type, press } = await setup();
    await type('a@b.co');
    await press('Send Me a Code');
    expect(mockOtp).toHaveBeenCalledWith({ email: 'a@b.co' });
    expect(text()).toContain('Enter the 6-digit code sent to a@b.co');
    expect(text()).toContain('Change Email');
    expect(text()).toContain('Resend Code in 30s');
    for (let i = 0; i < 30; i++) await act(async () => jest.advanceTimersByTime(1000));
    expect(text()).not.toContain('Resend Code in');
    expect(text()).toContain('Resend Code');
    await press('Change Email');
    expect(text()).toContain('Send Me a Code');
  } finally {
    jest.useRealTimers();
  }
});

test('errors show inline in plain words, not as an alert', async () => {
  mockOtp.mockResolvedValue({ error: new Error('smtp exploded') });
  const { text, type, press } = await setup();
  await type('a@b.co');
  await press('Send Me a Code');
  expect(text()).toContain("Couldn't send a code. Check the email and try again.");
  expect(text()).not.toContain('smtp exploded');
  expect(text()).not.toContain('code sent to');
});

test('rate limits get their own message', async () => {
  mockOtp.mockResolvedValue({ error: Object.assign(new Error('rate limited'), { status: 429 }) });
  const { text, type, press } = await setup();
  await type('a@b.co');
  await press('Send Me a Code');
  expect(text()).toContain('Too many tries. Wait a minute, then request a new code.');
});

test('code step: one box per digit, verifies on the 6th, strips spaces from a pasted code', async () => {
  jest.useFakeTimers(); // the 30s resend cooldown would outlive the test
  try {
    const { text, type, press } = await setup();
    await type('a@b.co');
    await press('Send Me a Code');
    await type('12');
    expect(text()).toContain('"1"');
    expect(text()).toContain('"2"');
    expect(mockVerify).not.toHaveBeenCalled();
    await type('1');
    expect(text()).not.toContain('"2"');
    await type('123 456\n');
    expect(mockVerify).toHaveBeenCalledWith({ email: 'a@b.co', token: '123456', type: 'email' });
  } finally {
    jest.useRealTimers();
  }
});


test('explains disabled send and rejects incomplete email addresses', async () => {
  const { text, type } = await setup();
  expect(text()).toContain('Enter your email address to receive a sign-in code.');
  await type('friend@');
  expect(text()).toContain('Enter a valid email address, such as you@example.com.');
  expect(mockOtp).not.toHaveBeenCalled();
  await type('friend@example.com');
  expect(text()).not.toContain('Enter a valid email address');
});
