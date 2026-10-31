import { orderedDraftWrite } from './ordered-draft-write';
import { secureStorage } from './secure-storage';
export const measurementDraftKey = (uid: string, metric: 'weight' | 'sleep' | 'steps') => `measurement-draft-${uid}-${metric}`;
export function saveMeasurementDraft(uid: string, metric: 'weight' | 'sleep' | 'steps', draft: unknown) {
  return orderedDraftWrite(uid, async () => {
    try { await secureStorage.setItem(measurementDraftKey(uid, metric), JSON.stringify(draft)); } catch { /* Typing must remain usable. */ }
  });
}
export async function loadMeasurementDraft(uid: string, metric: 'weight' | 'sleep' | 'steps'): Promise<unknown> {
  try { return JSON.parse(await secureStorage.getItem(measurementDraftKey(uid, metric)) ?? 'null'); } catch { return null; }
}
export function clearMeasurementDraft(uid: string, metric: 'weight' | 'sleep' | 'steps') {
  return orderedDraftWrite(uid, async () => {
    try { await secureStorage.removeItem(measurementDraftKey(uid, metric)); } catch { /* A stale draft is offered, never applied. */ }
  });
}
