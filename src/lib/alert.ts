import { Alert, Platform, type AlertButton } from 'react-native';

// Alert.alert does nothing in react-native-web. On web a single action is a window.confirm, and several
// actions are a numbered window.prompt. Declining runs nothing. Native keeps the system alert.
export function alert(title: string, message?: string, buttons: AlertButton[] = []) {
  if (Platform.OS !== 'web') return Alert.alert(title, message, buttons);
  const actions = buttons.filter((b) => b.style !== 'cancel');
  const text = [title, message].filter(Boolean).join('\n\n');
  if (actions.length === 0) return window.alert(text);
  if (actions.length === 1) return window.confirm(text) ? actions[0].onPress?.() : undefined;
  const list = actions.map((b, i) => `${i + 1}. ${b.text}`).join('\n');
  const n = Number(window.prompt(`${text}\n\nEnter a number:\n${list}`)?.trim());
  actions[n - 1]?.onPress?.();
}
