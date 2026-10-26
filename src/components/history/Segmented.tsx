import { Pressable, StyleSheet, Text, View } from 'react-native';

import { styles as ui } from '@/components/ui';
import { useTheme } from '@/theme';

// Small segmented control: 7/30/90 days, kg/lb.
export function Segmented<T extends string | number>({ options, value, onChange, label }: {
  options: readonly { value: T; label: string; a11y?: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  const c = useTheme();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={[styles.row, { backgroundColor: c.lane }]}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityLabel={o.a11y ?? o.label}
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            style={[styles.option, on && { backgroundColor: c.surface }]}
          >
            <Text style={[ui.bodyStrong, { color: on ? c.accent : c.ink }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', borderRadius: 10, padding: 2 },
  option: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
});
