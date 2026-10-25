import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

import { AuthProvider, useAuth } from '@/lib/auth';
import { authGate } from '@/lib/auth-gate';
import { useStepSync } from '@/lib/health/sync';
import { watchAppStateForAuthRefresh } from '@/lib/supabase';
import { useTheme } from '@/theme';

// Keep the splash up until the stored session is read, so there is no blank frame.
SplashScreen.preventAutoHideAsync().catch(() => {});

// App-wide step sync on launch and every foreground, while signed in.
function StepSync() {
  useStepSync();
  return null;
}

function Routes() {
  const { session, loading } = useAuth();
  const { bg } = useTheme();
  const gate = authGate(loading, session);
  useEffect(() => {
    if (gate !== 'loading') SplashScreen.hideAsync().catch(() => {});
  }, [gate]);
  if (gate === 'loading') return null;
  return (
    <>
      {gate === 'signed-in' && <StepSync />}
      {/* Without contentStyle the stack stays white in dark mode. */}
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: bg } }}>
        <Stack.Protected guard={gate === 'signed-in'}>
          <Stack.Screen name="index" />
          <Stack.Screen name="groups/index" />
          <Stack.Screen name="groups/[id]/index" />
          <Stack.Screen name="groups/[id]/info" />
          <Stack.Screen name="groups/join" />
          <Stack.Screen name="groups/new" />
          <Stack.Screen name="join/[code]" />
          <Stack.Screen name="steps/index" />
          <Stack.Screen name="steps/permission" />
          <Stack.Screen name="steps/sources" />
          <Stack.Screen name="profile" />
        </Stack.Protected>
        <Stack.Protected guard={gate === 'signed-out'}>
          <Stack.Screen name="sign-in" />
        </Stack.Protected>
      </Stack>
    </>
  );
}

export default function RootLayout() {
  useEffect(() => watchAppStateForAuthRefresh(), []);
  return (
    <AuthProvider>
      <Routes />
    </AuthProvider>
  );
}
