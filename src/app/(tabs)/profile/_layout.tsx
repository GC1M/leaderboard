import { Stack } from 'expo-router';
import { useTheme } from '@/theme';

export const unstable_settings = { initialRouteName: 'index' };

export default function SectionLayout() {
  const { bg } = useTheme();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: bg } }} />;
}
