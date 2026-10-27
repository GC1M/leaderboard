import * as AppleAuthentication from 'expo-apple-authentication';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, useColorScheme, View } from 'react-native';

import { Button, Field, Screen, styles } from '@/components/ui';

import { normalizePhone } from '@/lib/phone';
import {
  appleAvailable,
  friendly,
  googleAvailable,
  sendEmailCode,
  sendPhoneCode,
  signInWithApple,
  signInWithGoogle,
  verifyEmailCode,
  verifyPhoneCode,
} from '@/lib/sign-in';
import { useTheme } from '@/theme';

const RESEND_SECONDS = 30;

export default function SignIn() {
  const c = useTheme();
  const dark = useColorScheme() === 'dark';
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
  const run = async (fn: () => Promise<unknown>, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(friendly(e, fallback));
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
    }, `Couldn't send a code. Check the ${mode === 'email' ? 'email' : 'phone number'} and try again.`);

  const verify = (token: string) =>
    run(
      () => (mode === 'email' ? verifyEmailCode(sentTo!, token) : verifyPhoneCode(sentTo!, token)),
      'That code is wrong or expired. Request a new one.',
    );

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
    <Screen title="Leaderboard">
      <Text style={[styles.body, { color: c.inkSoft }]}>Compete with your friends. Steps first.</Text>
      {(apple || googleAvailable()) && (
        <View style={local.providers}>
          {apple && (
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
              buttonStyle={
                dark ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
              }
              cornerRadius={14}
              style={local.apple}
              onPress={() => run(signInWithApple, "Couldn't sign in with Apple. Try again.")}
            />
          )}
          {googleAvailable() && (
            <Button
              label="Continue with Google"
              secondary
              disabled={busy}
              onPress={() => run(signInWithGoogle, "Couldn't sign in with Google. Try again.")}
            />
          )}
          <Text style={[styles.caption, { color: c.inkSoft, textAlign: 'center' }]}>or use a one-time code</Text>
        </View>
      )}
      {sentTo ? (
        <>
          <Field
            key="code"
            label="6-digit code"
            helper={`Enter the 6-digit code sent to ${sentTo}`}
            error={error}
            code
            autoFocus
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            value={code}
            onChangeText={(raw) => {
              // No maxLength: it would cut a pasted "123 456" to "123 45" before the spaces are stripped.
              const t = raw.replace(/\D/g, '').slice(0, 6);
              setCode(t);
              if (t.length === 6 && !busy) verify(t);
            }}
          />
          <Button label="Verify Code" busy={busy} disabled={code.length !== 6} onPress={() => verify(code)} />
          <View style={local.row}>
            <Button
              plain
              label={cooldown > 0 ? `Resend Code in ${cooldown}s` : 'Resend Code'}
              disabled={busy || cooldown > 0}
              onPress={send}
            />
            <Button plain label={mode === 'email' ? 'Change Email' : 'Change Phone'} onPress={changeContact} />
          </View>
        </>
      ) : (
        <>
          <Field
            key={mode}
            label={mode === 'email' ? 'Email' : 'Phone number'}
            error={error}
            placeholder={mode === 'email' ? 'you@example.com' : '+1 555 123 4567'}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType={mode === 'email' ? 'email-address' : 'phone-pad'}
            textContentType={mode === 'email' ? 'emailAddress' : 'telephoneNumber'}
            autoComplete={mode === 'email' ? 'email' : 'tel'}
            returnKeyType="send"
            onSubmitEditing={() => valid && !busy && send()}
            value={contact}
            onChangeText={setContact}
          />
          <Button label="Send Me a Code" busy={busy} disabled={!valid} onPress={send} />
          <Button
            plain
            label={mode === 'email' ? 'Use Phone Number Instead' : 'Use Email Instead'}
            onPress={() => switchMode(mode === 'email' ? 'phone' : 'email')}
          />
        </>
      )}
    </Screen>
  );
}

const local = StyleSheet.create({
  providers: { gap: 12, marginTop: 8 },
  apple: { height: 48 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 16 },
});
