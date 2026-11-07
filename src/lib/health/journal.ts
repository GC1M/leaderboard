import type { HealthJournal } from './changes';
import type { ExportStore } from './export-queue';

// Metro selects journal.native.ts on iPhone and Android, so this stub is web only. Do not import SQLite here: web must
// remain usable for manual entries without bundling an unused native Health journal.
const unavailable = () => new Error('Health imports require the native iPhone or Android app build.');
export async function getHealthDeviceId(): Promise<string> { throw unavailable(); }
export function healthJournal(_userId: string): HealthJournal {
  return { read: async () => { throw unavailable(); }, write: async () => { throw unavailable(); } };
}
export function healthExportStore(_userId: string): ExportStore {
  const fail = async (): Promise<never> => { throw unavailable(); };
  return { list: fail, put: fail, remove: fail, clear: fail };
}
export async function resetHealthAnchors(_userId: string): Promise<void> { throw unavailable(); }
export async function deleteImportedJournal(_userId: string): Promise<void> { /* No native journal on this platform. */ }
export async function deleteHealthJournal(_userId: string): Promise<void> { /* No native journal on this platform. */ }
