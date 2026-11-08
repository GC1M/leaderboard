import { supabase } from '@/lib/supabase';

import { localDateKey, startOfLocalDay } from './dates';
import { exportMetadata } from './export-metadata';
import { healthProviderName } from '@/lib/health-adapter/capabilities';

import { neverWritten, registerExportWriter, type ExportEntry, type ExportWriter } from './export-queue';
import { loadHealthKit, removeExportedSample } from './healthkit';

// Water logged in this app that the user chose to also save to Apple Health (#56). recordId is the `water_entries.id`,
// which never changes when an entry is edited. Each entry is one dietary water sample in mL at the time it was drunk.
// Only manual rows are exported: water imported from Health (source 'healthkit') is never written back.
export const WATER_KIND = 'water';
export const WATER_TYPE = 'HKQuantityTypeIdentifierDietaryWater' as const;
export const EXPORT_DAYS = 90; // how far back synced entries are exported

export type WaterPayload = { ml: number; at: string };
export type WaterRow = { id: string; updated_at: string; consumed_at: string; ml: number | string };

// The export version of a row: updated_at in ms, which moves on every edit, so an edit is saved again.
export const waterVersion = (updatedAt: string | null | undefined) => {
  const ms = updatedAt ? Date.parse(updatedAt) : NaN;
  return Number.isFinite(ms) ? ms : null;
};

// A delete must beat every earlier version of that entry, whatever this device's clock says.
export const waterDeleteVersion = (known: readonly ExportEntry[], id: string, now = Date.now()) => {
  const prev = known.find((e) => e.kind === WATER_KIND && e.recordId === id);
  return prev ? Math.max(now, prev.version + 1) : null;
};

export { neverWritten };

// Saves that reached Health, or may have (an attempt was made).
export const exportedWater = (entries: readonly ExportEntry[]) => entries.filter((e) => e.kind === WATER_KIND && e.op === 'save' && (e.status === 'success' || e.attemptVersion !== undefined));

// Bumped when water is being settled or deleted. A sync that read the rows before such a change queues nothing from them.
let syncGeneration = 0;
export const waterSyncGeneration = () => syncGeneration;
export const bumpWaterSyncGeneration = () => { syncGeneration++; };

// What the user chooses for water this app saved to Apple Health when its link to Health ends (turning the export off,
// deleting water history or the account), as for food (see settleFoodExport). "Remove" queues a delete for every water
// save; "Keep" forgets every water save without writing, so nothing later removes them. Queued deletes are left to finish.
export type WaterExportControls = {
  getEntries(): ExportEntry[];
  enqueue(kind: string, recordId: string, op: 'save' | 'delete', payload: unknown, version?: number): Promise<unknown>;
  forget(kind: string, match?: (e: ExportEntry) => boolean): Promise<unknown>;
};

// Takes one entry out of Health: queues a delete for a save that reached Health (or may have), and forgets one that
// was never attempted, since there is nothing to delete and the delete would only wait on write access.
export async function removeWaterExport(exp: WaterExportControls, id: string): Promise<void> {
  const prev = exp.getEntries().find((e) => e.kind === WATER_KIND && e.recordId === id);
  if (!prev) return;
  if (neverWritten(prev)) {
    // forget waits for a write in flight, which may write this entry before stamping it, so it re-checks then.
    await exp.forget(WATER_KIND, (e) => e.recordId === id && neverWritten(e));
    if (!exp.getEntries().some((e) => e.kind === WATER_KIND && e.recordId === id)) return;
  }
  await exp.enqueue(WATER_KIND, id, 'delete', null, waterDeleteVersion(exp.getEntries(), id)!);
}

export async function settleWaterExport(exp: WaterExportControls, removeFromHealth: boolean): Promise<void> {
  bumpWaterSyncGeneration();
  try {
    if (!removeFromHealth) return void (await exp.forget(WATER_KIND, (e) => e.op === 'save'));
    for (const e of exp.getEntries().filter((x) => x.kind === WATER_KIND && x.op === 'save')) {
      await removeWaterExport(exp, e.recordId);
    }
    // A delete still queued did not finish: say so instead of claiming the water is gone from Health.
    if (exp.getEntries().some((e) => e.kind === WATER_KIND && e.op === 'delete')) throw new Error(`Couldn't remove some water from ${healthProviderName()}. Allow water in Health and try again, or keep it in Health.`);
  } finally {
    bumpWaterSyncGeneration();
  }
}

// Synced manual entries of the last EXPORT_DAYS days: an entry still waiting to sync has no id and is never in it.
export async function fetchRecentWaterRows(now = new Date()): Promise<WaterRow[]> {
  const { data, error } = await supabase.from('water_entries').select('id,updated_at,consumed_at,ml').eq('source', 'manual').gte('local_date', localDateKey(startOfLocalDay(now, EXPORT_DAYS - 1)));
  if (error) throw new Error(`Couldn't load your water to save to ${healthProviderName()}.`);
  return data as WaterRow[];
}

// The rows not already queued at their version: the whole idempotency of the backfill.
export function pendingWaterSaves(rows: readonly WaterRow[], known: readonly ExportEntry[]) {
  return rows.flatMap((r) => {
    const version = waterVersion(r.updated_at);
    const ml = Number(r.ml);
    if (version === null || !r.id || !Number.isFinite(ml) || !Number.isFinite(Date.parse(r.consumed_at))) return [];
    const k = known.find((e) => e.kind === WATER_KIND && e.recordId === r.id && e.op === 'save');
    if (k && k.version >= version) return [];
    return [{ id: r.id, version, payload: { ml, at: new Date(r.consumed_at).toISOString() } as WaterPayload }];
  });
}

// Exported entries whose server row is gone (deleted on another device, or the app stopped before its delete was queued).
// Recent exports missing from the fetched rows are checked on the server by id, so a row merely outside the window stays.
export async function deletedWaterIds(rows: readonly { id: string }[], known: readonly ExportEntry[], now = Date.now()): Promise<string[]> {
  const have = new Set(rows.map((r) => r.id));
  const since = now - EXPORT_DAYS * 86400000;
  const ids = known.filter((e) => e.kind === WATER_KIND && e.op === 'save' && e.version >= since && !have.has(e.recordId)).map((e) => e.recordId);
  const gone: string[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const { data, error } = await supabase.from('water_entries').select('id').in('id', chunk);
    if (error) throw new Error(`Couldn't check your water against ${healthProviderName()}.`);
    const found = new Set(data.map((r) => r.id));
    gone.push(...chunk.filter((id) => !found.has(id)));
  }
  return gone;
}

export const waterWriter: ExportWriter = {
  writeType: WATER_TYPE,
  attemptVersions: true,
  dropRevokedDeletes: true,
  async save(e) {
    const hk = loadHealthKit();
    if (!hk) throw new Error('Apple Health requires a native iPhone build.');
    const p = e.payload as WaterPayload;
    const at = new Date(p.at);
    // The sync version is the attempt version, above every earlier attempt, so a retry or edit replaces the old sample.
    const sample = await hk.saveQuantitySample(WATER_TYPE, 'mL', p.ml, at, at, exportMetadata(e.kind, e.recordId, e.attemptVersion ?? e.version) as never);
    return sample?.uuid ?? null;
  },
  // HealthKit only lets an app delete its own samples; this matches our record key.
  remove: (e) => removeExportedSample(WATER_TYPE, e.kind, e.recordId),
};

// Registered at import so a queued entry retries after restart without opening the water screen.
registerExportWriter(WATER_KIND, waterWriter);
