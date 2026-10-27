import { Pressable, StyleSheet, Text, View } from 'react-native';

import { styles as ui, useLargeText } from '@/components/ui';
import { useTheme } from '@/theme';

// Small segmented control: 7/30/90 days, kg/lb.
export function Segmented<T extends string | number>({ options, value, onChange, label }: {
  options: readonly { value: T; label: string; a11y?: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  const c = useTheme();
  const large = useLargeText();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={[styles.row, large && styles.wrap, { backgroundColor: c.lane }]}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityLabel={o.a11y ?? o.label}
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            style={[styles.option, large ? styles.wrapOption : styles.equal, on && { backgroundColor: c.surface }]}
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
  // At accessibility sizes the labels outgrow equal parts, so options size to their text and wrap.
  wrap: { flexWrap: 'wrap' },
  // `flex: 1` forces a zero basis even with flexBasis 'auto' on top, so it's only applied at default sizes.
  wrapOption: { flexGrow: 1, flexShrink: 0, flexBasis: 'auto', paddingHorizontal: 12 },
  equal: { flex: 1 },
  option: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
});
