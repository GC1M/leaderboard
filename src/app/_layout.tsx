import { Stack } from 'expo-router';
import { useEffect } from 'react';

import { watchAppStateForAuthRefresh } from '@/lib/supabase';

export default function RootLayout() {
  useEffect(() => watchAppStateForAuthRefresh(), []);
  return <Stack />;
}
