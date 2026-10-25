import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useStepsTheme } from '@/components/steps/theme';
import { requestStepsPermission } from '@/lib/health/healthkit';
import { syncSteps } from '@/lib/health/sync';

export default function HealthPermission() {
  const t = useStepsTheme();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allow = async () => {
    setBusy(true);
    setError(null);
    try {
      await requestStepsPermission();
      await syncSteps();
      router.replace('/steps');
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't connect to Health. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: t.bg }]}>
      <Text accessibilityRole="header" style={[styles.title, { color: t.ink }]}>Count your steps automatically</Text>
      <Text style={[styles.body, { color: t.ink }]}>
        We read your step count from Apple Health so your friends see a score they can trust. We only upload daily totals, never your location or workouts.
      </Text>
      {error && <Text accessibilityLiveRegion="polite" style={[styles.caption, { color: t.danger }]}>{error}</Text>}
      <Pressable
        onPress={allow}
        disabled={busy}
        accessibilityRole="button"
        style={({ pressed }) => [styles.button, { backgroundColor: t.accent, opacity: busy ? 0.5 : pressed ? 0.7 : 1 }]}
      >
        <Text style={[styles.buttonText, { color: t.onAccent }]}>Allow Health access</Text>
      </Pressable>
      <Pressable onPress={() => router.replace('/steps')} accessibilityRole="button" style={styles.secondary}>
        <Text style={{ color: t.accent, fontWeight: '600', fontSize: 16 }}>Enter steps manually</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, justifyContent: 'center' },
  title: { fontSize: 30, fontWeight: '800', marginBottom: 12 },
  body: { fontSize: 16, lineHeight: 24, marginBottom: 24 },
  caption: { fontSize: 13, marginBottom: 12 },
  button: { minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontSize: 16, fontWeight: '600' },
  secondary: { minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
});
