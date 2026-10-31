import { Text } from 'react-native';
import { Segmented } from '@/components/history/Segmented';
import { Screen, styles } from '@/components/ui';
import { useWeightUnit } from '@/lib/weight-unit';
import { useDistanceUnit } from '@/lib/distance-unit';
import { useTheme } from '@/theme';
export default function Preferences() {
  const c = useTheme();
  const [weight, setWeight] = useWeightUnit();
  const [distance, setDistance] = useDistanceUnit();
  return <Screen title="Units" back>
    <Text style={[styles.heading, { color: c.ink }]}>Weight and lifting load</Text>
    <Segmented label="Default weight unit" options={[{ value: 'kg', label: 'Kilograms (kg)' }, { value: 'lb', label: 'Pounds (lb)' }] as const} value={weight} onChange={setWeight} />
    <Text style={[styles.heading, { color: c.ink }]}>Distance</Text>
    <Segmented label="Default distance unit" options={[{ value: 'km', label: 'Kilometers (km)' }, { value: 'mi', label: 'Miles (mi)' }] as const} value={distance} onChange={setDistance} />
    <Text style={[styles.body, { color: c.inkSoft }]}>Defaults for new entries and history. Changing units inside an entry applies only to that entry. Existing drafts keep their units.</Text>
  </Screen>;
}
