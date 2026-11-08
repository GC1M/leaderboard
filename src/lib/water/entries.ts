// Water intake (#55, #56, #57). Manual entries are saved on this device first and synced through the shared pending
// queue (so logging works offline); imported Apple Health samples arrive through the Health sync. A day with no entries
// has no total: never show it as 0 mL.
import { healthProviderName } from '@/lib/health-adapter/capabilities';
import * as Crypto from 'expo-crypto';

import type { Tables } from '@/lib/database.types';
import { dateInZone } from '@/lib/health/dates';
import { bumpWaterSyncGeneration } from '@/lib/health/water-export';
import { createPendingQueue, type PendingOp } from '@/lib/pending-queue';
import { supabase } from '@/lib/supabase';
import { deviceTimezone } from '@/lib/timezone';

import { MAX_ENTRY_ML } from './units';

export const waterQueue = createPendingQueue('water_entries', 'water-pending');

export type WaterEntry = {
  id: string | null; // null until the server has it
  clientId: string | null; // null for imported entries
  source: 'manual' | 'healthkit';
  sourceName: string | null; // the app or device Health says recorded it
  ml: number;
  consumedAt: string;
  timezone: string;
  localDate: string;
  pending: 'log' | 'edit' | null;
  syncError: string | null;
  updatedAt: string | null; // server row version, used as the Apple Health export version
};

type Row = Partial<Tables<'water_entries'>>;

export function entryFromRow(r: Row, pending: WaterEntry['pending'] = null, syncError: string | null = null): WaterEntry {
  return {
    id: r.id ?? null,
    clientId: r.client_id ?? null,
    source: r.source === 'healthkit' ? 'healthkit' : 'manual',
    sourceName: r.source_name ?? null,
    ml: Number(r.ml),
    consumedAt: r.consumed_at as string,
    timezone: r.timezone as string,
    // The server sets local_date from the entry's own zone; an entry it has not seen yet gets the same day here.
    localDate: r.local_date ?? dateInZone(new Date(r.consumed_at as string), r.timezone),
    pending,
    syncError,
    updatedAt: r.updated_at ?? null,
  };
}

// Server rows with queued edits applied and queued purges hidden, plus queued logs the server does not have yet.
export function mergePending(allRows: Row[], ops: PendingOp[]): WaterEntry[] {
  const purged = new Set(ops.flatMap((o) => (o.kind === 'purge' ? [o.clientId] : [])));
  const rows = allRows.filter((r) => !r.client_id || !purged.has(r.client_id));
  const out = rows.map((r) => {
    const op = ops.find((o) => o.kind === 'edit' && o.id === r.id);
    if (op?.kind !== 'edit') return entryFromRow(r);
    const zone = (op.patch.timezone as string | undefined) ?? r.timezone;
    const moved = typeof op.patch.consumed_at === 'string' ? { local_date: dateInZone(new Date(op.patch.consumed_at), zone) } : {};
    return entryFromRow({ ...r, ...op.patch, ...moved }, 'edit', op.error ?? null);
  });
  const have = new Set(rows.map((r) => r.client_id));
  for (const op of ops) if (op.kind === 'log' && !have.has(op.clientId)) out.push(entryFromRow({ ...(op.row as Row), client_id: op.clientId }, 'log', op.error ?? null));
  return out.sort((a, b) => a.consumedAt.localeCompare(b.consumedAt));
}

function checkAmount(ml: number) {
  if (!Number.isFinite(ml) || ml <= 0 || ml > MAX_ENTRY_ML) throw new Error(`Enter an amount above 0 and up to ${MAX_ENTRY_ML} mL.`);
}
function checkTime(at: Date, now = new Date()) {
  if (!Number.isFinite(at.getTime())) throw new Error('Choose a valid time.');
  if (at.getTime() > now.getTime() + 60_000) throw new Error('Choose a time that is not in the future.');
}

async function currentUser(): Promise<string> {
  // The stored session, not a network call, so logging works offline.
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error('Sign in to log water.');
  return data.session.user.id;
}

// Saves on this device, then syncs. Resolves to true when the server has it; false means it waits on this device.
export async function logWater(ml: number, at: Date = new Date(), clientId: string = Crypto.randomUUID()): Promise<boolean> {
  checkAmount(ml);
  checkTime(at);
  const uid = await currentUser();
  await waterQueue.enqueue(uid, { kind: 'log', clientId, row: { source: 'manual', ml, consumed_at: at.toISOString(), timezone: deviceTimezone() } });
  return (await waterQueue.flushPending(uid)) === 0;
}

export type WaterEdit = { ml?: number; consumedAt?: Date };

export function buildEdit(entry: WaterEntry, input: WaterEdit): Record<string, unknown> {
  if (entry.source !== 'manual') throw new Error('Water from Apple Health can only be changed in the Health app.');
  const patch: Record<string, unknown> = {};
  if (input.ml !== undefined) {
    checkAmount(input.ml);
    if (input.ml !== entry.ml) patch.ml = input.ml;
  }
  if (input.consumedAt) {
    checkTime(input.consumedAt);
    // The picked time is on this device's clock, so the entry takes this device's zone.
    if (input.consumedAt.toISOString() !== new Date(entry.consumedAt).toISOString()) Object.assign(patch, { consumed_at: input.consumedAt.toISOString(), timezone: deviceTimezone() });
  }
  return patch;
}

// Saves an edit on this device first, then syncs. Resolves to true when the server has it.
export async function saveWaterEdit(uid: string, entry: WaterEntry, input: WaterEdit): Promise<boolean> {
  const patch = buildEdit(entry, input);
  if (Object.keys(patch).length === 0) return true;
  if (entry.id) await waterQueue.enqueue(uid, { kind: 'edit', id: entry.id, patch });
  else {
    const op = (await waterQueue.loadPending(uid)).find((o) => o.kind === 'log' && o.clientId === entry.clientId);
    if (op?.kind === 'log') await waterQueue.enqueue(uid, { ...op, row: { ...op.row, ...patch } });
    else {
      // The log is no longer queued, so a flush uploaded it meanwhile: edit the row it made.
      const { data, error } = await supabase.from('water_entries').select('id').eq('client_id', entry.clientId!).maybeSingle();
      if (error) throw new Error("Couldn't save that entry. Try again.");
      if (!data) throw new Error('This entry changed. Reload it.');
      await waterQueue.enqueue(uid, { kind: 'edit', id: data.id, patch });
    }
  }
  return (await waterQueue.flushPending(uid)) === 0;
}

// Same rules as food: a synced entry is deleted on the server (online); one that never showed as synced is removed
// here at once and a queued purge deletes any copy a send in flight made. `onRemoved` queues the Health delete.
export async function removeWater(uid: string, entry: WaterEntry, onRemoved?: (id: string) => Promise<void>): Promise<void> {
  if (entry.source !== 'manual' || !entry.clientId) throw new Error('Water from Apple Health can only be deleted in the Health app.');
  if (!entry.id) {
    const found = onRemoved ? await supabase.from('water_entries').select('id').eq('client_id', entry.clientId).maybeSingle().then((r) => r.data?.id ?? null, () => null) : null;
    await waterQueue.enqueue(uid, { kind: 'purge', clientId: entry.clientId });
    await waterQueue.discard(uid, { kind: 'log', clientId: entry.clientId, row: {} });
    if (found) await onRemoved?.(found);
    await waterQueue.flushPending(uid).catch(() => 0);
    return;
  }
  const { error } = await supabase.from('water_entries').delete().eq('id', entry.id);
  if (error) throw new Error("Couldn't delete that entry. A connection is needed to delete. Try again.");
  await onRemoved?.(entry.id);
  await waterQueue.discard(uid, { kind: 'edit', id: entry.id, patch: {} });
  await waterQueue.discard(uid, { kind: 'log', clientId: entry.clientId, row: {} });
}

export async function discardPendingWater(uid: string, entry: WaterEntry): Promise<void> {
  if (entry.id) await waterQueue.discard(uid, { kind: 'edit', id: entry.id, patch: {} });
  else if (entry.clientId) await waterQueue.discard(uid, { kind: 'log', clientId: entry.clientId, row: {} });
}

// One local day's entries, server rows plus what waits on this device. If the server cannot be reached the queued
// entries still show, with an error.
export async function loadWaterDay(uid: string, date: string): Promise<{ entries: WaterEntry[]; error: string | null; waiting: { count: number; error: string | null } }> {
  const ops = await waterQueue.loadPending(uid);
  const { data, error } = await supabase.from('water_entries').select('*').eq('local_date', date).order('consumed_at');
  let rows: Row[] = error ? [] : (data ?? []);
  const have = new Set(rows.map((r) => r.id));
  const moved = ops.flatMap((o) => (o.kind === 'edit' && typeof o.patch.consumed_at === 'string' && dateInZone(new Date(o.patch.consumed_at), o.patch.timezone as string | undefined) === date && !have.has(o.id) ? [o.id] : []));
  if (!error && moved.length) rows = [...rows, ...((await supabase.from('water_entries').select('*').in('id', moved)).data ?? [])];
  return {
    entries: mergePending(rows, ops).filter((e) => e.localDate === date),
    error: error ? "Couldn't load your water. Pull down to try again." : null,
    waiting: { count: ops.length, error: ops.find((o) => o.error)?.error ?? null },
  };
}

// A day's total, or null when it has no entries (no data, not 0 mL).
export const dayTotal = (entries: readonly WaterEntry[]): number | null => (entries.length ? entries.reduce((s, e) => s + e.ml, 0) : null);

export type WaterDayTotal = { date: string; entries: number; totalMl: number; manualMl: number; healthMl: number; lastEntryAt: string | null; healthReceivedAt: string | null };

// Daily totals from the server, grouped by each entry's own local_date. Days with no entries are absent.
export async function getWaterTotals(from: string, to: string): Promise<WaterDayTotal[]> {
  const { data, error } = await supabase.rpc('water_daily_totals', { p_from: from, p_to: to });
  if (error) throw new Error("Couldn't load your water history. Try again.");
  return data.map((d) => ({
    date: d.local_date, entries: d.entries, totalMl: Number(d.total_ml), manualMl: Number(d.manual_ml), healthMl: Number(d.health_ml),
    lastEntryAt: d.last_entry_at ?? null, healthReceivedAt: d.health_received_at ?? null,
  }));
}

export async function hasWaterEntries(): Promise<boolean> {
  const { data, error } = await supabase.from('water_entries').select('id').limit(1);
  if (error) throw new Error("Couldn't load your water history. Try again.");
  return data.length > 0;
}

// Optional personal target. null means none: the app never suggests one.
export async function getWaterTarget(): Promise<number | null> {
  const { data, error } = await supabase.from('water_targets').select('daily_ml').maybeSingle();
  if (error) throw new Error("Couldn't load your water target.");
  return data ? Number(data.daily_ml) : null;
}

export async function setWaterTarget(uid: string, dailyMl: number | null): Promise<void> {
  if (dailyMl === null) {
    const { error } = await supabase.from('water_targets').delete().eq('user_id', uid);
    if (error) throw new Error("Couldn't clear your target. Try again.");
    return;
  }
  if (!Number.isFinite(dailyMl) || dailyMl <= 0 || dailyMl > 20000) throw new Error('Enter a target above 0 and up to 20 L.');
  const { error } = await supabase.from('water_targets').upsert({ user_id: uid, daily_ml: dailyMl });
  if (error) throw new Error("Couldn't save your target. Try again.");
}

// Deletes every water entry (manual and imported), the target and the export mapping on the server, and the water
// changes waiting on this device.
// Same order as food: a flush in flight may save an entry after the first delete, so delete again once the queue is empty.
export async function deleteWaterHistory(uid: string): Promise<void> {
  const del = async () => {
    const { error } = await supabase.rpc('delete_my_water_history');
    if (error) throw new Error("Couldn't delete your water history. Check your connection and try again.");
  };
  bumpWaterSyncGeneration(); // an export sync that read rows before this must not queue from them
  try {
    await del();
    await waterQueue.clear(uid);
    await del();
  } finally {
    bumpWaterSyncGeneration();
  }
}

export const sourceLabel = (e: WaterEntry) => (e.source === 'manual' ? 'Added here' : `From ${healthProviderName()}${e.sourceName ? ` · ${e.sourceName}` : ''}`);
