import * as AppleAuthentication from 'expo-apple-authentication';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';

import { supabase } from './supabase';

const googleWebClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
const googleIosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;

// The native Google module is not in Expo Go, and requiring it there throws. Load it lazily and treat any failure as unavailable.
function loadGoogle(): typeof import('@react-native-google-signin/google-signin') | null {
  if (Platform.OS === 'web' || Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@react-native-google-signin/google-signin');
  } catch {
    return null;
  }
}

// Plain messages instead of raw provider errors. Rate limits get their own, since "try again" would be wrong advice.
// SMS provider failures are not the user's fault, so don't tell them to check their number.
export const friendly = (e: unknown, fallback: string) => {
  const { status, code } = (e ?? {}) as { status?: number; code?: string };
  if (status === 429) return 'Too many tries. Wait a minute, then request a new code.';
  if (code === 'sms_send_failed' || code === 'phone_provider_disabled')
    return "Text codes aren't working right now. Sign in with email instead.";
  // Android Google errors. '10' is DEVELOPER_ERROR: this build's package name and signing SHA-1 don't match an Android
  // OAuth client in Google Cloud, which the user can't fix.
  if (code === 'PLAY_SERVICES_NOT_AVAILABLE')
    return 'Google sign-in needs Google Play services, which is missing or out of date. Update it, or use a one-time code.';
  if (code === '10') return "Google sign-in isn't set up for this version of the app. Use a one-time code instead.";
  return fallback;
};

// Android only needs the web client ID: Google matches the Android OAuth client by package name and signing SHA-1.
export const googleAvailable = () =>
  !!googleWebClientId && (Platform.OS !== 'ios' || !!googleIosClientId) && !!loadGoogle();

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

// Sign in with Apple is iOS only; Android offers email codes and Google.
export const appleAvailable = async () =>
  Platform.OS === 'ios' && (await AppleAuthentication.isAvailableAsync().catch(() => false));

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
  const fullName = [givenName, familyName].filter(Boolean).join(' ');
  // Whole characters, so an emoji is never cut in half.
  const name = Array.from(fullName).slice(0, 40).join('').trim();
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
  if (Platform.OS === 'android') {
    // Throws PLAY_SERVICES_NOT_AVAILABLE (and offers the update dialog) instead of failing inside signIn.
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    // Android reuses the last Google account without asking, so forget it to show the account picker every time.
    // Otherwise signing out and back in could never switch accounts. The app session lives in Supabase, not here.
    await GoogleSignin.signOut().catch(() => {});
  }
  const response = await GoogleSignin.signIn();
  if (!isSuccessResponse(response)) return false;
  const token = response.data.idToken;
  if (!token) throw new Error('Google sign-in returned no ID token');
  const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token });
  if (error) throw error;
  return true;
}
