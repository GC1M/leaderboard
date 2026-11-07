import { localDateKey, startOfLocalDay } from './dates';
import { EXCLUDE_OWN_EXPORTS } from './export-metadata';
import { HEALTH_TYPES, loadHealthKit } from './healthkit';

export type SleepSample = { uuid: string; startDate: Date; endDate: Date; value: number };
export type SleepDay = { source?: 'manual' | 'healthkit'; date: string; value: number; windowStart: string; windowEnd: string };
const ASLEEP = new Set([1, 3, 4, 5]); // unspecified, core, deep, REM; never in-bed (0) or awake (2)
const SESSION_GAP_MS = 90 * 60 * 1000;

// Policy: a sleep session joins asleep intervals separated by <=90 minutes (including awakenings).
// Union all sources' asleep intervals: overlapping Watch/tracker/stage/unspecified samples count once.
// Attribute the entire session to its final asleep end's device-local date; naps count on their end date.
// We don't claim source priority parity with the Health app when sources disagree about awake time.
export function summarizeSleep(samples: readonly SleepSample[]): SleepDay[] {
  const intervals = samples.filter((s) => ASLEEP.has(s.value)).flatMap((s) => {
    const start = s.startDate.getTime();
    const end = s.endDate.getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) throw new Error('Invalid sleep interval from Health.');
    // Health can hold zero-length samples. They add no sleep, and throwing would stop every later import.
    return end === start ? [] : [{ start, end }];
  }).sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: { start: number; end: number }[] = [];
  for (const interval of intervals) {
    const last = merged[merged.length - 1];
    if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
    else merged.push({ ...interval });
  }
  const sessions: { start: number; end: number; asleepMs: number }[] = [];
  for (const interval of merged) {
    const last = sessions[sessions.length - 1];
    if (last && interval.start - last.end <= SESSION_GAP_MS) {
      last.end = interval.end;
      last.asleepMs += interval.end - interval.start;
    } else sessions.push({ ...interval, asleepMs: interval.end - interval.start });
  }
  const days = new Map<string, SleepDay>();
  for (const session of sessions) {
    const date = localDateKey(new Date(session.end));
    const prior = days.get(date);
    days.set(date, {
      date,
      value: (prior?.value ?? 0) + session.asleepMs / 60000,
      windowStart: prior?.windowStart ?? new Date(session.start).toISOString(),
      windowEnd: new Date(session.end).toISOString(),
    });
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export async function readDailySleep(days: number, now = new Date()): Promise<SleepDay[]> {
  const hk = loadHealthKit();
  if (!hk) return [];
  if (!Number.isInteger(days) || days < 1) throw new Error('Sleep history days must be positive.');
  const from = startOfLocalDay(now, days - 1);
  // Overlap predicate includes samples starting before the requested boundary. The lookback also
  // keeps a preceding session together when its first stage falls outside the requested dates.
  const samples = await hk.queryCategorySamples(HEALTH_TYPES.sleep, {
    limit: 0, ascending: true,
    filter: { date: { startDate: startOfLocalDay(from, 2), endDate: now }, ...EXCLUDE_OWN_EXPORTS },
  });
  return summarizeSleep(samples.filter((s) => s.endDate <= now)).filter((d) => d.date >= localDateKey(from));
}
