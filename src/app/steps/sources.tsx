import { Text, View } from 'react-native';

import { Screen, styles } from '@/components/ui';
import { useTheme } from '@/theme';

// We only read Apple Health, so any tracker that writes steps there works. Menu names change between app versions,
// so the steps stay general instead of exact paths.
const SOURCES = [
  { name: 'Apple Watch', how: 'Nothing to do. Watch steps go to Apple Health on their own, and we count them once even when your iPhone also counted.' },
  { name: 'Garmin', how: 'In the Garmin Connect app, open Connected Apps, choose Apple Health and turn on Steps.' },
  { name: 'Oura', how: 'In the Oura app, open Settings, choose Apple Health and allow Steps.' },
  { name: 'Withings', how: 'In the Withings app, open your profile, choose Apple Health and turn on Steps.' },
  { name: 'Other apps', how: 'Look for "Apple Health" or "Health" in the app\'s settings and allow it to write Steps.' },
  { name: 'Fitbit', how: "Fitbit doesn't send steps to Apple Health, so it can't connect yet. Enter your steps manually for now." },
];

export default function Sources() {
  const c = useTheme();
  return (
    <Screen title="Connect a Watch or Tracker" back>
      <Text style={[styles.body, { color: c.inkSoft }]}>
        Leaderboard reads steps from Apple Health. Let your tracker&apos;s app write steps to Apple Health, then pull down on My Steps to sync.
      </Text>
      {SOURCES.map((s) => (
        <View key={s.name} accessible style={{ gap: 4, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.line }}>
          <Text style={[styles.bodyStrong, { color: c.ink }]}>{s.name}</Text>
          <Text style={[styles.body, { color: c.inkSoft }]}>{s.how}</Text>
        </View>
      ))}
      <Text style={[styles.caption, { color: c.inkSoft }]}>
        Using two trackers? In the Health app, open Steps, then Data Sources &amp; Access, and drag the one you trust most to the top.
      </Text>
    </Screen>
  );
}
