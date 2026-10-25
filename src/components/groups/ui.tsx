import { useRouter } from 'expo-router';
import type { ReactElement, ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  type RefreshControlProps,
  ScrollView,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Tokens from the PLAN.md design section. A shared theme.ts replaces this later.
const light = { bg: '#F3F5F8', surface: '#FFFFFF', ink: '#0D1424', inkSoft: '#4A5568', border: '#8A94A6', accent: '#2340D8', onAccent: '#FFFFFF', danger: '#B42318', line: '#DDE2EA' };
const dark = { bg: '#0B1020', surface: '#151C30', ink: '#EEF1F7', inkSoft: '#A3AEC2', border: '#6B7691', accent: '#8FA3FF', onAccent: '#0B1020', danger: '#FF8A80', line: '#26304A' };

export function useColors() {
  return useColorScheme() === 'dark' ? dark : light;
}

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
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top, paddingBottom: insets.bottom }}>
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
    </View>
  );
}

export function Button({
  label,
  onPress,
  secondary,
  busy,
  disabled,
}: {
  label: string;
  onPress: () => void;
  secondary?: boolean;
  busy?: boolean;
  disabled?: boolean;
}) {
  const c = useColors();
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        secondary ? { borderWidth: 2, borderColor: c.border } : { backgroundColor: c.accent },
        { opacity: off ? 0.5 : pressed ? 0.7 : 1 },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={secondary ? c.ink : c.onAccent} />
      ) : (
        <Text style={[styles.bodyStrong, { color: secondary ? c.ink : c.onAccent }]}>{label}</Text>
      )}
    </Pressable>
  );
}

export function ErrorText({ children }: { children?: string | null }) {
  const c = useColors();
  if (!children) return null;
  return (
    <Text accessibilityLiveRegion="polite" style={[styles.caption, { color: c.danger }]}>
      {children}
    </Text>
  );
}

export const styles = StyleSheet.create({
  back: { minHeight: 44, minWidth: 44, justifyContent: 'center', paddingHorizontal: 16 },
  content: { padding: 16, gap: 16 },
  title: { fontSize: 30, lineHeight: 36, fontWeight: '800' },
  heading: { fontSize: 20, lineHeight: 26, fontWeight: '700' },
  body: { fontSize: 16, lineHeight: 24 },
  bodyStrong: { fontSize: 16, lineHeight: 24, fontWeight: '600' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '500' },
  button: { minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  code: { fontSize: 28, lineHeight: 34, fontWeight: '700', letterSpacing: 4, fontVariant: ['tabular-nums'] },
});
