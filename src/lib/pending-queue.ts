// Logs and edits of a client-id table (food_entries #47, water_entries #56) that have not reached the server yet. Each
// one is saved on this device before the network is tried, so an interruption or a failed sync never loses what the
// user entered, and is retried until it succeeds or the user discards it. Same storage and write ordering as the
// workout drafts. One queue per table and account.
import { orderedDraftWrite } from '@/lib/ordered-draft-write';
import { secureStorage } from '@/lib/secure-storage';
import { supabase } from '@/lib/supabase';

type Cols = Record<string, unknown>;
// A purge deletes whatever the server holds under a client id: used when an entry that never showed as synced is
// deleted, in case a send landed anyway.
// A log is the full row (upserted on client_id, so a retry never makes a second entry). An edit is the changed
// columns of an existing entry (one UPDATE, so related columns always change together).
// `permanent`: the server refused it for good (bad data, not allowed), so it is not retried until the user edits or discards it.
type Status = { error?: string; permanent?: boolean };
export type PendingOp = ({ kind: 'log'; clientId: string; row: Cols } | { kind: 'edit'; id: string; patch: Cols } | { kind: 'purge'; clientId: string }) & Status;
export type PendingTable = 'food_entries' | 'water_entries';

const opKey = (o: PendingOp) => (o.kind === 'edit' ? `edit:${o.id}` : `${o.kind}:${o.clientId}`);
const same = (a: PendingOp, b: PendingOp) => opKey(a) === opKey(b);
const content = (o: PendingOp) => JSON.stringify(o.kind === 'log' ? o.row : o.kind === 'edit' ? o.patch : null);
export const SYNC_FAILED = "Couldn't sync. Check your connection and retry.";
export const SYNC_REFUSED = "This entry can't be saved. Edit it or discard it.";
export const ENTRY_GONE = 'This entry was deleted on another device.';

type Failure = { status?: number; error: { code?: string; message?: string } };
// Bad data or not allowed: sending it again cannot help. Everything else (network, 5xx, 408, 429, an expired
// session) is worth another try.
function refused({ status = 0, error }: Failure): boolean {
  if (status === 401 || status === 408 || status === 429 || status >= 500) return false;
  return [400, 403, 409].includes(status) || /^(22|23|42)/.test(error.code ?? '');
}

type Outcome = { done: true; notice?: string } | { done: false; error?: string; permanent?: boolean };
const fail = (f: Failure): Outcome => ({ done: false, error: refused(f) ? SYNC_REFUSED : SYNC_FAILED, permanent: refused(f) });

export function createPendingQueue(table: PendingTable, prefix: string) {
  const key = (uid: string) => `${prefix}-${uid}`;
  // Both tables have the same client-id columns; the cast only picks one table's generated types for the builder.
  const from = () => supabase.from(table as 'food_entries');

  async function loadPending(uid: string): Promise<PendingOp[]> {
    try {
      const v: unknown = JSON.parse((await secureStorage.getItem(key(uid))) ?? '[]');
      return Array.isArray(v) ? v.filter((o) => o && (o.kind === 'edit' ? typeof o.id === 'string' : (o.kind === 'log' || o.kind === 'purge') && typeof o.clientId === 'string')) : [];
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

  // A newer edit of the same entry merges over the older one, unless the older was refused (its fields are what
  // the server rejected, so they must not carry over); a newer log of the same client id replaces it.
  const enqueue = (uid: string, op: PendingOp) =>
    mutate(uid, (ops) => {
      const old = ops.find((o) => same(o, op));
      const merged: PendingOp = old?.kind === 'edit' && op.kind === 'edit' && !old.permanent ? { ...op, patch: { ...old.patch, ...op.patch } } : op;
      return [...ops.filter((o) => !same(o, op)), { ...merged, error: undefined, permanent: undefined }];
    });

  const discard = (uid: string, op: PendingOp) => mutate(uid, (ops) => ops.filter((o) => !same(o, op)));

  const running = new Map<string, Promise<number>>();
  const notices = new Map<string, string[]>();

  // Waits for a flush already in flight, so it cannot send a change after the queue was cleared.
  async function clear(uid: string): Promise<void> {
    await running.get(uid)?.catch(() => {});
    await orderedDraftWrite(uid, () => secureStorage.removeItem(key(uid)));
  }

  async function send(uid: string, op: PendingOp): Promise<Outcome> {
    // Never send one account's changes under another account's session.
    const { data: auth } = await supabase.auth.getSession();
    if (auth.session?.user.id !== uid) return { done: false };
    if (op.kind === 'log') {
      // Last write wins on (user_id, client_id), so resending the same entry changes nothing.
      const r = await from().upsert({ ...op.row, user_id: uid, client_id: op.clientId } as never, { onConflict: 'user_id,client_id' });
      return r.error ? fail(r) : { done: true };
    }
    if (op.kind === 'purge') {
      const d = await from().delete().eq('client_id', op.clientId);
      // Always retryable: a purged row is hidden, so a refusal must never leave it hidden forever.
      return d.error ? { done: false, error: SYNC_FAILED, permanent: false } : { done: true };
    }
    const r = await from().update(op.patch as never).eq('id', op.id).select('id');
    if (r.error) return fail(r);
    if (r.data.length > 0) return { done: true };
    // No row was updated: either it is gone, or it cannot be seen right now.
    const seen = await from().select('id').eq('id', op.id).maybeSingle();
    if (seen.error) return fail(seen);
    return seen.data ? { done: false, error: SYNC_FAILED } : { done: true, notice: ENTRY_GONE };
  }

  // Messages about changes that were dropped (the entry was deleted elsewhere), shown once.
  function takeNotices(uid: string): string[] {
    const n = notices.get(uid) ?? [];
    notices.delete(uid);
    return n;
  }

  async function pass(uid: string): Promise<number> {
    let left = 0;
    for (const op of await loadPending(uid)) {
      if (op.permanent) { left++; continue; }
      const out = await send(uid, op).catch((): Outcome => ({ done: false, error: SYNC_FAILED }));
      if (out.done && out.notice) notices.set(uid, [...(notices.get(uid) ?? []), out.notice]);
      // Only remove what was sent: a newer edit that arrived meanwhile stays queued.
      await mutate(uid, (ops) =>
        ops.flatMap((o) => (!same(o, op) || content(o) !== content(op) ? [o] : out.done ? [] : [{ ...o, error: out.error ?? o.error, permanent: out.permanent }])));
      if (!out.done) left++;
    }
    return left;
  }

  // Sends every pending change of this account. Calls queue up per account: one that arrives mid-send waits
  // for it and then makes its own pass, so changes queued meanwhile are sent too. Resolves to how many are still
  // waiting after that pass, so a caller never hears "synced" while its change is still queued.
  function flushPending(uid: string): Promise<number> {
    const prev = running.get(uid);
    const next = (async () => {
      await prev?.catch(() => {});
      return pass(uid);
    })();
    running.set(uid, next);
    void next.finally(() => { if (running.get(uid) === next) running.delete(uid); }).catch(() => {});
    return next;
  }

  return { loadPending, enqueue, discard, clear, takeNotices, flushPending };
}
