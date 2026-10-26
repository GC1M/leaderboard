import { startOfLocalDay } from './dates';
import { HEALTH_TYPES, loadHealthKit } from './healthkit';

export type WeightReading = { sampleId: string; measuredAt: string; kg: number };
export type WeightSample = { uuid: string; startDate: Date; quantity: number; unit: string };
const KG_PER_LB = 0.45359237;
export const displayWeight = (kg: number, unit: 'kg' | 'lb') => unit === 'lb' ? kg / KG_PER_LB : kg;

// The DB has one Health row per timestamp. If two sources record at exactly the same time,
// choose the lexicographically greatest sample UUID; sorting makes imports/retries deterministic.
export function normalizeWeight(samples: readonly WeightSample[]): WeightReading[] {
  const byTime = new Map<string, WeightReading>();
  for (const s of samples) {
    const kg = s.unit === 'kg' ? s.quantity : s.unit === 'lb' ? s.quantity * KG_PER_LB : NaN;
    if (!s.uuid || !Number.isFinite(s.startDate.getTime()) || !Number.isFinite(kg) || kg <= 0 || kg >= 1000) throw new Error('Invalid weight sample from Health.');
    const measuredAt = s.startDate.toISOString();
    const previous = byTime.get(measuredAt);
    if (!previous || s.uuid > previous.sampleId) byTime.set(measuredAt, { sampleId: s.uuid, measuredAt, kg });
  }
  return [...byTime.values()].sort((a,b) => a.measuredAt.localeCompare(b.measuredAt));
}

export async function readLatestWeight(now = new Date()): Promise<WeightReading | null> {
  const hk = loadHealthKit();
  if (!hk) return null;
  const latest = await hk.queryQuantitySamples(HEALTH_TYPES.weight, { unit: 'kg', ascending: false, limit: 1, filter: { date: { endDate: now } } });
  if (!latest.length) return null;
  // Query all readings at that exact time, so native ordering of ties does not decide the value.
  const ties = await hk.queryQuantitySamples(HEALTH_TYPES.weight, { unit: 'kg', ascending: false, limit: 0,
    filter: { date: { startDate: latest[0].startDate, endDate: new Date(latest[0].startDate.getTime() + 1) } } });
  const candidates = ties.filter((s) => s.startDate.getTime() === latest[0].startDate.getTime());
  return normalizeWeight(candidates.length ? candidates : latest)[0];
}

export async function readWeightHistory(days: number, now = new Date()): Promise<WeightReading[]> {
  const hk = loadHealthKit();
  if (!hk) return [];
  if (!Number.isInteger(days) || days < 1) throw new Error('Weight history days must be positive.');
  const [samples, latest] = await Promise.all([
    hk.queryQuantitySamples(HEALTH_TYPES.weight, { unit: 'kg', limit: 0, ascending: true,
      filter: { date: { startDate: startOfLocalDay(now, days - 1), endDate: now } } }),
    readLatestWeight(now),
  ]);
  const rows = normalizeWeight(samples.filter((s) => s.startDate <= now));
  if (latest && !rows.some((r) => r.measuredAt === latest.measuredAt)) rows.push(latest);
  return rows.sort((a,b) => a.measuredAt.localeCompare(b.measuredAt));
}
