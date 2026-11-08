import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Linking, Platform } from 'react-native';

import type { ChangePage, JournalState, StoredSample } from './changes';
import { startOfLocalDay } from './dates';
import type { HealthAccess, HealthMetric, HealthWriteAccess } from './healthkit';
import type { SleepSample } from './sleep';
import type { WaterChange } from './water';
import type { WeightSample } from './weight';
import { activityName, type WorkoutChange } from './workouts';

// Android Health Connect. Every Health Connect identifier lives here or in src/lib/health-adapter/android.ts; the rest of
// src/lib/health dispatches here on Platform.OS and keeps the shapes the iOS pipeline already uses.
type HealthConnect = typeof import('react-native-health-connect');
type RecordType = import('react-native-health-connect').RecordType;
type RecordResult<T extends RecordType> = import('react-native-health-connect').RecordResult<T>;
// readRecords results carry no recordType (getChanges results do), so records are told apart by the query that returned them.
export type HealthRecord = Partial<RecordResult<'Steps'> & RecordResult<'Weight'> & RecordResult<'SleepSession'> & RecordResult<'ExerciseSession'> & RecordResult<'Hydration'>>;
type ReadOptions = Omit<import('react-native-health-connect').ReadRecordsOptions, 'timeRangeFilter'>;

export const OWN_PACKAGE = 'com.shivamlalakiya.leaderboard'; // dataOrigin of records this app wrote; never imported back
const PROVIDER_PACKAGE = 'com.google.android.apps.healthdata';
export const RECORD_TYPES = { steps: 'Steps', sleep: 'SleepSession', weight: 'Weight', workouts: 'ExerciseSession', water: 'Hydration' } as const satisfies Record<HealthMetric, RecordType>;
const SDK_UNAVAILABLE = 1, SDK_AVAILABLE = 3; // SdkAvailabilityStatus; 2 is "provider missing or needs an update"
// Without the history permission, reads may reach 30 days before the first grant. 29 days back is inside that window whatever the grant date.
const DEFAULT_HISTORY_DAYS = 29;
const EPOCH = new Date(0).toISOString();
// SleepStageType: sleeping, light, deep, REM. Awake (1), out of bed (3), unknown (0) and awake in bed (7) are not sleep.
const ASLEEP_STAGES = new Set([2, 4, 5, 6]);
// ExerciseType to the HKWorkoutActivityType raw value with the same meaning, so both platforms store the same activity names.
// Anything else (single exercises such as bench press, or types added later) is imported as 'Other'.
const EXERCISE_AS_HK: Record<number, number> = {
  2: 4, 4: 5, 5: 6, 8: 13, 9: 13, 10: 11, 11: 8, 13: 20, 14: 10, 16: 14, 25: 16, 27: 18, 28: 1, 29: 3, 31: 75, 32: 21, 33: 29,
  34: 22, 35: 23, 36: 63, 37: 24, 38: 25, 39: 39, 41: 64, 44: 28, 46: 31, 48: 66, 50: 34, 51: 9, 52: 25, 53: 35, 54: 35, 55: 36,
  56: 37, 57: 37, 58: 38, 59: 84, 60: 39, 61: 40, 62: 67, 63: 40, 64: 41, 65: 42, 66: 43, 68: 44, 69: 44, 70: 50, 71: 62, 72: 45,
  73: 46, 74: 46, 75: 47, 76: 48, 78: 51, 79: 52, 80: 54, 81: 50, 82: 70, 83: 57,
};

// What the export queue writes (#61). Steps are never written: aggregation would count them in our own imported totals.
export const WRITE_TYPES = { weight: 'Weight', sleep: 'SleepSession', workouts: 'ExerciseSession', nutrition: 'Nutrition', water: 'Hydration' } as const satisfies Record<string, RecordType>;
export type HealthConnectWriteType = (typeof WRITE_TYPES)[keyof typeof WRITE_TYPES];

let cached: HealthConnect | null | undefined;
let ready: Promise<boolean> | undefined;
let writeGrants = new Set<string>();

// The native module only exists in an Android dev/production build; its JS entry throws on iOS and web as soon as any export is touched.
export function loadHealthConnect(): HealthConnect | null {
  if (cached !== undefined) return cached;
  cached = null;
  if (Platform.OS !== 'android' || Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require('react-native-health-connect') as HealthConnect;
  } catch {
    cached = null;
  }
  return cached;
}

export const isHealthConnectLoaded = () => loadHealthConnect() !== null;

// Test hook so availability can be re-evaluated after mocking.
export function resetHealthConnectCache() {
  cached = undefined;
  ready = undefined;
  writeGrants = new Set();
}

// 'provider-update-required' covers both "not installed" and "too old": Health Connect does not say which, and Google Play fixes both.
export type HealthConnectAvailability = 'available' | 'unsupported' | 'provider-update-required' | 'native-build-required';

export async function getHealthConnectAvailability(): Promise<HealthConnectAvailability> {
  const hc = loadHealthConnect();
  if (!hc) return 'native-build-required';
  let status: number;
  try { status = await hc.getSdkStatus(); } catch { return 'native-build-required'; } // JS present but native module not linked
  if (status === SDK_UNAVAILABLE) return 'unsupported';
  if (status !== SDK_AVAILABLE) return 'provider-update-required';
  ready ??= hc.initialize().catch(() => { ready = undefined; return false; });
  return (await ready) ? 'available' : 'provider-update-required';
}

const client = async () => (await getHealthConnectAvailability()) === 'available' ? loadHealthConnect() : null;
const granted = async (hc: HealthConnect) => new Set((await hc.getGrantedPermissions()).map((p) => `${p.accessType}:${p.recordType}`));

// Unlike HealthKit, Health Connect reports read grants truthfully and the user can revoke them at any time, so this is
// checked before every sync. Granted maps to 'asked' (the coordinator reads), missing to 'not-asked' (needs permission).
export async function getHealthConnectAccess(metric: HealthMetric): Promise<HealthAccess> {
  const hc = await client();
  if (!hc) return 'unavailable';
  return (await granted(hc)).has(`read:${RECORD_TYPES[metric]}`) ? 'asked' : 'not-asked';
}

// One Health Connect sheet with a toggle per type, so the user can allow any subset. History access is asked with it
// because the import reaches 90 days back; without it reads fall back to the default window (see readSince).
export async function requestHealthConnectAccess(): Promise<void> {
  const hc = await client();
  if (!hc) return;
  await hc.requestPermission([
    ...Object.values(RECORD_TYPES).map((recordType) => ({ accessType: 'read' as const, recordType })),
    { accessType: 'read', recordType: 'ReadHealthDataHistory' },
  ]);
}

// The export queue and the save switches ask for write access synchronously (HealthKit can answer that way), so write
// grants are cached: refreshed before the queue runs, after every request and after a failed write.
export async function refreshHealthConnectWriteAccess(): Promise<void> {
  const hc = await client();
  writeGrants = hc ? new Set([...(await granted(hc))].filter((k) => k.startsWith('write:')).map((k) => k.slice(6))) : new Set();
}
export const getHealthConnectWriteAccess = (type: HealthConnectWriteType): HealthWriteAccess => !loadHealthConnect() ? 'unavailable' : writeGrants.has(type) ? 'granted' : 'not-asked';

// One kind of access per request: write only, for the types the feature the user just turned on needs.
export async function requestHealthConnectWriteAccess(types: readonly HealthConnectWriteType[]): Promise<void> {
  const hc = await client();
  if (hc && types.length) await hc.requestPermission(types.map((recordType) => ({ accessType: 'write' as const, recordType })));
  await refreshHealthConnectWriteAccess();
}

// Writes are upserts keyed by our clientRecordId: Health Connect keeps the record with the highest clientRecordVersion,
// so a retry with the same version changes nothing and an edit (higher version) replaces it. A failure that turns out to
// be a missing grant is tagged so the queue shows it as a permission problem.
async function guarded<T>(type: HealthConnectWriteType, run: (hc: HealthConnect) => Promise<T>): Promise<T> {
  const hc = await client();
  if (!hc) throw new Error(await healthConnectUnavailableMessage());
  try {
    return await run(hc);
  } catch (e) {
    await refreshHealthConnectWriteAccess().catch(() => {});
    throw writeGrants.has(type) ? e : Object.assign(new Error('Health Connect did not allow saving this.'), { reason: 'permission' });
  }
}
type HealthConnectRecord = import('react-native-health-connect').HealthConnectRecord;
export type WriteRecord = HealthConnectRecord extends infer R ? R extends HealthConnectRecord ? Omit<R, 'metadata'> : never : never;
export const insertHealthConnectRecord = (type: HealthConnectWriteType, record: WriteRecord, clientRecordId: string, version: number) =>
  guarded(type, async (hc) => (await hc.insertRecords([{ ...record, metadata: { clientRecordId, clientRecordVersion: version, recordingMethod: 3 } } as HealthConnectRecord]))[0] ?? null);
// Health Connect only deletes records the calling app wrote; the client record id narrows it to this one export.
export const deleteHealthConnectRecord = (type: HealthConnectWriteType, clientRecordId: string) => guarded(type, (hc) => hc.deleteRecordsByUuids(type, [], [clientRecordId]));

// ExerciseType for an activity, through the HKWorkoutActivityType code the iOS export uses (activityCode); the first
// listed Health Connect type wins (running, not treadmill). Unknown activities are OTHER_WORKOUT (0).
const HK_AS_EXERCISE: Record<number, number> = Object.fromEntries(Object.entries(EXERCISE_AS_HK).reverse().map(([hc, hk]) => [hk, Number(hc)]));
export const exerciseType = (hkCode: number) => HK_AS_EXERCISE[hkCode] ?? 0;

export const openHealthConnectSettings = () => loadHealthConnect()?.openHealthConnectSettings();
export const openHealthConnectInstall = () => Linking.openURL(`market://details?id=${PROVIDER_PACKAGE}`);

export async function healthConnectUnavailableMessage(): Promise<string> {
  switch (await getHealthConnectAvailability()) {
    case 'unsupported': return 'Health Connect needs Android 9 or newer with Google Play services.';
    case 'provider-update-required': return 'Install or update Health Connect from Google Play, then try again.';
    default: return 'Health Connect requires the Leaderboard Android app build.';
  }
}

// Health Connect errors, rather than returning less, when a read reaches further back than it allows without the history
// permission. Retry once from inside the default window and report where the data now starts. A page token continues the
// original request, so it is never retried with a different range.
export async function readSince<T extends RecordType>(hc: HealthConnect, type: T, from: string, options: ReadOptions, end?: string) {
  const read = (start: string) => hc.readRecords(type, { ...options, timeRangeFilter: end ? { operator: 'between', startTime: start, endTime: end } : { operator: 'after', startTime: start } });
  try {
    return { ...(await read(from)), from, truncated: false };
  } catch (e) {
    const floor = startOfLocalDay(new Date(), DEFAULT_HISTORY_DAYS).toISOString();
    if (options.pageToken || from >= floor) throw e;
    return { ...(await read(floor)), from: floor, truncated: true };
  }
}

const iso = (s: string) => new Date(s).toISOString();
const isOwn = (r: HealthRecord) => r.metadata?.dataOrigin === OWN_PACKAGE;

// A sleep session becomes one asleep interval per sleeping stage, or the whole session when it has no stages, in the
// SleepSample shape summarizeSleep uses on iOS (value 1: asleep), so overlaps and nights follow the same rule.
export function sleepIntervals(r: HealthRecord) {
  const spans = r.stages?.length ? r.stages.filter((s) => ASLEEP_STAGES.has(s.stage)) : [{ startTime: r.startTime!, endTime: r.endTime! }];
  return spans.map((s) => ({ start: iso(s.startTime), end: iso(s.endTime) }));
}
export const sleepSamples = (records: readonly HealthRecord[]): SleepSample[] => records.flatMap((r) => isOwn(r) || !r.metadata?.id ? [] :
  sleepIntervals(r).map((s, i) => ({ uuid: `${r.metadata!.id}#${i}`, startDate: new Date(s.start), endDate: new Date(s.end), value: 1 })));

export function mapExercise(r: HealthRecord, timezone: string): WorkoutChange | null {
  const start = Date.parse(r.startTime ?? ''), end = Date.parse(r.endTime ?? '');
  if (!r.metadata?.id || !Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  // Distance and energy are separate record types behind separate permissions; left unknown rather than guessed.
  return { health_uuid: r.metadata.id, activity_type: activityName(EXERCISE_AS_HK[r.exerciseType ?? 0] ?? 0), started_at: iso(r.startTime!), ended_at: iso(r.endTime!),
    timezone, duration_s: (end - start) / 1000, distance_m: null, energy_kcal: null };
}

function toPage(metric: HealthMetric, state: JournalState, records: readonly HealthRecord[], deletedIds: string[], anchor: string, hasMore: boolean): ChangePage {
  const rows = records.filter((r) => !isOwn(r) && r.metadata?.id);
  const id = (r: HealthRecord) => r.metadata!.id!;
  let samples: StoredSample[] = [], workouts: WorkoutChange[] | undefined, water: WaterChange[] | undefined, deleted = deletedIds;
  if (metric === 'steps') samples = rows.map((r) => ({ id: id(r), start: iso(r.startTime!), end: iso(r.endTime!), value: r.count! }));
  else if (metric === 'weight') samples = rows.map((r) => ({ id: id(r), start: iso(r.time!), end: iso(r.time!), value: r.weight!.inKilograms }));
  else if (metric === 'sleep') {
    samples = sleepSamples(rows).map((s) => ({ id: s.uuid, start: s.startDate.toISOString(), end: s.endDate.toISOString(), value: s.value }));
    // The journal holds one entry per asleep interval (<session id>#<n>). A deleted or edited session drops all of its old intervals.
    const sessions = new Set([...deletedIds, ...rows.map(id)]);
    deleted = state.samples.filter((s) => sessions.has(s.id.split('#')[0])).map((s) => s.id);
  } else if (metric === 'water') {
    // Hydration carries a zone offset, not a zone name, so entries take this device's zone like iOS samples without HKTimeZone.
    // dataOrigin is a package name, not an app name, so source_name stays unknown.
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    water = rows.filter((r) => Number.isFinite(r.volume?.inMilliliters) && r.volume!.inMilliliters >= 0)
      .map((r) => ({ health_uuid: id(r), consumed_at: iso(r.startTime!), timezone, ml: r.volume!.inMilliliters, source_name: null }));
    samples = water.map((w) => ({ id: w.health_uuid, start: w.consumed_at, end: w.consumed_at, value: w.ml }));
  } else {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    workouts = rows.map((r) => mapExercise(r, timezone)).filter((w): w is WorkoutChange => w !== null);
    samples = workouts.map((w) => ({ id: w.health_uuid, start: w.started_at, end: w.ended_at, value: w.duration_s ?? 0 }));
  }
  return { samples, deleted, anchor, hasMore, ...(workouts ? { workouts } : {}), ...(water ? { water } : {}) };
}

// Opaque journal anchor. t: changes token. While the history import pages through readRecords, p holds the next page token
// and f the range start it was requested with (page tokens are only valid for the same request).
type Cursor = { t: string; p?: string; f?: string };

// A fresh changes token only reports changes made after it was created, so the token is taken FIRST, then history is
// read page by page; afterwards only getChanges is used, and deletions arrive as ids. An expired token (30 days unused)
// starts a fresh full read that never infers deletions, like resetHealthAnchors on iOS.
export async function queryHealthConnectChanges(metric: HealthMetric, state: JournalState, limit: number): Promise<ChangePage> {
  const hc = await client();
  if (!hc) throw new Error(await healthConnectUnavailableMessage());
  const type = RECORD_TYPES[metric];
  let cursor = state.anchor ? JSON.parse(state.anchor) as Cursor : null;
  if (cursor && cursor.p === undefined) {
    const res = await hc.getChanges({ changesToken: cursor.t });
    if (!res.changesTokenExpired) {
      // Same lower bound as the history read: an edit to a record older than the import window is not imported.
      const records = res.upsertionChanges.map((c) => c.record as HealthRecord).filter((r) => metric === 'weight' || (!!r.endTime && iso(r.endTime) >= state.from));
      return toPage(metric, state, records, res.deletionChanges.map((d) => d.recordId), JSON.stringify({ t: res.nextChangesToken }), res.hasMore);
    }
    cursor = null;
  }
  const t = cursor?.t ?? (await hc.getChanges({ recordTypes: [type] })).nextChangesToken;
  const page = await readSince<RecordType>(hc, type, cursor?.f ?? (metric === 'weight' ? EPOCH : state.from), { ascendingOrder: true, pageSize: limit, pageToken: cursor?.p });
  const next: Cursor = page.pageToken ? { t, p: page.pageToken, f: page.from } : { t };
  return { ...toPage(metric, state, page.records as HealthRecord[], [], JSON.stringify(next), !!page.pageToken), ...(cursor ? {} : { truncatedFrom: page.truncated ? page.from : undefined }) };
}

// Aggregation de-duplicates overlapping sources (phone + watch) the way the Health Connect app does; raw records are never summed.
// This app never writes steps to Health Connect, so the total cannot include our own exports.
export async function readHealthConnectSteps(start: Date, end: Date): Promise<number> {
  const hc = await client();
  if (!hc) throw new Error(await healthConnectUnavailableMessage());
  const total = await hc.aggregateRecord({ recordType: 'Steps', timeRangeFilter: { operator: 'between', startTime: start.toISOString(), endTime: end.toISOString() } });
  return total.COUNT_TOTAL;
}

// The newest reading from another app plus any others at exactly the same time; normalizeWeight picks between ties.
export async function readHealthConnectWeightTies(now: Date): Promise<WeightSample[]> {
  const hc = await client();
  if (!hc) return [];
  const { records } = await readSince(hc, 'Weight', EPOCH, { ascendingOrder: false, pageSize: 50 }, now.toISOString());
  const others = (records as HealthRecord[]).filter((r) => !isOwn(r) && r.metadata?.id);
  return others.filter((r) => r.time === others[0].time).map((r) => ({ uuid: r.metadata!.id!, startDate: new Date(r.time!), quantity: r.weight!.inKilograms, unit: 'kg' }));
}
