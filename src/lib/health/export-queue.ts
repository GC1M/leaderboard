import type { HealthWriteAccess, HealthWriteType } from './healthkit';

// Device-side queue of app records to write to Apple Health. One entry per (kind, recordId): the newest edit wins.
// An entry stays in the encrypted local store until it succeeds; failures and denied permission never drop it.
// Feature code (workouts, manual measurements) registers a writer per kind and enqueues records.
export type ExportOp = 'save' | 'delete';
export type ExportEntry = {
  kind: string; recordId: string; op: ExportOp;
  payload: unknown; // data the writer needs; cleared once saved so the store keeps only the mapping
  version: number; // becomes HKMetadataKeySyncVersion; higher replaces lower
  status: 'pending' | 'success' | 'failed';
  reason?: 'permission' | 'error';
  attempts: number;
  sampleUuid?: string | null;
  writtenTypes?: number; // bit mask of the sample types a writer with `intent` has written or may have written
  attemptVersion?: number; // last sync version a writer with attemptVersions used, saved before the write so it only grows
};
export interface ExportStore {
  list(): Promise<ExportEntry[]>;
  put(entry: ExportEntry): Promise<void>;
  remove(kind: string, recordId: string): Promise<void>;
  clear(): Promise<void>;
}
export interface ExportWriter {
  writeType: HealthWriteType;
  // For a writer that saves several types (food nutrients), each allowed on its own: the entry exports while any one is granted.
  writeTypes?: readonly HealthWriteType[];
  // HealthKit ignores a save whose sync version is not above the one it holds, and a crash can leave a half-finished
  // write there. This writer's save() reads entry.attemptVersion, which is higher on every attempt.
  attemptVersions?: boolean;
  // Bit mask of the types this save will write. The queue saves it (added to what an earlier save wrote) before the
  // write, so a crash cannot leave samples this entry does not know about, and sets it exactly once the write succeeds.
  intent?(entry: ExportEntry): number;
  // Turning the kind off also drops a delete stuck on a permission the user withdrew (otherwise it waits for a re-grant).
  dropRevokedDeletes?: boolean;
  save(entry: ExportEntry): Promise<string | null>; // must tag the sample with exportMetadata(); returns the Health sample uuid
  remove(entry: ExportEntry): Promise<void>; // must delete only samples this app saved
}
// Server-side record of what this account exported, shared by all its devices.
export interface ExportMapping {
  get(kind: string, recordId: string): Promise<{ syncVersion: number } | null>;
  record(kind: string, recordId: string, sampleUuid: string | null, version: number): Promise<void>;
  remove(kind: string, recordId: string): Promise<void>;
}
export type ExportDependencies = {
  checkAccount: () => Promise<void>;
  store: ExportStore;
  mapping: ExportMapping;
  writers: Record<string, ExportWriter | undefined>;
  access: (type: HealthWriteType) => HealthWriteAccess;
};
export type ExportState = { ready: boolean; processing: boolean; entries: ExportEntry[]; pending: number; failed: number };
export const initialExportState = (): ExportState => ({ ready: false, processing: false, entries: [], pending: 0, failed: 0 });

// Feature code adds its writer once at startup.
export const exportWriters: Record<string, ExportWriter | undefined> = {};
export const registerExportWriter = (kind: string, writer: ExportWriter) => { exportWriters[kind] = writer; };

const same = (a: ExportEntry, b: ExportEntry) => a.kind === b.kind && a.recordId === b.recordId;

// One queue per signed-in account. stop() (sign-out, account switch) invalidates any run in flight.
export function createExportQueue(deps: ExportDependencies) {
  let state = initialExportState();
  let alive = true, epoch = 0;
  let flight: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const emit = (entries: ExportEntry[], patch: Partial<ExportState> = {}) => {
    if (!alive) return;
    state = { ...state, ...patch, entries, pending: entries.filter((e) => e.status === 'pending').length, failed: entries.filter((e) => e.status === 'failed').length };
    listeners.forEach((f) => f());
  };
  const account = async (token: number) => {
    if (!alive || epoch !== token) throw new Error('Health account changed.');
    await deps.checkAccount();
    if (!alive || epoch !== token) throw new Error('Health account changed.');
  };
  // True while the entry being worked on is still the newest edit; an enqueue during a run supersedes it.
  const current = (entry: ExportEntry) => state.entries.some((e) => same(e, entry) && e.version === entry.version);
  const update = async (entry: ExportEntry, patch: Partial<ExportEntry>, token: number) => {
    const next = { ...entry, ...patch };
    await account(token);
    if (!current(entry)) return;
    await deps.store.put(next);
    emit(state.entries.map((e) => (same(e, next) ? next : e)));
  };
  const run = async (entry: ExportEntry, token: number) => {
    const writer = deps.writers[entry.kind];
    if (!writer) return update(entry, { status: 'failed', reason: 'error' }, token);
    if (!(writer.writeTypes ?? [writer.writeType]).some((t) => deps.access(t) === 'granted')) return update(entry, { status: 'failed', reason: 'permission' }, token);
    let attempt = entry.attemptVersion;
    let written = entry.writtenTypes;
    try {
      await account(token);
      if (entry.op === 'delete') {
        await writer.remove(entry);
        await account(token);
        await deps.mapping.remove(entry.kind, entry.recordId);
        await account(token);
        if (current(entry)) {
          await deps.store.remove(entry.kind, entry.recordId);
          emit(state.entries.filter((e) => !same(e, entry)));
        }
        return;
      }
      // Another device already wrote this version (or newer): nothing to write, just record success.
      const known = await deps.mapping.get(entry.kind, entry.recordId);
      await account(token);
      const done = known !== null && known.syncVersion >= entry.version;
      let uuid = entry.sampleUuid ?? null;
      if (!done) {
        if (writer.attemptVersions) attempt = Math.max(entry.version, (entry.attemptVersion ?? 0) + 1, Date.now());
        const intended = writer.intent?.(entry);
        if (intended !== undefined) written = (entry.writtenTypes ?? 0) | intended;
        if (writer.attemptVersions || intended !== undefined) await update(entry, { attemptVersion: attempt, writtenTypes: written }, token);
        uuid = await writer.save({ ...entry, attemptVersion: attempt, writtenTypes: written });
        if (intended !== undefined) written = intended;
      }
      await account(token);
      // A failure after the save retries with the same sync identifier and version, which replaces rather than duplicates.
      if (!done) await deps.mapping.record(entry.kind, entry.recordId, uuid, entry.version);
      await update(entry, { status: 'success', reason: undefined, payload: null, sampleUuid: uuid, attemptVersion: attempt, writtenTypes: written }, token);
    } catch (e) {
      if (!alive || epoch !== token) throw e;
      // A writer can say a type it wrote earlier is no longer allowed, which only the user can fix.
      await update(entry, { status: 'failed', reason: (e as { reason?: string }).reason === 'permission' ? 'permission' : 'error', attempts: entry.attempts + 1, attemptVersion: attempt, writtenTypes: written }, token);
    }
  };
  // ponytail: failed entries retry on every process() call (launch, foreground, enqueue), no backoff timer.
  const process = (): Promise<void> => {
    if (flight) return flight;
    if (!alive || !state.ready) return Promise.resolve();
    const token = epoch;
    emit(state.entries, { processing: true });
    const todo = async () => {
      // Re-scan each time so an entry enqueued mid-run is picked up; each version is tried once per run.
      const tried = new Set<string>();
      for (;;) {
        const next = state.entries.find((e) => e.status !== 'success' && !tried.has(`${e.kind}:${e.recordId}:${e.version}`));
        if (!next) return;
        tried.add(`${next.kind}:${next.recordId}:${next.version}`);
        await run(next, token);
      }
    };
    flight = todo().catch(() => {}).finally(() => { flight = null; emit(state.entries, { processing: false }); });
    return flight;
  };
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async initialize() {
      alive = true;
      const token = ++epoch;
      try {
        const entries = await deps.store.list();
        await account(token);
        emit(entries, { ready: true });
      } catch { /* A stale account or unreadable store leaves the queue not ready. */ }
    },
    async enqueue(kind: string, recordId: string, op: ExportOp, payload: unknown, version: number = Date.now()) {
      await account(epoch);
      const previous = state.entries.find((e) => e.kind === kind && e.recordId === recordId);
      if (previous && previous.version >= version) return; // duplicate or stale edit
      const entry: ExportEntry = { kind, recordId, op, payload, version, status: 'pending', attempts: 0, sampleUuid: previous?.sampleUuid, attemptVersion: previous?.attemptVersion, writtenTypes: previous?.writtenTypes };
      await deps.store.put(entry);
      emit([...state.entries.filter((e) => e !== previous), entry]);
      return process();
    },
    process,
    // The user turned exports off for this kind: drop saves that haven't reached Health. Deletes stay so
    // earlier exports are still cleaned up, except (for writers that say so) one stuck on a permission the user withdrew.
    async discard(kind: string) {
      if (flight) await flight;
      const drop = state.entries.filter((e) => e.kind === kind && e.status !== 'success' && (e.op === 'save' || (e.reason === 'permission' && deps.writers[kind]?.dropRevokedDeletes)));
      for (const e of drop) await deps.store.remove(e.kind, e.recordId);
      emit(state.entries.filter((e) => !drop.includes(e)));
    },
    // Account deletion: drop everything queued locally.
    async clear() {
      const token = ++epoch;
      if (flight) await flight;
      await deps.store.clear();
      if (alive && epoch === token) emit([]);
    },
    stop() { alive = false; epoch++; listeners.clear(); },
  };
}
export type ExportQueue = ReturnType<typeof createExportQueue>;
