import * as AppleAuthentication from 'expo-apple-authentication';

import { friendly, sendEmailCode, sendPhoneCode, verifyPhoneCode, signInWithApple, verifyEmailCode } from './sign-in';
import { supabase } from './supabase';

jest.mock('./supabase', () => {
  const eq = jest.fn().mockResolvedValue({});
  const update = jest.fn(() => ({ eq }));
  return {
    supabase: {
      auth: {
        signInWithOtp: jest.fn().mockResolvedValue({ error: null }),
        verifyOtp: jest.fn().mockResolvedValue({ error: null }),
        signInWithIdToken: jest.fn().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null }),
      },
      from: jest.fn(() => ({ update })),
      __update: update,
      __eq: eq,
    },
  };
});

jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  getRandomBytes: jest.fn(() => new Uint8Array(16).fill(1)),
  digestStringAsync: jest.fn(async (_alg: string, s: string) => `hash(${s})`),
}));

jest.mock('expo-apple-authentication', () => ({
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
  isAvailableAsync: jest.fn(),
  signInAsync: jest.fn(),
}));

const s = supabase as unknown as {
  auth: Record<string, jest.Mock>;
  from: jest.Mock;
  __update: jest.Mock;
  __eq: jest.Mock;
};
const apple = AppleAuthentication.signInAsync as jest.Mock;
const RAW = '01'.repeat(16);

beforeEach(() => jest.clearAllMocks());

test('sendEmailCode requests an OTP for the email', async () => {
  await sendEmailCode('a@b.co');
  expect(s.auth.signInWithOtp).toHaveBeenCalledWith({ email: 'a@b.co' });
});

test('verifyEmailCode verifies an email OTP', async () => {
  await verifyEmailCode('a@b.co', '123456');
  expect(s.auth.verifyOtp).toHaveBeenCalledWith({ email: 'a@b.co', token: '123456', type: 'email' });
});

test('OTP errors are thrown', async () => {
  s.auth.verifyOtp.mockResolvedValueOnce({ error: new Error('bad code') });
  await expect(verifyEmailCode('a@b.co', '000000')).rejects.toThrow('bad code');
});

test('Apple: hashed nonce to Apple, raw nonce to Supabase, name written when present', async () => {
  apple.mockResolvedValue({ identityToken: 'tok', fullName: { givenName: 'Ada', familyName: 'Lovelace' } });
  expect(await signInWithApple()).toBe(true);
  expect(apple).toHaveBeenCalledWith(expect.objectContaining({ nonce: `hash(${RAW})` }));
  expect(s.auth.signInWithIdToken).toHaveBeenCalledWith({ provider: 'apple', token: 'tok', nonce: RAW });
  expect(s.from).toHaveBeenCalledWith('profiles');
  expect(s.__update).toHaveBeenCalledWith({ display_name: 'Ada Lovelace' });
  expect(s.__eq).toHaveBeenCalledWith('id', 'u1');
});

test('Apple: no name on repeat sign-in means no profile write', async () => {
  apple.mockResolvedValue({ identityToken: 'tok', fullName: null });
  await signInWithApple();
  apple.mockResolvedValue({ identityToken: 'tok', fullName: { givenName: null, familyName: null } });
  await signInWithApple();
  expect(s.__update).not.toHaveBeenCalled();
});

test('Apple: cancel returns false and never calls Supabase', async () => {
  apple.mockRejectedValue({ code: 'ERR_REQUEST_CANCELED' });
  expect(await signInWithApple()).toBe(false);
  expect(s.auth.signInWithIdToken).not.toHaveBeenCalled();
});

test('phone: sends an SMS OTP and verifies it with type sms', async () => {
  await sendPhoneCode('+14152127777');
  expect(s.auth.signInWithOtp).toHaveBeenCalledWith({ phone: '+14152127777' });
  await verifyPhoneCode('+14152127777', '123456');
  expect(s.auth.verifyOtp).toHaveBeenCalledWith({ phone: '+14152127777', token: '123456', type: 'sms' });
});

test('phone: errors are thrown', async () => {
  s.auth.signInWithOtp.mockResolvedValueOnce({ error: new Error('sms failed') });
  await expect(sendPhoneCode('+14152127777')).rejects.toThrow('sms failed');
});

test('friendly: rate limit and SMS provider failures get their own text, others the fallback', () => {
  expect(friendly({ status: 429 }, 'fb')).toMatch(/Too many tries/);
  expect(friendly({ status: 500, code: 'sms_send_failed' }, 'fb')).toMatch(/Sign in with email/);
  expect(friendly({ status: 400, code: 'phone_provider_disabled' }, 'fb')).toMatch(/Sign in with email/);
  expect(friendly({ status: 400, code: 'validation_failed' }, 'fb')).toBe('fb');
  expect(friendly(undefined, 'fb')).toBe('fb');
});
