import { localDateKey, startOfLocalDay } from '../health/dates';
import {
  getHealthConnectAvailability, loadHealthConnect, mapExercise, OWN_PACKAGE, readSince, RECORD_TYPES, refreshHealthConnectWriteAccess, sleepSamples, WRITE_TYPES,
  type HealthConnectAvailability, type HealthRecord as Rec,
} from '../health/health-connect';
import type { HealthMetric } from '../health/healthkit';
import { summarizeSleep } from '../health/sleep';
import { ANDROID_MATRIX, resolveCapability } from './capabilities';
import {
  makeSampleId, type AccessKind, type DateRange, type HealthAdapter, type HealthDataType, type PermissionSnapshot, type PermissionState,
  type ProviderAvailability, type Provenance, type ReadResult,
} from './types';

// Thin wrapper over src/lib/health/health-connect.ts, which owns all Health Connect behavior. Like the iOS wrapper, the
// journal-based change feed (changes.ts) and the export queue writers (health-connect-export.ts) are not routed through the
// adapter, so readChanges, write and remove answer from the matrix ('not-implemented'). Write permissions are real.
const metricOf = (type: HealthDataType): HealthMetric | null => (type in RECORD_TYPES ? (type as HealthMetric) : null);
const NOT_WIRED = { status: 'unsupported', reason: 'not-implemented' } as const;
// SDK_UNAVAILABLE in practice means Android older than 9.
const AVAILABILITY: Record<HealthConnectAvailability, ProviderAvailability> = {
  available: { status: 'available' },
  unsupported: { status: 'unsupported', reason: 'os-version' },
  'provider-update-required': { status: 'unavailable', reason: 'provider-update-required' },
  'native-build-required': { status: 'unavailable', reason: 'native-build-required' },
};

const availability = async () => AVAILABILITY[await getHealthConnectAvailability()];

// Answers for paths the adapter does not wire: the capability result when there is a more specific reason, else 'not-implemented'.
async function notWired(type: HealthDataType, access: 'read' | 'write') {
  const capability = resolveCapability(ANDROID_MATRIX, await availability(), type, access);
  return capability.status === 'supported' ? NOT_WIRED : capability;
}

async function permission(type: HealthDataType, access: AccessKind): Promise<PermissionState> {
  const metric = metricOf(type), hc = loadHealthConnect();
  if (!metric || !hc || (await availability()).status !== 'available') return 'unavailable';
  if (access === 'read') return (await hc.getGrantedPermissions()).some((p) => p.accessType === 'read' && p.recordType === RECORD_TYPES[metric]) ? 'granted' : 'not-asked';
  if (access === 'history') return 'unknown'; // requested with reads, but the native module does not report this grant
  const write = access === 'write' && metric !== 'steps' ? WRITE_TYPES[metric] : null; // steps are never written
  if (write) return (await hc.getGrantedPermissions()).some((p) => p.accessType === 'write' && p.recordType === write) ? 'granted' : 'not-asked';
  return 'unavailable'; // no background reads in this build
}

async function readable<T>(type: HealthDataType, run: () => Promise<{ data: T; truncatedFrom?: string }>): Promise<ReadResult<T>> {
  const capability = resolveCapability(ANDROID_MATRIX, await availability(), type, 'read');
  if (capability.status !== 'supported') return capability;
  if ((await permission(type, 'read')) !== 'granted') return { status: 'permission-required', access: 'read' };
  const { data, truncatedFrom } = await run();
  return { status: 'ok', data, ...(truncatedFrom ? { truncatedFrom } : {}) };
}

// Every page of a range. truncatedFrom is set when Health Connect refused the start of the range (no history access).
async function readAll(type: (typeof RECORD_TYPES)[HealthMetric], from: Date, end: Date): Promise<{ records: Rec[]; truncatedFrom?: string }> {
  const hc = loadHealthConnect()!;
  const records: Rec[] = [];
  let start = from.toISOString(), pageToken: string | undefined, truncatedFrom: string | undefined;
  do {
    const page = await readSince(hc, type, start, { ascendingOrder: true, pageSize: 1000, pageToken }, end.toISOString());
    if (page.truncated) truncatedFrom = localDateKey(new Date(page.from));
    start = page.from;
    records.push(...(page.records as Rec[]));
    pageToken = page.pageToken || undefined;
  } while (pageToken);
  return { records, truncatedFrom };
}

const provenance = (r: Rec): Provenance => ({
  origin: r.metadata?.dataOrigin === OWN_PACKAGE ? 'this-app' : 'other-app',
  recording: r.metadata?.recordingMethod === 3 ? 'manual' : r.metadata?.recordingMethod === 1 || r.metadata?.recordingMethod === 2 ? 'automatic' : 'unknown',
});

async function dailySteps(range: DateRange) {
  const hc = loadHealthConnect()!, now = range.now ?? new Date();
  const data: { date: string; count: number }[] = [];
  let truncatedFrom: string | undefined;
  for (let i = 0; i < range.days; i++) {
    const start = startOfLocalDay(now, i);
    try {
      const total = await hc.aggregateRecord({ recordType: 'Steps', timeRangeFilter: { operator: 'between', startTime: start.toISOString(), endTime: startOfLocalDay(start, -1).toISOString() } });
      if (total.COUNT_TOTAL > 0) data.unshift({ date: localDateKey(start), count: total.COUNT_TOTAL }); // no steps is no data, not a zero day
    } catch (e) {
      if (i < 29) throw e; // inside the default window an error is a real failure
      truncatedFrom = localDateKey(startOfLocalDay(now, i - 1));
      break;
    }
  }
  return { data, truncatedFrom };
}

export function createAndroidHealthAdapter(): HealthAdapter {
  return {
    platform: 'android',
    getAvailability: availability,
    getCapability: async (type, access) => resolveCapability(ANDROID_MATRIX, await availability(), type, access),
    getPermission: permission,
    async requestPermissions(access, types) {
      // One kind per call, and only the requested types: the Health Connect sheet shows one toggle per type.
      const hc = loadHealthConnect(), metrics = types.flatMap((t) => { const m = metricOf(t); return m ? [m] : []; });
      if (hc && metrics.length && (await availability()).status === 'available') {
        if (access === 'read') await hc.requestPermission(metrics.map((m) => ({ accessType: 'read', recordType: RECORD_TYPES[m] })));
        if (access === 'history') await hc.requestPermission([{ accessType: 'read', recordType: 'ReadHealthDataHistory' }]);
        const writes = access === 'write' ? metrics.flatMap((m) => (m === 'steps' ? [] : [WRITE_TYPES[m]])) : [];
        if (writes.length) { await hc.requestPermission(writes.map((recordType) => ({ accessType: 'write', recordType }))); await refreshHealthConnectWriteAccess(); }
      }
      const out: PermissionSnapshot = {};
      for (const t of types) out[t] = await permission(t, access);
      return out;
    },
    readSteps: (range) => readable('steps', () => dailySteps(range)),
    readSleep: (range) => readable('sleep', async () => {
      const now = range.now ?? new Date(), from = startOfLocalDay(now, range.days - 1);
      // Two days of lookback keep a session together when it started before the requested dates, as on iOS.
      const { records, truncatedFrom } = await readAll(RECORD_TYPES.sleep, startOfLocalDay(from, 2), now);
      const days = summarizeSleep(sleepSamples(records).filter((s) => s.endDate <= now)).filter((d) => d.date >= localDateKey(from));
      return { data: days.map((d) => ({ date: d.date, minutes: d.value, windowStart: d.windowStart, windowEnd: d.windowEnd })), truncatedFrom };
    }),
    readWeight: (range) => readable('weight', async () => {
      const now = range.now ?? new Date();
      const { records, truncatedFrom } = await readAll(RECORD_TYPES.weight, startOfLocalDay(now, range.days - 1), now);
      return { data: records.filter((r) => r.metadata?.id).map((r) => ({ id: makeSampleId('android', r.metadata!.id!), measuredAt: new Date(r.time!).toISOString(), kg: r.weight!.inKilograms, provenance: provenance(r) })), truncatedFrom };
    }),
    readWorkouts: (range) => readable('workouts', async () => {
      const now = range.now ?? new Date();
      const { records, truncatedFrom } = await readAll(RECORD_TYPES.workouts, startOfLocalDay(now, range.days - 1), now);
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      return { data: records.flatMap((r) => {
        const w = mapExercise(r, timezone);
        return w ? [{ id: makeSampleId('android', w.health_uuid), start: w.started_at, end: w.ended_at, activity: w.activity_type, provenance: provenance(r) }] : [];
      }), truncatedFrom };
    }),
    readChanges: (type) => notWired(type, 'read'),
    write: (request) => notWired(request.payload.type, 'write'),
    remove: (type) => notWired(type, 'write'),
  };
}
