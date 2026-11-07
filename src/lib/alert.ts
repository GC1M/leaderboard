import { Alert, Platform, type AlertButton } from 'react-native';

export type WebDialog = { title: string; message?: string; buttons: AlertButton[] };
let dialogs: WebDialog[] = [];
const listeners = new Set<() => void>();
export const getWebDialog = () => dialogs[0] ?? null;
export const subscribeWebDialog = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
const emit = () => listeners.forEach((listener) => listener());

// Remove before invoking an action: a confirmation opened by that action becomes the next dialog.
export function closeWebDialog(button?: AlertButton) {
  if (!dialogs.length) return;
  dialogs = dialogs.slice(1);
  emit();
  // Dismissing via Cancel, Escape or the backdrop never runs a destructive callback.
  if (button?.style !== 'cancel') button?.onPress?.();
}

export function alert(title: string, message?: string, buttons: AlertButton[] = []) {
  if (Platform.OS !== 'web') return Alert.alert(title, message, buttons);
  dialogs = [...dialogs, { title, message, buttons: buttons.length ? buttons : [{ text: 'OK' }] }];
  emit();
}
