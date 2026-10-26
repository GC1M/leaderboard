import { localDateKey, startOfLocalDay } from '../health/dates';
import { ANDROID_MATRIX, resolveCapability, type PlatformMatrix } from './capabilities';
import {
  makeSampleId, type AccessKind, type ChangeBatch, type ChangesResult, type DailySteps, type DateRange, type HealthAdapter, type HealthDataType,
  type PermissionSnapshot, type PermissionState, type ProviderAvailability, type ReadResult, type SleepDay, type WeightReading, type WriteRequest, type WriteResult, type Workout,
} from './types';

// Everything wired, except nutrition and water, so the unsupported path is exercised too.
export const FAKE_MATRIX: PlatformMatrix = {
  ...ANDROID_MATRIX,
  entries: {
    ...ANDROID_MATRIX.entries,
    steps: { ...ANDROID_MATRIX.entries.steps, implemented: { read: true, write: true } },
    sleep: { ...ANDROID_MATRIX.entries.sleep, implemented: { read: true, write: true } },
    weight: { ...ANDROID_MATRIX.entries.weight, implemented: { read: true, write: true } },
    workouts: { ...ANDROID_MATRIX.entries.workouts, implemented: { read: true, write: true } },
    nutrition: { ...ANDROID_MATRIX.entries.nutrition, read: false, write: false },
    water: { ...ANDROID_MATRIX.entries.water, read: false, write: false },
  },
};

const HISTORY_DAYS = 30;

// In-memory adapter for tests of code that depends on HealthAdapter, and the reference the contract suite runs against.
// Permissions behave like a store that reports them truthfully; nothing is granted until requested.
export class FakeHealthAdapter implements HealthAdapter {
  readonly platform = 'android' as const;
  availability: ProviderAvailability = { status: 'available' };
  steps: DailySteps[] = [];
  sleep: SleepDay[] = [];
  weights: WeightReading[] = [];
  workouts: Workout[] = [];
  private granted = new Set<string>();
  private log: { upsert?: WeightReading; deletedId?: string }[] = [];
  private written = new Map<string, { version: number; sampleId: string }>();
  private next = 1;
  constructor(readonly matrix: PlatformMatrix = FAKE_MATRIX) {}

  async getAvailability() { return this.availability; }
  async getCapability(type: HealthDataType, access: 'read' | 'write') { return resolveCapability(this.matrix, this.availability, type, access); }
  async getPermission(type: HealthDataType, access: AccessKind): Promise<PermissionState> {
    if (this.availability.status !== 'available' || !this.matrix.entries[type][access === 'write' ? 'write' : 'read']) return 'unavailable';
    return this.granted.has(`${type}:${access}`) ? 'granted' : 'not-asked';
  }
  async requestPermissions(access: AccessKind, types: readonly HealthDataType[]): Promise<PermissionSnapshot> {
    const out: PermissionSnapshot = {};
    for (const type of types) {
      if (await this.getPermission(type, access) !== 'unavailable') this.granted.add(`${type}:${access}`);
      out[type] = await this.getPermission(type, access);
    }
    return out;
  }
  revoke(type: HealthDataType, access: AccessKind) { this.granted.delete(`${type}:${access}`); }

  private async gate(type: HealthDataType, access: 'read' | 'write') {
    const capability = await this.getCapability(type, access);
    if (capability.status !== 'supported') return capability;
    if (!this.granted.has(`${type}:${access}`)) return { status: 'permission-required' as const, access };
    return null;
  }
  // Without the history grant a read reaches back 30 days at most; say so instead of returning a silently short list.
  private window(type: HealthDataType, range: DateRange) {
    const now = range.now ?? new Date();
    const limited = range.days > HISTORY_DAYS && !this.granted.has(`${type}:history`);
    const from = startOfLocalDay(now, (limited ? HISTORY_DAYS : range.days) - 1);
    return { from: localDateKey(from), start: from, now, truncatedFrom: limited ? localDateKey(from) : undefined };
  }
  private async read<T>(type: HealthDataType, range: DateRange, pick: (w: ReturnType<FakeHealthAdapter['window']>) => T): Promise<ReadResult<T>> {
    const blocked = await this.gate(type, 'read');
    if (blocked) return blocked;
    const w = this.window(type, range);
    return { status: 'ok', data: pick(w), ...(w.truncatedFrom ? { truncatedFrom: w.truncatedFrom } : {}) };
  }

  readSteps(range: DateRange) { return this.read('steps', range, (w) => this.steps.filter((s) => s.date >= w.from)); }
  readSleep(range: DateRange) { return this.read('sleep', range, (w) => this.sleep.filter((s) => s.date >= w.from)); }
  readWeight(range: DateRange) { return this.read('weight', range, (w) => this.weights.filter((r) => new Date(r.measuredAt) >= w.start)); }
  readWorkouts(range: DateRange) { return this.read('workouts', range, (w) => this.workouts.filter((r) => new Date(r.start) >= w.start)); }

  seedWeight(reading: WeightReading) { this.weights.push(reading); this.log.push({ upsert: reading }); }
  deleteWeight(id: string) { this.weights = this.weights.filter((r) => r.id !== id); this.log.push({ deletedId: id }); }

  async readChanges(type: 'weight' | 'workouts', cursor: string | null): Promise<ChangesResult<WeightReading | Workout>> {
    const blocked = await this.gate(type, 'read');
    if (blocked) return blocked;
    if (type !== 'weight') return { status: 'ok', data: { upserts: [], deletedIds: [], cursor: '0', hasMore: false } };
    const from = cursor === null ? 0 : Number(cursor);
    if (!Number.isInteger(from) || from < 0 || from > this.log.length) return { status: 'cursor-expired' };
    const slice = this.log.slice(from);
    const data: ChangeBatch<WeightReading> = {
      upserts: slice.flatMap((c) => (c.upsert ? [c.upsert] : [])), deletedIds: slice.flatMap((c) => (c.deletedId ? [c.deletedId] : [])),
      cursor: String(this.log.length), hasMore: false,
    };
    return { status: 'ok', data };
  }

  async write(request: WriteRequest): Promise<WriteResult> {
    const blocked = await this.gate(request.payload.type, 'write');
    if (blocked) return blocked as WriteResult;
    const key = `${request.payload.type}:${request.recordId}`;
    const previous = this.written.get(key);
    // Same record id with the same or an older version replaces nothing and adds nothing.
    if (previous && previous.version >= request.version) return { status: 'ok', sampleId: previous.sampleId };
    const sampleId = previous?.sampleId ?? makeSampleId(this.platform, `own-${this.next++}`);
    this.written.set(key, { version: request.version, sampleId });
    if (request.payload.type === 'weight') {
      this.weights = this.weights.filter((r) => r.id !== sampleId);
      const reading: WeightReading = { id: sampleId, measuredAt: request.payload.measuredAt, kg: request.payload.kg, provenance: { origin: 'this-app', recording: 'manual' } };
      this.weights.push(reading);
      this.log.push({ upsert: reading });
    }
    return { status: 'ok', sampleId };
  }
  async remove(type: HealthDataType, recordId: string): Promise<WriteResult> {
    const blocked = await this.gate(type, 'write');
    if (blocked) return blocked as WriteResult;
    const known = this.written.get(`${type}:${recordId}`);
    if (known) {
      this.written.delete(`${type}:${recordId}`);
      if (type === 'weight') this.deleteWeight(known.sampleId);
    }
    return { status: 'ok', sampleId: null };
  }
}
