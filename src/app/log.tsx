import { type Href, useRouter } from 'expo-router';
import { useState } from 'react';
import { AccessibilityInfo, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ErrorText, Icon, Row, Section, styles as ui } from '@/components/ui';
import { logWater } from '@/lib/water/entries';
import { formatWater, mlFromUnit, useWaterUnit } from '@/lib/water/units';
import { useTheme } from '@/theme';

// The Log sheet behind the round button beside the tab bar. Water logs right here with one tap on a preset; the
// other three open their existing screens.
// Presets in the unit you chose: a glass, a bottle, a big bottle.
const PRESETS = { ml: [250, 500, 750], floz: [8, 12, 16] } as const;

export default function LogSheet() {
  const c = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [unit] = useWaterUnit();
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const water = async (ml: number) => {
    setBusy(ml);
    setError(null);
    try {
      await logWater(ml);
      AccessibilityInfo.announceForAccessibility(`Logged ${formatWater(ml, unit)}`);
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't log water. Try again.");
    } finally {
      setBusy(null);
    }
  };
  // Close the sheet, then open the screen in the tabs behind it.
  const open = (href: Href) => {
    router.back();
    router.push(href, { withAnchor: true });
  };

  return (
    <View style={[styles.sheet, { backgroundColor: c.bg, paddingBottom: insets.bottom + 16 }]}>
      <Text accessibilityRole="header" style={[ui.heading, { color: c.ink }]}>Log</Text>
      <Section>
        <View style={[styles.water, { borderBottomColor: c.line }]}>
          <Icon name={{ ios: 'drop.fill', android: 'water_drop', web: 'water_drop' }} color={c.accent} size={20} />
          <Text style={[ui.body, { color: c.ink, flex: 1, minWidth: 56 }]}>Water</Text>
          <View style={styles.presets}>
            {PRESETS[unit].map((amount) => mlFromUnit(amount, unit)).map((ml) => (
              <Pressable
                key={ml}
                accessibilityRole="button"
                accessibilityLabel={`Log ${formatWater(ml, unit)} of water`}
                accessibilityState={{ busy: busy === ml, disabled: busy !== null }}
                disabled={busy !== null}
                onPress={() => void water(ml)}
                style={({ pressed }) => [styles.preset, { backgroundColor: c.youTint, opacity: busy !== null && busy !== ml ? 0.5 : 1 }, pressed && ui.pressed]}
              >
                <Text style={[styles.presetText, { color: c.accent }]}>{formatWater(ml, unit)}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        <Row label="Weigh in" icon={{ ios: 'scalemass.fill', android: 'monitor_weight', web: 'monitor_weight' }} onPress={() => open('/weight')} />
        <Row label="Workout" icon={{ ios: 'dumbbell.fill', android: 'fitness_center', web: 'fitness_center' }} onPress={() => open('/workouts/new')} />
        <Row label="Meal" icon={{ ios: 'fork.knife', android: 'restaurant', web: 'restaurant' }} last onPress={() => open('/food')} />
      </Section>
      <ErrorText>{error}</ErrorText>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, padding: 16, paddingTop: Platform.OS === 'ios' ? 20 : 16, gap: 12 },
  water: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  presets: { flexDirection: 'row', gap: 6, flexShrink: 1 },
  preset: { minHeight: 40, minWidth: 48, paddingHorizontal: 10, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  presetText: { fontSize: 14, lineHeight: 18, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
