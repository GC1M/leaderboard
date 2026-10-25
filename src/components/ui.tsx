import { useRouter } from 'expo-router';
import { type ReactElement, type ReactNode, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
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
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      {back && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          style={styles.back}
        >
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

// `secondary` is an outline button, `plain` is a text link (still 44pt tall).
export function Button({
  label,
  onPress,
  secondary,
  plain,
  busy,
  disabled,
}: {
  label: string;
  onPress: () => void;
  secondary?: boolean;
  plain?: boolean;
  busy?: boolean;
  disabled?: boolean;
}) {
  const c = useTheme();
  const off = disabled || busy;
  const fg = plain ? c.accent : secondary ? c.ink : c.onAccent;
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
  back: { minHeight: 44, minWidth: 44, justifyContent: 'center', paddingHorizontal: 16 },
  content: { flexGrow: 1, padding: 16, gap: 16 },
  title: { fontSize: 30, lineHeight: 36, fontWeight: '800' },
  heading: { fontSize: 20, lineHeight: 26, fontWeight: '700' },
  body: { fontSize: 16, lineHeight: 24 },
  bodyStrong: { fontSize: 16, lineHeight: 24, fontWeight: '600' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '500' },
  button: { minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  link: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  input: { minHeight: 48, borderRadius: 8 },
  skeleton: { height: 64, borderRadius: 8, opacity: 0.6 },
  code: { fontSize: 28, lineHeight: 34, fontWeight: '700', letterSpacing: 4, fontVariant: ['tabular-nums'] },
});
