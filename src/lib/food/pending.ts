// Food logs and edits that have not reached the server yet (#47). Each one is saved on this device before the
// network is tried, so an interruption or a failed sync never loses what the user entered, and is retried
// until it succeeds or the user discards it. Same storage and write ordering as the workout drafts.
import { orderedDraftWrite } from '@/lib/ordered-draft-write';
import { secureStorage } from '@/lib/secure-storage';
import { supabase } from '@/lib/supabase';

type Cols = Record<string, unknown>;
// A log is the full row (upserted on client_id, so a retry never makes a second entry). An edit is the changed
// columns of an existing entry (one UPDATE, so grams, portion and nutrients always change together).
export type PendingOp = { kind: 'log'; clientId: string; row: Cols; error?: string } | { kind: 'edit'; id: string; patch: Cols; error?: string };

const key = (uid: string) => `food-pending-${uid}`;
const opKey = (o: PendingOp) => (o.kind === 'log' ? `log:${o.clientId}` : `edit:${o.id}`);
const same = (a: PendingOp, b: PendingOp) => opKey(a) === opKey(b);
const content = (o: PendingOp) => JSON.stringify(o.kind === 'log' ? o.row : o.patch);
export const SYNC_FAILED = "Couldn't sync. Check your connection and retry.";

export async function loadPending(uid: string): Promise<PendingOp[]> {
  try {
    const v: unknown = JSON.parse((await secureStorage.getItem(key(uid))) ?? '[]');
    return Array.isArray(v) ? v.filter((o) => o && (o.kind === 'log' ? typeof o.clientId === 'string' : o.kind === 'edit' && typeof o.id === 'string')) : [];
  } catch {
    return [];
  }
}

// Read-modify-write on the per-account queue, so concurrent changes cannot overwrite each other.
function mutate(uid: string, change: (ops: PendingOp[]) => PendingOp[]): Promise<void> {
  return orderedDraftWrite(uid, async () => {
    try {
      const next = change(await loadPending(uid));
      if (next.length) await secureStorage.setItem(key(uid), JSON.stringify(next));
      else await secureStorage.removeItem(key(uid));
    } catch {
      // Storage unavailable: the change is still attempted over the network, it just is not recoverable.
    }
  });
}

// A newer edit of the same entry merges over the older one; a newer log of the same client id replaces it.
export const enqueue = (uid: string, op: PendingOp) =>
  mutate(uid, (ops) => {
    const old = ops.find((o) => same(o, op));
    const merged: PendingOp = old?.kind === 'edit' && op.kind === 'edit' ? { ...op, patch: { ...old.patch, ...op.patch } } : op;
    return [...ops.filter((o) => !same(o, op)), { ...merged, error: undefined }];
  });

export const discard = (uid: string, op: PendingOp) => mutate(uid, (ops) => ops.filter((o) => !same(o, op)));

// Null when the server has it, otherwise the reason it did not.
async function send(uid: string, op: PendingOp): Promise<string | null> {
  if (op.kind === 'log') {
    // Last write wins on (user_id, client_id), so resending the same entry changes nothing.
    const { error } = await supabase.from('food_entries').upsert({ ...op.row, user_id: uid, client_id: op.clientId } as never, { onConflict: 'user_id,client_id' });
    return error ? SYNC_FAILED : null;
  }
  // If the entry was deleted elsewhere no row matches and there is nothing left to sync.
  const { error } = await supabase.from('food_entries').update(op.patch as never).eq('id', op.id);
  return error ? SYNC_FAILED : null;
}

let running: Promise<number> | null = null;

// Sends every pending change. Resolves to how many are still waiting, each keeping its error for the diary.
export function flushPending(uid: string): Promise<number> {
  running ??= (async () => {
    let left = 0;
    for (const op of await loadPending(uid)) {
      const error = await send(uid, op).catch(() => SYNC_FAILED);
      // Only remove what was sent: a newer edit that arrived meanwhile stays queued.
      await mutate(uid, (ops) => ops.flatMap((o) => (!same(o, op) || content(o) !== content(op) ? [o] : error ? [{ ...o, error }] : [])));
      if (error) left++;
    }
    return left;
  })().finally(() => { running = null; });
  return running;
}
