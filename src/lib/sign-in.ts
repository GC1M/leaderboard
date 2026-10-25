import * as AppleAuthentication from 'expo-apple-authentication';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Crypto from 'expo-crypto';

import { supabase } from './supabase';

const googleWebClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
const googleIosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;

// The native Google module is not in Expo Go, and requiring it there throws. Load it lazily and treat any failure as unavailable.
function loadGoogle(): typeof import('@react-native-google-signin/google-signin') | null {
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@react-native-google-signin/google-signin');
  } catch {
    return null;
  }
}

export const googleAvailable = () => !!googleWebClientId && !!googleIosClientId && !!loadGoogle();

export async function sendEmailCode(email: string) {
  const { error } = await supabase.auth.signInWithOtp({ email });
  if (error) throw error;
}

export async function verifyEmailCode(email: string, token: string) {
  const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
  if (error) throw error;
}

export async function sendPhoneCode(phone: string) {
  const { error } = await supabase.auth.signInWithOtp({ phone });
  if (error) throw error;
}

export async function verifyPhoneCode(phone: string, token: string) {
  const { error } = await supabase.auth.verifyOtp({ phone, token, type: 'sms' });
  if (error) throw error;
}

export const appleAvailable = () => AppleAuthentication.isAvailableAsync().catch(() => false);

// Returns false if the user cancelled.
export async function signInWithApple(): Promise<boolean> {
  // Apple embeds the hashed nonce in the token; Supabase hashes the raw one to compare.
  const nonce = Array.from(Crypto.getRandomBytes(16), (b) => b.toString(16).padStart(2, '0')).join('');
  const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce);

  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashed,
    });
  } catch (e) {
    if ((e as { code?: string }).code === 'ERR_REQUEST_CANCELED') return false;
    throw e;
  }
  if (!credential.identityToken) throw new Error('Apple sign-in returned no identity token');

  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
    nonce,
  });
  if (error) throw error;

  // Apple only sends the name on the first sign-in.
  const { givenName, familyName } = credential.fullName ?? {};
  const name = [givenName, familyName].filter(Boolean).join(' ');
  if (name && data.user) {
    await supabase.from('profiles').update({ display_name: name }).eq('id', data.user.id);
  }
  return true;
}

// Returns false if the user cancelled.
export async function signInWithGoogle(): Promise<boolean> {
  const google = loadGoogle();
  if (!google) throw new Error('Google sign-in is not available in this build');
  const { GoogleSignin, isSuccessResponse } = google;
  GoogleSignin.configure({ webClientId: googleWebClientId, iosClientId: googleIosClientId });
  const response = await GoogleSignin.signIn();
  if (!isSuccessResponse(response)) return false;
  const token = response.data.idToken;
  if (!token) throw new Error('Google sign-in returned no ID token');
  const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token });
  if (error) throw error;
  return true;
}
