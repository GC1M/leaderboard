import type { CapabilityResult, HealthDataType, HealthPlatform, ProviderAvailability } from './types';

// What each platform's health store lets us do, and how much of it this app has wired up. Details and sources are in
// docs/android-health-capabilities.md; anything not confirmed there is listed in `unverified`, never guessed.
export type CapabilityFact = 'read' | 'write' | 'history' | 'background';
export type CapabilityEntry = {
  read: boolean; // the platform offers it
  write: boolean;
  implemented: { read: boolean; write: boolean }; // this app has an adapter path for it today
  history: { defaultDays: number | null; extendedBy: 'permission' | null }; // null days: no platform window on how far back we may read
  background: 'foreground-only' | 'permission-required' | 'available';
  unverified: CapabilityFact[];
  note?: string;
};
export type PlatformMatrix = {
  platform: HealthPlatform;
  provider: string; // name shown to users
  minimum: { os: string | null; provider: string }; // null: not confirmed
  requirements: string[];
  entries: Record<HealthDataType, CapabilityEntry>;
};

const ios = (read: boolean, write: boolean, implemented: CapabilityEntry['implemented'], unverified: CapabilityFact[], note?: string): CapabilityEntry =>
  ({ read, write, implemented, history: { defaultDays: null, extendedBy: null }, background: 'foreground-only', unverified, note });

export const IOS_MATRIX: PlatformMatrix = {
  platform: 'ios',
  provider: 'Apple Health',
  minimum: { os: null, provider: 'Built in; needs a native build, not Expo Go' },
  requirements: [
    'Native iPhone build; the module does not load in Expo Go, on Android or on web.',
    'Read access cannot be inspected: an empty result is not proof of denied access or of no data.',
    'No background delivery (background: false in app.config.ts); imports run in the foreground.',
  ],
  entries: {
    steps: ios(true, true, { read: true, write: false }, ['write'], 'Read as statistics per local day so overlapping sources are not double counted. Imports start ~90 days back by app choice.'),
    sleep: ios(true, true, { read: true, write: false }, ['write'], 'Read as asleep intervals and summarized by our own session rule. Imports start ~90 days back by app choice.'),
    weight: ios(true, true, { read: true, write: false }, [], 'Imported without a lower date bound.'),
    workouts: ios(true, true, { read: false, write: false }, ['read', 'write'], 'Not wired yet.'),
    nutrition: ios(true, true, { read: false, write: false }, ['read', 'write'], 'Not wired yet.'),
    water: ios(true, true, { read: false, write: false }, ['read', 'write'], 'Not wired yet.'),
  },
};

// Health Connect: every row below is confirmed against developer.android.com unless `unverified` says otherwise.
const android = (note?: string, unverified: CapabilityFact[] = []): CapabilityEntry => ({
  read: true, write: true, implemented: { read: false, write: false },
  history: { defaultDays: 30, extendedBy: 'permission' }, background: 'permission-required', unverified, note,
});

export const ANDROID_MATRIX: PlatformMatrix = {
  platform: 'android',
  provider: 'Health Connect',
  minimum: { os: 'Android 9 (API 28)', provider: 'Health Connect: part of Android 14+, otherwise the Health Connect app from Google Play' },
  requirements: [
    'Android 9 (API 28) or higher with Google Play services; the client SDK itself supports Android 8 but only Android 9+ can use Health Connect.',
    'Android 14 (API 34) and higher: part of the system. Android 13 and lower: the user must install and keep the Health Connect app updated.',
    'Not usable in a work profile.',
    'Each data type needs its own declared read and/or write permission, and the app must declare the types in the Play Console.',
    'Without the history permission, reads reach back 30 days before the first grant; an older request is an error.',
    'Apps cannot be notified of new data: poll on foreground and while foregrounded, or use the changes token (it expires after 30 days unused).',
  ],
  entries: {
    steps: android('Use aggregation, not raw reads, to avoid double counting. Built-in step counting needs Android 14 with SDK extension 20.'),
    sleep: android('One session record with optional stages; normalize with the shared sleep rule.'),
    weight: android(),
    workouts: android('Exercise sessions; routes need a separate permission.'),
    nutrition: android('Nutrition and hydration are separate record types.'),
    water: android('Hydration record.'),
  },
};

export const CAPABILITY_MATRICES: Record<HealthPlatform, PlatformMatrix> = { ios: IOS_MATRIX, android: ANDROID_MATRIX };

// Combines the static matrix with what this device reports right now. Order matters: a device that cannot run the
// provider says so before we talk about individual data types.
export function resolveCapability(matrix: PlatformMatrix, availability: ProviderAvailability, type: HealthDataType, access: 'read' | 'write'): CapabilityResult {
  if (availability.status !== 'available') return availability;
  const entry = matrix.entries[type];
  if (!entry[access]) return { status: 'unsupported', reason: 'platform' };
  if (!entry.implemented[access]) return { status: 'unsupported', reason: 'not-implemented' };
  return { status: 'supported' };
}

// Plain wording for a missing capability. Returns null when nothing is missing, so callers can render it as-is.
export function describeCapability(result: CapabilityResult, matrix: PlatformMatrix, type: HealthDataType): string | null {
  if (result.status === 'supported') return null;
  const { provider } = matrix;
  switch (result.reason) {
    case 'platform': return `${provider} doesn't support ${type} on this device.`;
    case 'os-version': return `${provider} needs ${matrix.minimum.os ?? 'a newer OS version'} or newer.`;
    case 'work-profile': return `${provider} can't be used in a work profile.`;
    case 'not-implemented': return `${provider} ${type} isn't available in this version of the app yet.`;
    case 'provider-missing': return `Install ${provider} to use ${type}.`;
    case 'provider-update-required': return `Update ${provider} to use ${type}.`;
    case 'native-build-required': return `${provider} needs the full app build; it isn't available in Expo Go.`;
  }
}
