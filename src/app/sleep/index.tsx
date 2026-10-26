import { useCallback } from 'react';
import { Text } from 'react-native';

import { BarHistory } from '@/components/history/BarHistory';
import { Screen, styles } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { formatSleep } from '@/lib/health/format';
import { getMyRecentSleep } from '@/lib/sleep';
import { useTheme } from '@/theme';

export default function Sleep() {
  const c = useTheme();
  const { session } = useAuth();
  const me = session?.user.id ?? '';
  const fetchSleep = useCallback((days: number) => getMyRecentSleep(me, days), [me]);
  return (
    <Screen title="My Sleep" back>
      <BarHistory fetch={fetchSleep} fmt={formatSleep} noun="sleep" />
      <Text style={[styles.caption, { color: c.inkSoft }]}>Time asleep, counted on the day you woke up. Only you can see this.</Text>
    </Screen>
  );
}
