import { useSyncExternalStore } from 'react';
import { Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { Button, styles } from '@/components/ui';
import { closeWebDialog, getWebDialog, subscribeWebDialog } from '@/lib/alert';
import { useTheme } from '@/theme';

// RN web's Modal handles focus containment/restoration and Escape. Native retains system alerts.
export function WebDialogHost() {
  const dialog = useSyncExternalStore(subscribeWebDialog, getWebDialog, () => null);
  const c = useTheme();
  if (Platform.OS !== 'web' || !dialog) return null;
  const buttons = dialog.buttons.some((b) => b.style === 'cancel') ? dialog.buttons : [...dialog.buttons, { text: 'Cancel', style: 'cancel' as const }];
  return (
    <Modal transparent visible onRequestClose={() => closeWebDialog()}>
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 16 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss dialog" onPress={() => closeWebDialog()} style={{ position: 'absolute', inset: 0, backgroundColor: c.ink, opacity: 0.4 }} />
        <View accessibilityViewIsModal accessibilityLabel={dialog.title} style={{ width: '100%', maxWidth: 420, maxHeight: '100%', padding: 24, borderRadius: 16, backgroundColor: c.surface }}>
          <ScrollView contentContainerStyle={{ gap: 16 }} keyboardShouldPersistTaps="handled">
            <Text accessibilityRole="header" style={[styles.heading, { color: c.ink }]}>{dialog.title}</Text>
            {dialog.message && <Text style={[styles.body, { color: c.inkSoft }]}>{dialog.message}</Text>}
            {buttons.map((button, i) => (
              <Button key={i} label={button.text ?? 'OK'} secondary={button.style === 'cancel'} plain={button.style === 'destructive'} danger={button.style === 'destructive'} onPress={() => closeWebDialog(button)} />
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
