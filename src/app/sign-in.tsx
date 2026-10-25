import * as AppleAuthentication from 'expo-apple-authentication';
import { useEffect, useState } from 'react';
import { Button, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput } from 'react-native';

import { normalizePhone } from '@/lib/phone';
import {
  appleAvailable,
  googleAvailable,
  sendEmailCode,
  sendPhoneCode,
  signInWithApple,
  signInWithGoogle,
  verifyEmailCode,
  verifyPhoneCode,
} from '@/lib/sign-in';

const RESEND_SECONDS = 30;

export default function SignIn() {
  const [apple, setApple] = useState(false);
  const [mode, setMode] = useState<'email' | 'phone'>('email');
  const [contact, setContact] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    appleAvailable().then(setApple);
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const target = mode === 'email' ? contact.trim() : normalizePhone(contact);
  const valid = mode === 'email' ? target!.includes('@') : !!target;

  // The session change from supabase flips the route guard, so nothing to navigate to on success.
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const send = () =>
    run(async () => {
      await (mode === 'email' ? sendEmailCode(target!) : sendPhoneCode(target!));
      setSentTo(target);
      setCode('');
      setCooldown(RESEND_SECONDS);
    });

  const verify = (token: string) =>
    run(() => (mode === 'email' ? verifyEmailCode(sentTo!, token) : verifyPhoneCode(sentTo!, token)));

  const changeContact = () => {
    setSentTo(null);
    setCode('');
    setError(null);
  };

  const switchMode = (m: 'email' | 'phone') => {
    setMode(m);
    setContact('');
    setError(null);
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Leaderboard</Text>
        {apple && (
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
            buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
            cornerRadius={8}
            style={styles.apple}
            onPress={() => run(signInWithApple)}
          />
        )}
        {googleAvailable() && <Button title="Sign in with Google" disabled={busy} onPress={() => run(signInWithGoogle)} />}
        {sentTo ? (
          <>
            <Text>Code sent to {sentTo}</Text>
            <TextInput
              style={styles.input}
              placeholder="6-digit code"
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChangeText={(t) => {
                setCode(t);
                if (t.length === 6 && !busy) verify(t);
              }}
            />
            {error && <Text style={styles.error}>{error}</Text>}
            <Button title="Verify code" disabled={busy || code.length !== 6} onPress={() => verify(code)} />
            <Button
              title={cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
              disabled={busy || cooldown > 0}
              onPress={send}
            />
            <Button title={mode === 'email' ? 'Change email' : 'Change phone'} onPress={changeContact} />
          </>
        ) : (
          <>
            <Button
              title={mode === 'email' ? 'Use phone number instead' : 'Use email instead'}
              onPress={() => switchMode(mode === 'email' ? 'phone' : 'email')}
            />
            <TextInput
              style={styles.input}
              placeholder={mode === 'email' ? 'Email' : 'Phone number'}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType={mode === 'email' ? 'email-address' : 'phone-pad'}
              textContentType={mode === 'email' ? 'emailAddress' : 'telephoneNumber'}
              value={contact}
              onChangeText={setContact}
            />
            {error && <Text style={styles.error}>{error}</Text>}
            <Button title="Send me a code" disabled={busy || !valid} onPress={send} />
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  title: { fontSize: 28, fontWeight: '600' },
  apple: { width: 240, height: 44 },
  input: { alignSelf: 'stretch', borderWidth: 1, borderColor: '#999', borderRadius: 8, padding: 12, fontSize: 16 },
  error: { color: '#c00' },
});
