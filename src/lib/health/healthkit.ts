import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';

import { localDateKey, startOfLocalDay } from './dates';

type HealthKit = typeof import('@kingstinct/react-native-healthkit');

const STEPS = 'HKQuantityTypeIdentifierStepCount' as const;
const UNNECESSARY = 2; // AuthorizationRequestStatus.unnecessary: the user has already been asked

// Each metric is requested separately in the Health sheet, so the user can allow any subset.
export const HEALTH_TYPES = {
  steps: STEPS,
  sleep: 'HKCategoryTypeIdentifierSleepAnalysis',
  weight: 'HKQuantityTypeIdentifierBodyMass',
} as const;
export type HealthMetric = keyof typeof HEALTH_TYPES;
const METRICS = Object.keys(HEALTH_TYPES) as HealthMetric[];

// HealthKit never reveals whether read access was granted, only whether we have asked. 'asked' means queries may still return
// nothing (access off or no data); only a query result can tell, so callers must not show it as "connected".
export type HealthAccess = 'unavailable' | 'not-asked' | 'asked';

let cached: HealthKit | null | undefined;

// The native module only exists in a dev/production iOS build. In Expo Go, on Android and on web it is absent, so load it lazily and treat any failure as "unavailable".
export function loadHealthKit(): HealthKit | null {
  if (cached !== undefined) return cached;
  cached = null;
  if (Platform.OS !== 'ios' || Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod: HealthKit = require('@kingstinct/react-native-healthkit');
    if (mod.isHealthDataAvailable()) cached = mod;
  } catch {
    cached = null;
  }
  return cached;
}

export const isHealthAvailable = () => loadHealthKit() !== null;

// Test hook so availability can be re-evaluated after mocking.
export function resetHealthKitCache() {
  cached = undefined;
}

export async function getHealthAccess(metric: HealthMetric): Promise<HealthAccess> {
  const hk = loadHealthKit();
  if (!hk) return 'unavailable';
  const status = await hk.getRequestStatusForAuthorization({ toRead: [HEALTH_TYPES[metric]] });
  return status === UNNECESSARY ? 'asked' : 'not-asked';
}

export async function getAllHealthAccess(): Promise<Record<HealthMetric, HealthAccess>> {
  const all = await Promise.all(METRICS.map(getHealthAccess));
  return Object.fromEntries(METRICS.map((m, i) => [m, all[i]])) as Record<HealthMetric, HealthAccess>;
}

// Shows the Health sheet for any metric not asked yet; iOS never shows it again for ones already asked.
// Resolves when the sheet closes, which says nothing about what the user allowed.
export async function requestHealthAccess(): Promise<void> {
  const hk = loadHealthKit();
  if (!hk) return;
  await hk.requestAuthorization({ toRead: METRICS.map((m) => HEALTH_TYPES[m]) });
}

// One cumulative-sum bucket per local calendar day. HealthKit de-duplicates overlapping sources (iPhone + Watch) inside the statistics query, so totals match the Health app.
// Days with no samples are omitted: no data is not the same claim as zero steps.
export async function readDailySteps(days: number, now: Date = new Date()): Promise<{ date: string; value: number }[]> {
  const hk = loadHealthKit();
  if (!hk) return [];
  const buckets = await hk.queryStatisticsCollectionForQuantity(STEPS, ['cumulativeSum'], startOfLocalDay(now, days - 1), { day: 1 }, {
    unit: 'count',
  });
  const out: { date: string; value: number }[] = [];
  for (const b of buckets) {
    if (b.startDate && b.sumQuantity) out.push({ date: localDateKey(new Date(b.startDate)), value: b.sumQuantity.quantity });
  }
  return out;
}
