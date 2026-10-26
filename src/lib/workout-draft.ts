import { secureStorage } from './secure-storage';
import { type Draft, parseDraft, serializeDraft } from './workout-form';

// One draft per account and target: `null` is the new-workout entry, a string is the id being edited.
const key = (uid: string, target: string | null) => `workout-draft-${uid}-${target ?? 'new'}`;
const indexKey = (uid: string) => `workout-drafts-${uid}`;

async function readIndex(uid: string): Promise<(string | null)[]> {
  try {
    const v: unknown = JSON.parse((await secureStorage.getItem(indexKey(uid))) ?? '[]');
    return Array.isArray(v) ? v.filter((t) => t === null || typeof t === 'string') : [];
  } catch {
    return [];
  }
}

export async function loadDraft(uid: string, target: string | null): Promise<Draft | null> {
  try {
    return parseDraft(await secureStorage.getItem(key(uid, target)));
  } catch {
    return null;
  }
}

// Targets that have a saved draft, for the resume rows.
export async function listDrafts(uid: string): Promise<(string | null)[]> {
  const targets = await readIndex(uid);
  const found = await Promise.all(targets.map((t) => loadDraft(uid, t)));
  return targets.filter((_, i) => found[i]);
}

export async function saveDraft(uid: string, d: Draft): Promise<void> {
  try {
    const index = await readIndex(uid);
    if (!index.includes(d.editingId)) await secureStorage.setItem(indexKey(uid), JSON.stringify([...index, d.editingId]));
    await secureStorage.setItem(key(uid, d.editingId), serializeDraft(d));
  } catch {
    // A draft is a convenience; failing to keep one must not interrupt typing.
  }
}

export async function clearDraft(uid: string, target: string | null): Promise<void> {
  try {
    await secureStorage.removeItem(key(uid, target));
    await secureStorage.setItem(indexKey(uid), JSON.stringify((await readIndex(uid)).filter((t) => t !== target)));
  } catch {
    // A stale draft is only ever offered, never applied on its own.
  }
}

export async function clearAllDrafts(uid: string): Promise<void> {
  const targets = await readIndex(uid);
  await Promise.allSettled([...targets.map((t) => secureStorage.removeItem(key(uid, t))), secureStorage.removeItem(indexKey(uid))]);
}
