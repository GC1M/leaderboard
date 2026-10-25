import { useEffect, useState } from 'react';
import { Alert, Button, StyleSheet, Text, TextInput, View } from 'react-native';

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
import { normalizePhone } from '@/lib/phone';

export default function SignIn() {
  const [apple, setApple] = useState(false);
  // One input: anything with an @ is an email, otherwise a phone number.
  const [contact, setContact] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    appleAvailable().then(setApple);
  }, []);

  const isEmail = contact.includes('@');
  const phone = isEmail ? null : normalizePhone(contact);
  const target = isEmail ? contact.trim() : phone;

  // The session change from supabase flips the route guard, so nothing to navigate to on success.
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      Alert.alert('Sign-in failed', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Leaderboard</Text>
      {apple && <Button title="Sign in with Apple" disabled={busy} onPress={() => run(signInWithApple)} />}
      {googleAvailable() && <Button title="Sign in with Google" disabled={busy} onPress={() => run(signInWithGoogle)} />}
      <TextInput
        style={styles.input}
        placeholder="Email or phone number"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        value={contact}
        onChangeText={setContact}
        editable={!codeSent}
      />
      {codeSent ? (
        <>
          <TextInput
            style={styles.input}
            placeholder="6-digit code"
            keyboardType="number-pad"
            maxLength={6}
            value={code}
            onChangeText={setCode}
          />
          <Button
            title="Verify code"
            disabled={busy || code.length !== 6}
            onPress={() => run(() => (isEmail ? verifyEmailCode(target!, code) : verifyPhoneCode(target!, code)))}
          />
        </>
      ) : (
        <Button
          title="Send me a code"
          disabled={busy || !target}
          onPress={() =>
            run(async () => {
              await (isEmail ? sendEmailCode(target!) : sendPhoneCode(target!));
              setCodeSent(true);
            })
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  title: { fontSize: 28, fontWeight: '600' },
  input: { alignSelf: 'stretch', borderWidth: 1, borderColor: '#999', borderRadius: 8, padding: 12, fontSize: 16 },
});
