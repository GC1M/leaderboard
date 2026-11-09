import { Tabs } from 'expo-router/js-tabs';
import { Icon } from '@/components/ui';
import { useTheme } from '@/theme';
// Web uses a bottom tab bar as well. NativeTabs' web implementation floats at the top.
export default function WebTabsLayout() {
  const c = useTheme();
  return <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: c.accent, tabBarInactiveTintColor: c.inkSoft, tabBarStyle: { backgroundColor: c.surface, minHeight: 64 }, tabBarLabelStyle: { fontSize: 13 }, tabBarHideOnKeyboard: true }}>
    <Tabs.Screen name="(summary)" options={{ title: 'Summary', tabBarIcon: ({ color }) => <Icon name={{ web: 'directions_walk' }} color={color} size={22} /> }} />
    <Tabs.Screen name="workouts" options={{ title: 'Workouts', tabBarIcon: ({ color }) => <Icon name={{ web: 'fitness_center' }} color={color} size={22} /> }} />
    <Tabs.Screen name="compete" options={{ title: 'Compete', tabBarIcon: ({ color }) => <Icon name={{ web: 'emoji_events' }} color={color} size={22} /> }} />
    <Tabs.Screen name="groups" options={{ title: 'Groups', tabBarIcon: ({ color }) => <Icon name={{ web: 'groups' }} color={color} size={22} /> }} />
    <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: ({ color }) => <Icon name={{ web: 'account_circle' }} color={color} size={22} /> }} />
  </Tabs>;
}
