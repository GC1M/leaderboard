import { localDateKey, startOfLocalDay } from './dates';
import { EXCLUDE_OWN_EXPORTS, isOwnExport } from './export-metadata';
import { HEALTH_TYPES, loadHealthKit, type HealthMetric } from './healthkit';
import { summarizeSleep } from './sleep';
import { normalizeWeight, readLatestWeight } from './weight';

export type StoredSample = { id: string; start: string; end: string; value: number; dates?: string[] };
export type ChangePage = { samples: StoredSample[]; deleted: string[]; anchor: string; hasMore: boolean };
export type DailyChange = { date: string; value: number; window_start?: string; window_end?: string };
export type HealthChanges = { daily: DailyChange[]; removeDaily: string[]; weight: { measured_at: string; kg: number }[]; removeWeight: string[] };
export type JournalState = { from: string; anchor?: string; samples: StoredSample[]; dailyKeys?: string[]; resetAfterPending?: boolean; pending?: { anchor: string; changes: HealthChanges; hasMore: boolean } };
export interface HealthJournal { read(metric: HealthMetric): Promise<JournalState | null>; write(metric: HealthMetric, state: JournalState): Promise<void> }
export const CHANGE_PAGE_SIZE = 500;

export async function queryChanges(metric: HealthMetric, state: JournalState): Promise<ChangePage> {
  const hk = loadHealthKit();
  if (!hk) throw new Error('Apple Health requires a native iPhone build.');
  // Keep this lower bound fixed for the lifetime of an anchor; moving query predicates loses changes.
  // Weight is unbounded so old readings/deletions are included, but each native page is bounded.
  const options = { limit: CHANGE_PAGE_SIZE, anchor: state.anchor, ...(metric !== 'weight' ? { filter: { date: { startDate: new Date(state.from) } } } : {}) };
  const page = metric === 'sleep'
    ? await hk.queryCategorySamplesWithAnchor(HEALTH_TYPES.sleep, options)
    : await hk.queryQuantitySamplesWithAnchor(HEALTH_TYPES[metric], { ...options, unit: metric === 'weight' ? 'kg' : 'count' });
  // Samples this app exported are never imported back. Filtered here, not in the anchored query, because a query predicate must stay fixed for an anchor.
  const samples = page.samples.filter((s) => !isOwnExport(s.metadata)).map((s): StoredSample => ({
    id: s.uuid, start: s.startDate.toISOString(), end: s.endDate.toISOString(),
    value: 'value' in s ? s.value : s.quantity,
  }));
  return { samples, deleted: page.deletedSamples.map((s) => s.uuid), anchor: page.newAnchor,
    hasMore: page.samples.length + page.deletedSamples.length >= CHANGE_PAGE_SIZE };
}

// End is exclusive when crossing midnight, so a sample ending at midnight doesn't affect tomorrow.
export function sampleDates(sample: StoredSample): string[] {
  if (sample.dates) return sample.dates;
  const start = new Date(sample.start), end = new Date(sample.end);
  const stop = Math.max(start.getTime(), end.getTime() - 1);
  const dates: string[] = [];
  for (let d = startOfLocalDay(start); d.getTime() <= stop; d = startOfLocalDay(d, -1)) dates.push(localDateKey(d));
  return dates;
}

export function mergeSamples(previous: readonly StoredSample[], page: ChangePage): StoredSample[] {
  const next = new Map(previous.map((s) => [s.id, s]));
  for (const id of page.deleted) next.delete(id);
  for (const sample of page.samples) {
    if (!sample.id || !Number.isFinite(Date.parse(sample.start)) || !Number.isFinite(Date.parse(sample.end)) ||
      Date.parse(sample.end) < Date.parse(sample.start) || !Number.isFinite(sample.value) || sample.value < 0) throw new Error('Invalid Health change.');
    next.set(sample.id, { ...sample, dates: sampleDates(sample) });
  }
  return [...next.values()];
}

export async function deriveChanges(metric: HealthMetric, previous: readonly StoredSample[], next: readonly StoredSample[], page: ChangePage): Promise<HealthChanges> {
  const changes: HealthChanges = { daily: [], removeDaily: [], weight: [], removeWeight: [] };
  // No additions or explicit tombstones means no destructive inference, even if permissions changed.
  if (!page.samples.length && !page.deleted.length) return changes;
  if (metric === 'sleep') {
    const summarize = (samples: readonly StoredSample[]) => summarizeSleep(samples.map((s) => ({ uuid: s.id, startDate: new Date(s.start), endDate: new Date(s.end), value: s.value })));
    const before = summarize(previous), after = summarize(next);
    changes.daily = after.map((d) => ({ date: d.date, value: d.value, window_start: d.windowStart, window_end: d.windowEnd }));
    changes.removeDaily = before.filter((d) => !after.some((n) => n.date === d.date)).map((d) => d.date);
  } else if (metric === 'weight') {
    const normalize = (samples: readonly StoredSample[]) => normalizeWeight(samples.map((s) => ({ uuid: s.id, startDate: new Date(s.start), quantity: s.value, unit: 'kg' })));
    const before = normalize(previous), after = normalize(next);
    changes.weight = after.map((r) => ({ measured_at: r.measuredAt, kg: r.kg }));
    changes.removeWeight = before.filter((r) => !after.some((n) => n.measuredAt === r.measuredAt)).map((r) => r.measuredAt);
  } else {
    const changedIds = new Set([...page.deleted, ...page.samples.map((s) => s.id)]);
    const affected = new Set([...previous.filter((s) => changedIds.has(s.id)), ...page.samples].flatMap(sampleDates));
    const remaining = new Set(next.flatMap(sampleDates));
    const hk = loadHealthKit();
    if (!hk) throw new Error('Health unavailable.');
    for (const date of affected) {
      if (!remaining.has(date)) { changes.removeDaily.push(date); continue; }
      const start = new Date(`${date}T00:00:00`);
      const total = await hk.queryStatisticsForQuantity(HEALTH_TYPES.steps, ['cumulativeSum'], {
        unit: 'count', filter: { date: { startDate: start, endDate: startOfLocalDay(start, -1) }, ...EXCLUDE_OWN_EXPORTS },
      });
      // A missing statistic is ambiguous (e.g. access changed); leave the previous total intact.
      const value = total.sumQuantity?.quantity;
      if (value !== undefined) {
        if (!Number.isFinite(value) || value < 0) throw new Error('Invalid Health step total.');
        changes.daily.push({ date, value: Math.round(value) });
      }
    }
  }
  return changes;
}

export type ReconcileOptions = {
  journal: HealthJournal;
  checkOwner: () => Promise<void>;
  upload: (metric: HealthMetric, changes: HealthChanges) => Promise<void>;
  query?: typeof queryChanges;
  maxPages?: number;
  now?: Date;
};

// Write-ahead journal: commit the proposed snapshot + exact upload before sending it. Advance the
// native cursor only after remote success. Crash/network retry replays the same idempotent payload.
export async function reconcileHealth(metric: HealthMetric, options: ReconcileOptions): Promise<{ hasMore: boolean; written: number; knownSamples: number }> {
  const { journal, checkOwner, upload } = options;
  await checkOwner();
  const now = options.now ?? new Date();
  let state = await journal.read(metric) ?? { from: startOfLocalDay(now, metric === 'sleep' ? 91 : 89).toISOString(), samples: [] };
  let written = 0;
  for (let i = 0; i < (options.maxPages ?? 3); i++) {
    await checkOwner();
    if (!state.pending) {
      const page = await (options.query ?? queryChanges)(metric, state);
      await checkOwner();
      // Seed the latest weight independently of the import cursor, which starts with old samples.
      if (metric === 'weight' && !state.anchor && !options.query) {
        const latest = await readLatestWeight(now);
        if (latest) page.samples.push({ id: latest.sampleId, start: latest.measuredAt, end: latest.measuredAt, value: latest.kg });
      }
      const next = mergeSamples(state.samples, page);
      const changes = await deriveChanges(metric, state.samples, next, page);
      const changed = page.samples.length > 0 || page.deleted.length > 0;
      if (metric === 'sleep' && changed && state.dailyKeys) {
        const nextKeys = new Set(changes.daily.map((d) => d.date));
        changes.removeDaily = [...new Set([...changes.removeDaily, ...state.dailyKeys.filter((d) => !nextKeys.has(d))])];
      }
      await checkOwner();
      state = { ...state, samples: next, ...(metric === 'sleep' && changed ? { dailyKeys: changes.daily.map((d) => d.date) } : {}), pending: { anchor: page.anchor, changes, hasMore: page.hasMore } };
      await journal.write(metric, state);
    }
    await checkOwner();
    const pending = state.pending!;
    await upload(metric, pending.changes);
    await checkOwner();
    written += pending.changes.daily.length + pending.changes.weight.length + pending.changes.removeDaily.length + pending.changes.removeWeight.length;
    // Never advance an empty initial read: newly granted access must still import historical data.
    const recheck = state.resetAfterPending;
    state = { ...state, anchor: recheck ? undefined : state.samples.length || state.anchor || pending.changes.removeDaily.length || pending.changes.removeWeight.length ? pending.anchor : state.anchor, pending: undefined, resetAfterPending: undefined };
    await journal.write(metric, state);
    if (!pending.hasMore && !recheck) return { hasMore: false, written, knownSamples: state.samples.length };
  }
  return { hasMore: true, written, knownSamples: state.samples.length };
}
