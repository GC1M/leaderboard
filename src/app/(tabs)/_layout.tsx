import { Tabs } from 'expo-router/js-tabs';

import { GlassTabBar } from '@/components/GlassTabBar';
import { useTheme } from '@/theme';

// Four tabs plus the Log button, drawn by GlassTabBar on every platform. Workouts live under Summary, so they are
// reached from its Workouts row and from the Log sheet.
export default function TabsLayout() {
  const { bg } = useTheme();
  return (
    <Tabs tabBar={(props) => <GlassTabBar {...props} />} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: bg }, tabBarHideOnKeyboard: true }}>
      <Tabs.Screen name="(summary)" options={{ title: 'Summary' }} />
      <Tabs.Screen name="compete" options={{ title: 'Compete' }} />
      {/* "Social": the tab now holds friends and chats as well as groups. The route keeps its name so links still work. */}
      <Tabs.Screen name="groups" options={{ title: 'Social' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
    </Tabs>
  );
}
