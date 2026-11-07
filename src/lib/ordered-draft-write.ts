// Per-account writes share a queue: clears run after in-flight autosaves, never before them.
const queues = new Map<string, Promise<void>>();
export function orderedDraftWrite(uid: string, run: () => Promise<void>): Promise<void> {
  const next = (queues.get(uid) ?? Promise.resolve()).catch(() => {}).then(run);
  queues.set(uid, next);
  void next.finally(() => { if (queues.get(uid) === next) queues.delete(uid); }).catch(() => {});
  return next;
}
