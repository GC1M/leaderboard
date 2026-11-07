import { Platform } from 'react-native';

import { getHealthAccess, getHealthWriteAccess, HEALTH_TYPES, loadHealthKit, readDailySteps, requestHealthWriteAccess, type HealthMetric } from '../health/healthkit';
import { readDailySleep } from '../health/sleep';
import { readWeightHistory } from '../health/weight';
import { IOS_MATRIX, resolveCapability } from './capabilities';
import {
  makeSampleId, type AccessKind, type DateRange, type HealthAdapter, type HealthDataType, type PermissionSnapshot, type PermissionState,
  type ProviderAvailability, type ReadResult,
} from './types';

// Thin wrapper over the existing Apple Health modules, which stay the owners of all HealthKit behavior.
// The native identifiers are looked up here and never leave this file. Changes (journal-coupled in changes.ts) and
// writes (the export queue, registered per feature) are not wired through the adapter yet, so they answer 'not-implemented'.
const metricOf = (type: HealthDataType): HealthMetric | null => (type in HEALTH_TYPES ? (type as HealthMetric) : null);
const NOT_WIRED = { status: 'unsupported', reason: 'not-implemented' } as const;

async function availability(): Promise<ProviderAvailability> {
  if (loadHealthKit()) return { status: 'available' };
  return Platform.OS === 'ios' ? { status: 'unavailable', reason: 'native-build-required' } : { status: 'unsupported', reason: 'platform' };
}

async function permission(type: HealthDataType, access: AccessKind): Promise<PermissionState> {
  const metric = metricOf(type);
  if (!metric || (await availability()).status !== 'available') return 'unavailable';
  if (access === 'read') return (await getHealthAccess(metric)) === 'asked' ? 'unknown' : 'not-asked'; // HealthKit never reveals a read grant
  if (access === 'write') return getHealthWriteAccess(HEALTH_TYPES[metric]);
  return 'unavailable'; // no history or background grant exists on this platform
}

// Answers for paths the adapter does not wire: the capability result when there is a more specific reason, else 'not-implemented'.
async function notWired(type: HealthDataType, access: 'read' | 'write') {
  const capability = resolveCapability(IOS_MATRIX, await availability(), type, access);
  return capability.status === 'supported' ? NOT_WIRED : capability;
}

async function readable<T>(type: HealthDataType, run: () => Promise<T>): Promise<ReadResult<T>> {
  const capability = resolveCapability(IOS_MATRIX, await availability(), type, 'read');
  if (capability.status !== 'supported') return capability;
  if ((await permission(type, 'read')) === 'not-asked') return { status: 'permission-required', access: 'read' };
  return { status: 'ok', data: await run() };
}

export function createIosHealthAdapter(): HealthAdapter {
  return {
    platform: 'ios',
    getAvailability: availability,
    getCapability: async (type, access) => resolveCapability(IOS_MATRIX, await availability(), type, access),
    getPermission: permission,
    async requestPermissions(access, types) {
      const hk = loadHealthKit();
      const metrics = types.flatMap((t) => { const m = metricOf(t); return m ? [m] : []; });
      if (hk && metrics.length && (access === 'read' || access === 'write')) {
        // One kind per call: the Health sheet for write access is never combined with read access.
        if (access === 'read') await hk.requestAuthorization({ toRead: metrics.map((m) => HEALTH_TYPES[m]) });
        else await requestHealthWriteAccess(metrics.map((m) => HEALTH_TYPES[m]));
      }
      const out: PermissionSnapshot = {};
      for (const t of types) out[t] = await permission(t, access);
      return out;
    },
    readSteps: (range: DateRange) => readable('steps', async () => (await readDailySteps(range.days, range.now)).map((d) => ({ date: d.date, count: d.value }))),
    readSleep: (range: DateRange) => readable('sleep', () => readDailySleep(range.days, range.now).then((days) => days.map((d) => ({ date: d.date, minutes: d.value, windowStart: d.windowStart, windowEnd: d.windowEnd })))),
    // Our own exports are filtered out by the existing queries, so everything returned came from other apps.
    readWeight: (range: DateRange) => readable('weight', () => readWeightHistory(range.days, range.now).then((rows) => rows.map((r) => ({
      id: makeSampleId('ios', r.sampleId), measuredAt: r.measuredAt, kg: r.kg, provenance: { origin: 'other-app' as const, recording: 'unknown' as const },
    })))),
    readChanges: (type) => notWired(type, 'read'),
    write: (request) => notWired(request.payload.type, 'write'),
    remove: (type) => notWired(type, 'write'),
  };
}
