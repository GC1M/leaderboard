import { useRouter } from 'expo-router';
import { type BottomTabBarProps, BottomTabBarHeightCallbackContext } from 'expo-router/js-tabs';
import type { SymbolViewProps } from 'expo-symbols';
import { useContext } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, styles as ui } from '@/components/ui';
import { useTheme } from '@/theme';

// Apple Health style bottom menu: four tabs in a floating glass capsule, and a round Log button standing apart
// beside it. It floats over the content, so screens pad their bottom by the height reported here.
const icons: Record<string, { off: SymbolViewProps['name']; on: SymbolViewProps['name'] }> = {
  '(summary)': { off: { ios: 'figure.walk', android: 'directions_walk', web: 'directions_walk' }, on: { ios: 'figure.walk', android: 'directions_walk', web: 'directions_walk' } },
  compete: { off: { ios: 'trophy', android: 'emoji_events', web: 'emoji_events' }, on: { ios: 'trophy.fill', android: 'emoji_events', web: 'emoji_events' } },
  groups: { off: { ios: 'person.3', android: 'groups', web: 'groups' }, on: { ios: 'person.3.fill', android: 'groups', web: 'groups' } },
  profile: { off: { ios: 'person.crop.circle', android: 'account_circle', web: 'account_circle' }, on: { ios: 'person.crop.circle.fill', android: 'account_circle', web: 'account_circle' } },
};
const BAR = 62;
const GAP = 12;

export function GlassTabBar({ state, descriptors, emitter, navigateToTab }: BottomTabBarProps) {
  const c = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const report = useContext(BottomTabBarHeightCallbackContext);
  const bottom = Math.max(insets.bottom, 16);
  const glass = { backgroundColor: c.glass, borderColor: c.edge, borderTopColor: c.edgeTop };
  return (
    <View
      pointerEvents="box-none"
      onLayout={(e) => report?.(e.nativeEvent.layout.height)}
      style={[styles.wrap, { paddingBottom: bottom }, Platform.OS === 'web' && ui.webWidth]}
    >
      <View style={[styles.bar, glass]} accessibilityRole="tablist">
        {state.routes.map((route, i) => {
          const on = state.index === i;
          const { options } = descriptors[route.key];
          const label = typeof options.title === 'string' ? options.title : route.name;
          const icon = icons[route.name];
          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={label}
              // Emit tabPress like the stock tab bar: the tab's stack listens for it and pops to its first screen
              // when you tap the tab you are already on.
              onPress={() => {
                const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                if (!on && !event.defaultPrevented) navigateToTab(route.key);
              }}
              style={({ pressed }) => [styles.tab, on && { backgroundColor: c.surface }, pressed && ui.pressed]}
            >
              {icon && <Icon name={on ? icon.on : icon.off} color={on ? c.accent : c.inkSoft} size={24} />}
              <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={[styles.label, { color: on ? c.accent : c.inkSoft }]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Log"
        accessibilityHint="Opens a sheet to log water, weight, a workout or a meal"
        onPress={() => router.push('/log')}
        style={({ pressed }) => [styles.log, glass, pressed && ui.pressed]}
      >
        <Icon name={{ ios: 'plus', android: 'add', web: 'add' }} color={c.accent} size={28} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'flex-end', gap: GAP, paddingHorizontal: 14, paddingTop: 12 },
  bar: { flex: 1, height: BAR, borderRadius: 999, borderWidth: 1, flexDirection: 'row', alignItems: 'center', padding: 6 },
  tab: { flex: 1, minWidth: 0, height: BAR - 12, borderRadius: 999, alignItems: 'center', justifyContent: 'center', gap: 2 },
  label: { fontSize: 10, lineHeight: 12, fontWeight: '500' },
  log: { width: BAR, height: BAR, borderRadius: 999, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
