// Platform-neutral contracts for reading and writing health data. Screens, the journal and server models depend on
// these types only; Apple HealthKit and Android Health Connect details stay inside each platform's adapter.
// Nothing here may mention a native type identifier, permission string or package name.

export type HealthPlatform = 'ios' | 'android';
export type HealthDataType = 'steps' | 'sleep' | 'weight' | 'workouts' | 'nutrition' | 'water';
export const HEALTH_DATA_TYPES: readonly HealthDataType[] = ['steps', 'sleep', 'weight', 'workouts', 'nutrition', 'water'];

// Capability: can this device do it at all. 'unsupported' will not change for this device or app build;
// 'unavailable' can be fixed by the user (install or update the provider, use a native build), so the UI can say how.
export type UnsupportedReason = 'platform' | 'os-version' | 'work-profile' | 'not-implemented';
export type UnavailableReason = 'provider-missing' | 'provider-update-required' | 'native-build-required';
export type Unsupported = { status: 'unsupported'; reason: UnsupportedReason };
export type Unavailable = { status: 'unavailable'; reason: UnavailableReason };
export type CapabilityResult = { status: 'supported' } | Unsupported | Unavailable;
export type ProviderAvailability = { status: 'available' } | Unsupported | Unavailable;

// Permissions. Read and write are separate grants per data type and are never requested together; sharing with a
// group is an app setting and has no entry here. 'history' and 'background' are extra read grants that only some
// platforms need (see the capability matrix).
export type AccessKind = 'read' | 'write' | 'history' | 'background';
// 'unknown' is honest for iOS read access: the OS never says whether it was granted, only that we asked.
// 'unavailable': this adapter cannot ask for it (provider missing, or no such grant or data type here).
export type PermissionState = 'granted' | 'denied' | 'not-asked' | 'unknown' | 'unavailable';
export type PermissionSnapshot = Partial<Record<HealthDataType, PermissionState>>;

// Where a sample came from. 'this-app' lets importers skip what we exported, so nothing loops back.
export type Provenance = {
  origin: 'this-app' | 'other-app' | 'unknown';
  recording: 'automatic' | 'manual' | 'unknown';
  sourceName?: string;
  device?: 'phone' | 'watch' | 'scale' | 'other' | 'unknown';
};

// Stable across reads and restarts; the platform prefix keeps ids from two stores apart.
export type SampleId = string;
export const makeSampleId = (platform: HealthPlatform, nativeId: string): SampleId => `${platform}:${nativeId}`;

export type DateRange = { days: number; now?: Date };

// Daily totals use the device-local calendar date (YYYY-MM-DD). Days with no data are omitted: no data is not zero.
export type DailySteps = { date: string; count: number };
export type SleepDay = { date: string; minutes: number; windowStart: string; windowEnd: string };
export type WeightReading = { id: SampleId; measuredAt: string; kg: number; provenance: Provenance };
export type Workout = { id: SampleId; start: string; end: string; activity: string; provenance: Provenance };

export type ReadResult<T> =
  | { status: 'ok'; data: T; truncatedFrom?: string } // truncatedFrom: earliest local date the platform let us read, when the request asked for older data
  | Unsupported
  | Unavailable
  | { status: 'permission-required'; access: AccessKind };

// Change notifications are pulled: the cursor is opaque and only valid for the adapter that issued it.
// Deletions carry the id only, never the data type's values.
export type ChangeBatch<T> = { upserts: T[]; deletedIds: SampleId[]; cursor: string; hasMore: boolean };
export type ChangesResult<T> = ReadResult<ChangeBatch<T>> | { status: 'cursor-expired' };

// Writes carry our own record id and a version: replaying the same record id with the same or an older version
// must not create a second sample. Only samples this app wrote can be removed.
export type WritePayload =
  | { type: 'steps'; start: string; end: string; count: number }
  | { type: 'sleep'; start: string; end: string }
  | { type: 'weight'; measuredAt: string; kg: number }
  | { type: 'workouts'; start: string; end: string; activity: string };
export type WriteRequest = { recordId: string; version: number; payload: WritePayload };
export type WriteResult =
  | { status: 'ok'; sampleId: SampleId | null }
  | Unsupported
  | Unavailable
  | { status: 'permission-required'; access: 'write' };

export interface HealthAdapter {
  readonly platform: HealthPlatform;
  getAvailability(): Promise<ProviderAvailability>;
  getCapability(type: HealthDataType, access: 'read' | 'write'): Promise<CapabilityResult>;
  getPermission(type: HealthDataType, access: AccessKind): Promise<PermissionState>;
  // Asks for one kind of access per call. Resolves when the system sheet closes, which says nothing about what
  // the user allowed; read the returned snapshot (and treat 'unknown' as unknown).
  requestPermissions(access: AccessKind, types: readonly HealthDataType[]): Promise<PermissionSnapshot>;
  readSteps(range: DateRange): Promise<ReadResult<DailySteps[]>>;
  readSleep(range: DateRange): Promise<ReadResult<SleepDay[]>>;
  readWeight(range: DateRange): Promise<ReadResult<WeightReading[]>>;
  readWorkouts?(range: DateRange): Promise<ReadResult<Workout[]>>;
  // cursor null starts from the beginning of what the platform lets us read.
  readChanges(type: 'weight' | 'workouts', cursor: string | null): Promise<ChangesResult<WeightReading | Workout>>;
  write(request: WriteRequest): Promise<WriteResult>;
  remove(type: HealthDataType, recordId: string): Promise<WriteResult>;
}
