import { useRouter, useSegments } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { type ReactElement, type ReactNode, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  InputAccessoryView,
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
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/theme';

export function Screen({
  title,
  back,
  refreshControl,
  children,
  onBack,
  backLabel = 'Back',
  headerActions,
  aboveTitle,
}: {
  title: string;
  aboveTitle?: ReactNode;
  back?: boolean;
  onBack?: () => void;
  backLabel?: string;
  headerActions?: ReactNode;
  refreshControl?: ReactElement<RefreshControlProps>;
  children: ReactNode;
}) {
  const c = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const segments: readonly string[] = useSegments();
  const top = insets.top;
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: c.bg, paddingTop: top, paddingBottom: insets.bottom }}
    >
      {back && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={backLabel}
          onPress={onBack ?? (() => (router.canGoBack() ? router.back() : router.replace(segments.includes('workouts') ? '/workouts' : segments.includes('groups') ? '/groups' : segments.includes('profile') ? '/profile' : '/')))}
          style={[styles.back, Platform.OS === 'web' && styles.webWidth]}
        >
          <Icon name={{ ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' }} color={c.accent} size={20} />
          <Text style={[styles.body, { color: c.accent }]}>{backLabel}</Text>
        </Pressable>
      )}
      {headerActions && <View style={{ paddingHorizontal: 16 }}>{headerActions}</View>}
      {/* Number pads have no return key, so dragging the list dismisses the keyboard. "automatic" lets iOS
          inset the content for the native tab bar (React Native defaults to "never"). The content must not
          flexGrow to fill the frame, or that inset makes even short screens scroll. */}
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(32, insets.bottom + 24) }, Platform.OS === 'web' && styles.webWidth]}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        keyboardShouldPersistTaps="handled"
        refreshControl={refreshControl}
      >
        {aboveTitle}
        {/* Capped so one long word like "Leaderboard" still fits a line at the largest text sizes instead of breaking mid-word. */}
        <Text accessibilityRole="header" maxFontSizeMultiplier={1.5} style={[styles.title, { color: c.ink }]}>
          {title}
        </Text>
        {children}
      </ScrollView>
      {Platform.OS === 'ios' && <InputAccessoryView nativeID="numeric-done"><View style={{ backgroundColor: c.surface, alignItems: 'flex-end', paddingHorizontal: 16 }}><Button plain label="Done" onPress={Keyboard.dismiss} /></View></InputAccessoryView>}
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
}: TextInputProps & { label: string; helper?: string; error?: string | null; code?: boolean | number }) {
  const c = useTheme();
  const [focused, setFocused] = useState(false);
  const field = (
    <TextInput
      accessibilityLabel={label}
      // The code input's text is transparent over the boxes, so its placeholder must be too.
      placeholderTextColor={code ? 'transparent' : c.inkSoft}
      caretHidden={!!code}
      {...input}
      inputAccessoryViewID={input.inputAccessoryViewID ?? (input.keyboardType === 'decimal-pad' || input.keyboardType === 'number-pad' ? 'numeric-done' : undefined)}
      onFocus={(e) => {
        setFocused(true);
        input.onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        input.onBlur?.(e);
      }}
      style={[
        styles.body,
        styles.input,
        {
          color: c.ink,
          backgroundColor: c.surface,
          borderColor: error ? c.danger : focused ? c.accent : c.border,
          borderWidth: focused || error ? 2 : 1,
          padding: focused || error ? 11 : 12,
        },
        !!code && styles.codeInput,
      ]}
    />
  );
  // `code` alone is the 6-digit sign-in code; a number sets the box count without a maxLength that would cut a paste.
  const length = typeof code === 'number' ? code : 6;
  const value = input.value ?? '';
  return (
    <View style={{ gap: 8 }}>
      <Text style={[styles.bodyStrong, { color: c.ink }]}>{label}</Text>
      {code ? (
        // One box per digit, drawn from a single invisible input on top so paste, OTP autofill and screen readers still work.
        <View>
          <View style={styles.codeRow} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {Array.from({ length }, (_, i) => {
              const active = focused && i === Math.min(value.length, length - 1);
              return (
                <View
                  key={i}
                  style={[
                    styles.input,
                    styles.codeBox,
                    {
                      backgroundColor: c.surface,
                      borderColor: error ? c.danger : active ? c.accent : c.border,
                      borderWidth: active || error ? 2 : 1,
                    },
                  ]}
                >
                  <Text maxFontSizeMultiplier={1.5} style={[styles.code, { color: c.ink, letterSpacing: 0 }]}>{value[i] ?? ''}</Text>
                </View>
              );
            })}
          </View>
          {field}
        </View>
      ) : (
        field
      )}
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

// iOS accessibility text sizes (AX1 and up) start around 1.6x; below that the default layouts still fit.
export function useLargeText() {
  return useWindowDimensions().fontScale >= 1.5;
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
  wrap,
}: {
  label: string;
  value?: string;
  wrap?: boolean;
  icon?: SymbolViewProps['name'];
  onPress?: () => void;
  danger?: boolean;
  action?: boolean;
  last?: boolean;
  disabled?: boolean;
}) {
  const c = useTheme();
  const color = danger ? c.danger : action ? c.accent : c.ink;
  // At accessibility sizes the label wraps and the value stacks under it instead of both truncating.
  const largeText = useLargeText();
  const large = largeText || wrap;
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
      <View style={[styles.rowBody, large && styles.rowStacked, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line }]}>
        <Text numberOfLines={large ? undefined : 1} style={[styles.body, { color, flexShrink: 1 }]}>
          {label}
        </Text>
        <View style={styles.rowEnd}>
          {value ? (
            <Text numberOfLines={large ? undefined : 1} style={[styles.body, { color: c.inkSoft }, large && { flexShrink: 1 }]}>
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
  webWidth: { width: '100%', maxWidth: 640, alignSelf: 'center' },
  content: { padding: 16, gap: 16 },
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
  rowStacked: { flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center' },
  rowEnd: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  skeleton: { height: 64, borderRadius: 8, opacity: 0.6 },
  code: { fontSize: 28, lineHeight: 34, fontWeight: '700', letterSpacing: 4, fontVariant: ['tabular-nums'] },
  codeRow: { flexDirection: 'row', gap: 8 },
  codeBox: { flex: 1, maxWidth: 56, aspectRatio: 0.85, alignItems: 'center', justifyContent: 'center' },
  // Transparent colors, not opacity 0: iOS drops near-invisible views from VoiceOver and hit testing.
  codeInput: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, color: 'transparent', backgroundColor: 'transparent', borderColor: 'transparent' },
});
