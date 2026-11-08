import { Platform } from 'react-native';
import { NativeTabs } from 'expo-router/native-tabs';

import { useTheme } from '@/theme';

// System tab bar (UITabBar on iOS, Material bar on Android) with SF Symbols and Material icons.
export default function TabsLayout() {
  const { accent, surface, inkSoft, youTint } = useTheme();
  return (
    <NativeTabs tintColor={accent} {...(Platform.OS === 'web' ? { backgroundColor: surface, indicatorColor: youTint, labelStyle: { default: { color: inkSoft }, selected: { color: accent } } } : {})}>
      <NativeTabs.Trigger name="(summary)">
        <NativeTabs.Trigger.Icon sf={{ default: 'figure.walk', selected: 'figure.walk' }} md="directions_walk" />
        <NativeTabs.Trigger.Label>Summary</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="workouts">
        <NativeTabs.Trigger.Icon sf="dumbbell" md="fitness_center" />
        <NativeTabs.Trigger.Label>Workouts</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="compete">
        <NativeTabs.Trigger.Icon sf={{ default: 'trophy', selected: 'trophy.fill' }} md="emoji_events" />
        <NativeTabs.Trigger.Label>Compete</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="groups">
        <NativeTabs.Trigger.Icon sf={{ default: 'person.3', selected: 'person.3.fill' }} md="groups" />
        <NativeTabs.Trigger.Label>Groups</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="profile">
        <NativeTabs.Trigger.Icon sf={{ default: 'person.crop.circle', selected: 'person.crop.circle.fill' }} md="account_circle" />
        <NativeTabs.Trigger.Label>Profile</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
