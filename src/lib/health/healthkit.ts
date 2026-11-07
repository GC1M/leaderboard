import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';

import { localDateKey, startOfLocalDay } from './dates';
import { APP_RECORD_KEY, EXCLUDE_OWN_EXPORTS } from './export-metadata';
import {
  getHealthConnectAccess, getHealthConnectWriteAccess, healthConnectUnavailableMessage, isHealthConnectLoaded, requestHealthConnectAccess, requestHealthConnectWriteAccess,
  type HealthConnectWriteType,
} from './health-connect';

type HealthKit = typeof import('@kingstinct/react-native-healthkit');

const STEPS = 'HKQuantityTypeIdentifierStepCount' as const;
const UNNECESSARY = 2; // AuthorizationRequestStatus.unnecessary: the user has already been asked
const SHARING_DENIED = 1, SHARING_AUTHORIZED = 2; // AuthorizationStatus; unlike read access, write access is reported truthfully
const EQUAL_TO = 4; // ComparisonPredicateOperator.equalTo

// Each metric is requested separately in the Health sheet, so the user can allow any subset.
export const HEALTH_TYPES = {
  steps: STEPS,
  sleep: 'HKCategoryTypeIdentifierSleepAnalysis',
  weight: 'HKQuantityTypeIdentifierBodyMass',
  workouts: 'HKWorkoutTypeIdentifier',
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

// The phone's health store can be used from this build: HealthKit on iPhone, the Health Connect module on Android.
export const isHealthAvailable = () => Platform.OS === 'android' ? isHealthConnectLoaded() : loadHealthKit() !== null;

// Test hook so availability can be re-evaluated after mocking.
export function resetHealthKitCache() {
  cached = undefined;
}

export async function getHealthAccess(metric: HealthMetric): Promise<HealthAccess> {
  if (Platform.OS === 'android') return getHealthConnectAccess(metric);
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
  if (Platform.OS === 'android') return requestHealthConnectAccess();
  const hk = loadHealthKit();
  if (!hk) return;
  await hk.requestAuthorization({ toRead: METRICS.map((m) => HEALTH_TYPES[m]) });
}

export const healthUnavailableMessage = async () => Platform.OS === 'android' ? healthConnectUnavailableMessage() : 'Apple Health requires the native iPhone app build.';

// One cumulative-sum bucket per local calendar day. HealthKit de-duplicates overlapping sources (iPhone + Watch) inside the statistics query, so totals match the Health app.
// Days with no samples are omitted: no data is not the same claim as zero steps.
export async function readDailySteps(days: number, now: Date = new Date()): Promise<{ date: string; value: number }[]> {
  const hk = loadHealthKit();
  if (!hk) return [];
  const buckets = await hk.queryStatisticsCollectionForQuantity(STEPS, ['cumulativeSum'], startOfLocalDay(now, days - 1), { day: 1 }, {
    unit: 'count', filter: EXCLUDE_OWN_EXPORTS,
  });
  const out: { date: string; value: number }[] = [];
  for (const b of buckets) {
    if (b.startDate && b.sumQuantity) out.push({ date: localDateKey(new Date(b.startDate)), value: b.sumQuantity.quantity });
  }
  return out;
}

// Write access is requested per data type, never together with read access or social sharing. Pass only the types
// the feature the user just turned on needs. The sheet appears once per type; later changes happen in Settings.
type HealthKitWriteType = Parameters<HealthKit['deleteObjects']>[0];
export type HealthWriteType = HealthKitWriteType | HealthConnectWriteType;
export type HealthWriteAccess = 'unavailable' | 'not-asked' | 'denied' | 'granted';

export function getHealthWriteAccess(type: HealthWriteType): HealthWriteAccess {
  if (Platform.OS === 'android') return getHealthConnectWriteAccess(type as HealthConnectWriteType);
  const hk = loadHealthKit();
  if (!hk) return 'unavailable';
  const status = hk.authorizationStatusFor(type as HealthKitWriteType);
  return status === SHARING_AUTHORIZED ? 'granted' : status === SHARING_DENIED ? 'denied' : 'not-asked';
}

export async function requestHealthWriteAccess(types: readonly HealthWriteType[]): Promise<void> {
  if (Platform.OS === 'android') return requestHealthConnectWriteAccess(types as HealthConnectWriteType[]);
  const hk = loadHealthKit();
  if (!hk) return;
  await hk.requestAuthorization({ toShare: types as HealthKitWriteType[] });
}

// HealthKit lets an app delete only samples it saved. The record-id filter narrows that further to one export.
export async function removeExportedSample(type: HealthKitWriteType, kind: string, recordId: string): Promise<void> {
  const hk = loadHealthKit();
  if (!hk) throw new Error('Apple Health requires a native iPhone build.');
  await hk.deleteObjects(type, { metadata: { withMetadataKey: APP_RECORD_KEY, operatorType: EQUAL_TO, value: `${kind}:${recordId}` } });
}
