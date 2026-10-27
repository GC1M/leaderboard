import { useRouter } from 'expo-router';
import { Text } from 'react-native';

import { Button, Screen, styles } from '@/components/ui';
import { useTheme } from '@/theme';

export default function NotFound() {
  const c = useTheme();
  const router = useRouter();
  return (
    <Screen title="Page Not Found">
      <Text style={[styles.body, { color: c.inkSoft }]}>This link doesn&apos;t lead to a page in Leaderboard.</Text>
      <Button label="Go Home" onPress={() => router.replace('/')} />
    </Screen>
  );
}
