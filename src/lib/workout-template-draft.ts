import { secureStorage } from './secure-storage';
import { parseTemplateDraft, serializeTemplateDraft, type TemplateDraft } from './workout-template-form';

// Same scheme as workout-draft, in its own keys: one draft per account and target, where `null` is the
// new-template entry and a string is the id being edited.
const key = (uid: string, target: string | null) => `template-draft-${uid}-${target ?? 'new'}`;
const indexKey = (uid: string) => `template-drafts-${uid}`;

async function readIndex(uid: string): Promise<(string | null)[]> {
  try {
    const v: unknown = JSON.parse((await secureStorage.getItem(indexKey(uid))) ?? '[]');
    return Array.isArray(v) ? v.filter((t) => t === null || typeof t === 'string') : [];
  } catch {
    return [];
  }
}

export async function loadTemplateDraft(uid: string, target: string | null): Promise<TemplateDraft | null> {
  try {
    return parseTemplateDraft(await secureStorage.getItem(key(uid, target)));
  } catch {
    return null;
  }
}

// Targets that have a saved draft, for the resume rows.
export async function listTemplateDrafts(uid: string): Promise<(string | null)[]> {
  const targets = await readIndex(uid);
  const found = await Promise.all(targets.map((t) => loadTemplateDraft(uid, t)));
  return targets.filter((_, i) => found[i]);
}

export async function saveTemplateDraft(uid: string, d: TemplateDraft): Promise<void> {
  try {
    const index = await readIndex(uid);
    if (!index.includes(d.editingId)) await secureStorage.setItem(indexKey(uid), JSON.stringify([...index, d.editingId]));
    await secureStorage.setItem(key(uid, d.editingId), serializeTemplateDraft(d));
  } catch {
    // A draft is a convenience; failing to keep one must not interrupt typing.
  }
}

export async function clearTemplateDraft(uid: string, target: string | null): Promise<void> {
  try {
    await secureStorage.removeItem(key(uid, target));
    await secureStorage.setItem(indexKey(uid), JSON.stringify((await readIndex(uid)).filter((t) => t !== target)));
  } catch {
    // A stale draft is only ever offered, never applied on its own.
  }
}

export async function clearAllTemplateDrafts(uid: string): Promise<void> {
  const targets = await readIndex(uid);
  await Promise.allSettled([...targets.map((t) => secureStorage.removeItem(key(uid, t))), secureStorage.removeItem(indexKey(uid))]);
}
