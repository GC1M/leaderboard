import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';

import { localDateKey, startOfLocalDay } from './dates';

type HealthKit = typeof import('@kingstinct/react-native-healthkit');

const STEPS = 'HKQuantityTypeIdentifierStepCount' as const;
const SHOULD_REQUEST = 1; // AuthorizationRequestStatus.shouldRequest

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

export async function needsStepsPermission(): Promise<boolean> {
  const hk = loadHealthKit();
  if (!hk) return false;
  return (await hk.getRequestStatusForAuthorization({ toRead: [STEPS] })) === SHOULD_REQUEST;
}

export async function requestStepsPermission(): Promise<boolean> {
  const hk = loadHealthKit();
  if (!hk) return false;
  return hk.requestAuthorization({ toRead: [STEPS] });
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
