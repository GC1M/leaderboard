import { useSyncExternalStore } from 'react';
import { Appearance, Platform } from 'react-native';

import { secureStorage } from '@/lib/secure-storage';

export type AppearanceChoice = 'system' | 'light' | 'dark';
const KEY = 'appearance';
let choice: AppearanceChoice = 'system';
const listeners = new Set<() => void>();

// Native views (tab bar, alerts, iOS dynamic colors) follow the override too; web reads the choice in useTheme.
function apply(next: AppearanceChoice) {
  choice = next;
  if (Platform.OS !== 'web') Appearance.setColorScheme(next === 'system' ? 'unspecified' : next);
  listeners.forEach((l) => l());
}

export async function loadAppearance(): Promise<AppearanceChoice> {
  try {
    const v = await secureStorage.getItem(KEY);
    if (v === 'light' || v === 'dark' || v === 'system') apply(v);
  } catch {
    // Unreadable storage keeps following the phone.
  }
  return choice;
}

export async function saveAppearance(next: AppearanceChoice): Promise<void> {
  apply(next);
  try {
    await secureStorage.setItem(KEY, next);
  } catch {
    // Applies for this session; it just won't be remembered.
  }
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export function useAppearance(): [AppearanceChoice, (c: AppearanceChoice) => void] {
  return [useSyncExternalStore(subscribe, () => choice), (c) => void saveAppearance(c)];
}
