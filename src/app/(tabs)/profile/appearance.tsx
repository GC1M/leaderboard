import { Text } from 'react-native';
import { Segmented } from '@/components/history/Segmented';
import { Screen, styles } from '@/components/ui';
import { useAppearance } from '@/lib/appearance';
import { useTheme } from '@/theme';
export default function AppearanceScreen() {
  const c = useTheme();
  const [choice, setChoice] = useAppearance();
  return <Screen title="Appearance" back>
    <Segmented label="Appearance" options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }] as const} value={choice} onChange={setChoice} />
    <Text style={[styles.body, { color: c.inkSoft }]}>System is the default and follows your phone&apos;s Light or Dark setting. Light or Dark keeps this app that way whatever the phone uses. Saved on this device.</Text>
  </Screen>;
}
