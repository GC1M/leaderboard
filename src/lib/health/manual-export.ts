import { exportMetadata } from './export-metadata';
import { registerExportWriter, type ExportEntry, type ExportWriter } from './export-queue';
import { HEALTH_TYPES, loadHealthKit, removeExportedSample } from './healthkit';

// Manual entries the user chose to also save to Apple Health. Imported readings are never exportable (canExport).
// recordId: the weight row id, the wake-up date for sleep, the local date for steps.
export const MANUAL_KINDS = { weight: 'manual-weight', sleep: 'manual-sleep', steps: 'manual-steps' } as const;
export type ManualType = keyof typeof MANUAL_KINDS;

export type WeightPayload = { kg: number; at: string };
export type SleepPayload = { start: string; end: string };
export type StepsPayload = { count: number; start: string; end: string };

export const canExport = (source: string) => source === 'manual';

const ASLEEP_UNSPECIFIED = 1; // HKCategoryValueSleepAnalysis.asleepUnspecified

const need = () => {
  const hk = loadHealthKit();
  if (!hk) throw new Error('Apple Health requires a native iPhone build.');
  return hk;
};
const uuid = (s: { uuid: string } | undefined) => s?.uuid ?? null;
const meta = (e: ExportEntry) => exportMetadata(e.kind, e.recordId, e.version) as never;

const writers: Record<ManualType, ExportWriter> = {
  weight: {
    writeType: HEALTH_TYPES.weight,
    save: async (e) => {
      const p = e.payload as WeightPayload;
      const at = new Date(p.at);
      return uuid(await need().saveQuantitySample(HEALTH_TYPES.weight, 'kg', p.kg, at, at, meta(e)));
    },
    remove: (e) => removeExportedSample(HEALTH_TYPES.weight, e.kind, e.recordId),
  },
  sleep: {
    writeType: HEALTH_TYPES.sleep,
    save: async (e) => {
      const p = e.payload as SleepPayload;
      return uuid(await need().saveCategorySample(HEALTH_TYPES.sleep, ASLEEP_UNSPECIFIED, new Date(p.start), new Date(p.end), meta(e)));
    },
    remove: (e) => removeExportedSample(HEALTH_TYPES.sleep, e.kind, e.recordId),
  },
  steps: {
    writeType: HEALTH_TYPES.steps,
    save: async (e) => {
      const p = e.payload as StepsPayload;
      return uuid(await need().saveQuantitySample(HEALTH_TYPES.steps, 'count', p.count, new Date(p.start), new Date(p.end), meta(e)));
    },
    remove: (e) => removeExportedSample(HEALTH_TYPES.steps, e.kind, e.recordId),
  },
};

// Registered at import so a queued entry retries after restart without opening the screen that made it.
for (const t of Object.keys(writers) as ManualType[]) registerExportWriter(MANUAL_KINDS[t], writers[t]);

// Steps cover the local day, or the time so far for today (Health should not hold steps in the future).
export function stepsPayload(date: string, count: number, now = new Date()): StepsPayload {
  const [y, m, d] = date.split('-').map(Number);
  const start = new Date(y, m - 1, d), next = new Date(y, m - 1, d + 1);
  return { count, start: start.toISOString(), end: new Date(Math.min(next.getTime(), now.getTime())).toISOString() };
}

export { writers as manualWriters };
