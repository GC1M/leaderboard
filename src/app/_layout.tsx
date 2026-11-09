import { Newsreader_500Medium, Newsreader_600SemiBold, useFonts } from '@expo-google-fonts/newsreader';
import { Stack, useGlobalSearchParams, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { loadAppearance } from '@/lib/appearance';

import { AuthProvider, useAuth } from '@/lib/auth';
import { isValidCode, isValidGroupId, normalizeCode, pendingInvite } from '@/lib/groups';
import { FirstRunName } from '@/components/FirstRunName';
import { WebDialogHost } from '@/components/WebDialogHost';
import { authGate } from '@/lib/auth-gate';
import { HealthSyncProvider } from '@/lib/health/sync';
import { watchAppStateForAuthRefresh } from '@/lib/supabase';
import { useTheme } from '@/theme';

// Keep the splash up until the stored session is read, so there is no blank frame.
SplashScreen.preventAutoHideAsync().catch(() => {});
// Start reading the saved appearance now, while the splash waits on fonts, so a saved Light or Dark doesn't flash the other theme.
void loadAppearance();

function Routes() {
  const { session, loading } = useAuth();
  const { bg } = useTheme();
  // Titles use Newsreader; hold the splash until it loads (or fails, falling back to the system font).
  const [fontsLoaded, fontError] = useFonts({ Newsreader_500Medium, Newsreader_600SemiBold });
  const gate = fontsLoaded || fontError ? authGate(loading, session) : 'loading';
  const router = useRouter();
  const segments = useSegments();
  const { code, competition } = useGlobalSearchParams<{ code?: string | string[]; competition?: string | string[] }>();
  const invite = normalizeCode(typeof code === 'string' ? code : '');
  // Protected routes keep query parameters when auth changes. Resume only our validated invite route,
  // never an arbitrary return URL, and still let the user confirm joining on that screen.
  // Native loses the query param, so fall back to the invite join/[code] parked, and resume it only once.
  // Wait until the guard flip has moved off sign-in: the stack reset it triggers overwrites an earlier replace.
  useEffect(() => {
    if (gate !== 'signed-in' || segments[0] === 'sign-in') return;
    const next = isValidCode(invite) ? invite : pendingInvite.code;
    const contest = typeof competition === 'string' && isValidGroupId(competition) ? competition : pendingInvite.competition;
    pendingInvite.code = ''; pendingInvite.competition = '';
    if (isValidCode(next) && segments[0] !== 'join') router.replace(`/join/${next}${isValidGroupId(contest) ? `?competition=${contest}` : ''}`);
  }, [gate, invite, competition, router, segments]);
  useEffect(() => {
    if (gate !== 'loading') SplashScreen.hideAsync().catch(() => {});
  }, [gate]);
  if (gate === 'loading') return null;
  return (
    <>
      {/* Without contentStyle the stack stays white in dark mode. */}
      <Stack key={session?.user.id ?? 'signed-out'} screenOptions={{ headerShown: false, contentStyle: { backgroundColor: bg } }}>
        <Stack.Protected guard={gate === 'signed-in'}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="privacy" />
        </Stack.Protected>
        <Stack.Protected guard={gate === 'signed-out'}>
          <Stack.Screen name="sign-in" />
        </Stack.Protected>
        <Stack.Screen name="join/[code]" />
        <Stack.Screen name="+not-found" />
      </Stack>
      {gate === 'signed-in' && <FirstRunName />}
      <WebDialogHost />
    </>
  );
}

export default function RootLayout() {
  useEffect(() => watchAppStateForAuthRefresh(), []);
  return (
    <AuthProvider>
      <HealthSyncProvider>
        <Routes />
      </HealthSyncProvider>
    </AuthProvider>
  );
}
