import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

import { AuthProvider, useAuth } from '@/lib/auth';
import { authGate } from '@/lib/auth-gate';
import { watchAppStateForAuthRefresh } from '@/lib/supabase';

// Keep the splash up until the stored session is read, so there is no blank frame.
SplashScreen.preventAutoHideAsync().catch(() => {});

function Routes() {
  const { session, loading } = useAuth();
  const gate = authGate(loading, session);
  useEffect(() => {
    if (gate !== 'loading') SplashScreen.hideAsync().catch(() => {});
  }, [gate]);
  if (gate === 'loading') return null;
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={gate === 'signed-in'}>
        <Stack.Screen name="index" />
      </Stack.Protected>
      <Stack.Protected guard={gate === 'signed-out'}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
    </Stack>
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
