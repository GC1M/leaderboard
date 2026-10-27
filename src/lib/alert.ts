import { Alert, Platform, type AlertButton } from 'react-native';

// Alert.alert does nothing in react-native-web, so on web each action is offered in turn with
// window.confirm and the first one accepted runs. Native keeps the system alert.
export function alert(title: string, message?: string, buttons: AlertButton[] = []) {
  if (Platform.OS !== 'web') return Alert.alert(title, message, buttons);
  const actions = buttons.filter((b) => b.style !== 'cancel');
  if (actions.length === 0) return window.alert([title, message].filter(Boolean).join('\n\n'));
  const choice = actions.find((b) =>
    window.confirm([title, message, actions.length > 1 ? `${b.text}?` : undefined].filter(Boolean).join('\n\n')),
  );
  choice?.onPress?.();
}
