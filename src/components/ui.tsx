import { useRouter, useSegments } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { type ReactElement, type ReactNode, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  type ColorValue,
  type RefreshControlProps,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/theme';

export function Screen({
  title,
  back,
  refreshControl,
  children,
}: {
  title: string;
  back?: boolean;
  refreshControl?: ReactElement<RefreshControlProps>;
  children: ReactNode;
}) {
  const c = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const segments = useSegments();
  // On web the tab bar floats over the top of tab screens (fixed, 24px down, 40px tall), so leave room for it.
  const top = insets.top + (Platform.OS === 'web' && segments[0] === '(tabs)' ? 64 : 0);
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: c.bg, paddingTop: top, paddingBottom: insets.bottom }}
    >
      {back && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          style={styles.back}
        >
          <Icon name={{ ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' }} color={c.accent} size={20} />
          <Text style={[styles.body, { color: c.accent }]}>Back</Text>
        </Pressable>
      )}
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={refreshControl}
      >
        <Text accessibilityRole="header" style={[styles.title, { color: c.ink }]}>
          {title}
        </Text>
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// `secondary` is an outline button, `plain` is a text link (still 44pt tall), `danger` colors a plain link red.
export function Button({
  label,
  onPress,
  secondary,
  plain,
  danger,
  busy,
  disabled,
}: {
  label: string;
  onPress: () => void;
  secondary?: boolean;
  plain?: boolean;
  danger?: boolean;
  busy?: boolean;
  disabled?: boolean;
}) {
  const c = useTheme();
  const off = disabled || busy;
  const fg = danger ? c.danger : plain ? c.accent : secondary ? c.ink : c.onAccent;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        plain ? styles.link : styles.button,
        !plain && (secondary ? { borderWidth: 2, borderColor: c.border } : { backgroundColor: c.accent }),
        { opacity: off ? 0.5 : pressed ? 0.7 : 1 },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={[styles.bodyStrong, { color: fg }]}>{label}</Text>
      )}
    </Pressable>
  );
}

// Visible label above the input (placeholders vanish), helper or error below, accent border on focus.
export function Field({
  label,
  helper,
  error,
  code,
  ...input
}: TextInputProps & { label: string; helper?: string; error?: string | null; code?: boolean }) {
  const c = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: 8 }}>
      <Text style={[styles.bodyStrong, { color: c.ink }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={c.inkSoft}
        {...input}
        onFocus={(e) => {
          setFocused(true);
          input.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          input.onBlur?.(e);
        }}
        style={[
          code ? styles.code : styles.body,
          styles.input,
          {
            color: c.ink,
            backgroundColor: c.surface,
            borderColor: error ? c.danger : focused ? c.accent : c.border,
            borderWidth: focused || error ? 2 : 1,
            padding: focused || error ? 11 : 12,
          },
        ]}
      />
      {error ? <ErrorText>{error}</ErrorText> : helper ? <Text style={[styles.caption, { color: c.inkSoft }]}>{helper}</Text> : null}
    </View>
  );
}

// Flat placeholder rows while a list loads. No shimmer.
export function Skeleton({ label, rows = 3 }: { label: string; rows?: number }) {
  const c = useTheme();
  return (
    <View accessible accessibilityLabel={label} accessibilityRole="progressbar" style={{ gap: 12 }}>
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={[styles.skeleton, { backgroundColor: c.lane }]} />
      ))}
    </View>
  );
}

// SF Symbol on iOS, Material Symbol on Android and web. Decorative unless a label is given.
export function Icon({ name, color, size = 17, label }: { name: SymbolViewProps['name']; color: ColorValue; size?: number; label?: string }) {
  return (
    <SymbolView
      name={name}
      tintColor={color}
      size={size}
      accessible={!!label}
      accessibilityLabel={label}
      importantForAccessibility={label ? 'yes' : 'no-hide-descendants'}
      style={{ width: size, height: size }}
    />
  );
}

// iOS grouped inset list: an optional header and footer around rounded rows on the surface color.
export function Section({ title, footer, children }: { title?: string; footer?: string; children: ReactNode }) {
  const c = useTheme();
  return (
    <View style={{ gap: 6 }}>
      {title && <Text style={[styles.caption, styles.sectionText, { color: c.inkSoft }]}>{title}</Text>}
      <View style={[styles.section, { backgroundColor: c.surface }]}>{children}</View>
      {footer && <Text style={[styles.caption, styles.sectionText, { color: c.inkSoft }]}>{footer}</Text>}
    </View>
  );
}

// One row in a Section. Tappable rows get a chevron unless they act in place (`danger`, `action`).
export function Row({
  label,
  value,
  icon,
  onPress,
  danger,
  action,
  last,
  disabled,
}: {
  label: string;
  value?: string;
  icon?: SymbolViewProps['name'];
  onPress?: () => void;
  danger?: boolean;
  action?: boolean;
  last?: boolean;
  disabled?: boolean;
}) {
  const c = useTheme();
  const color = danger ? c.danger : action ? c.accent : c.ink;
  return (
    <Pressable
      disabled={!onPress || disabled}
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={value ? `${label}, ${value}` : label}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [styles.row, { opacity: disabled ? 0.5 : pressed ? 0.6 : 1 }]}
    >
      {icon && <Icon name={icon} color={danger ? c.danger : c.accent} size={20} />}
      <View style={[styles.rowBody, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line }]}>
        <Text numberOfLines={1} style={[styles.body, { color, flexShrink: 1 }]}>
          {label}
        </Text>
        <View style={styles.rowEnd}>
          {value ? (
            <Text numberOfLines={1} style={[styles.body, { color: c.inkSoft }]}>
              {value}
            </Text>
          ) : null}
          {onPress && !danger && !action && (
            <Icon name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} color={c.inkSoft} size={14} />
          )}
        </View>
      </View>
    </Pressable>
  );
}

export function ErrorText({ children }: { children?: string | null }) {
  const c = useTheme();
  if (!children) return null;
  return (
    <Text accessibilityLiveRegion="polite" style={[styles.caption, { color: c.danger }]}>
      {children}
    </Text>
  );
}

export const styles = StyleSheet.create({
  back: { minHeight: 44, minWidth: 44, flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingHorizontal: 12 },
  content: { flexGrow: 1, padding: 16, gap: 16 },
  // Apple's text styles: large title, title 3, body, headline, footnote.
  title: { fontSize: 34, lineHeight: 41, fontWeight: '700' },
  heading: { fontSize: 20, lineHeight: 25, fontWeight: '600' },
  body: { fontSize: 17, lineHeight: 22 },
  bodyStrong: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '500' },
  button: { minHeight: 50, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  link: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  input: { minHeight: 48, borderRadius: 10 },
  section: { borderRadius: 10, overflow: 'hidden' },
  sectionText: { paddingHorizontal: 16 },
  row: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 16 },
  rowBody: { flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingRight: 16, paddingVertical: 11 },
  rowEnd: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  skeleton: { height: 64, borderRadius: 8, opacity: 0.6 },
  code: { fontSize: 28, lineHeight: 34, fontWeight: '700', letterSpacing: 4, fontVariant: ['tabular-nums'] },
});
