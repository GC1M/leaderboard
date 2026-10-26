import { readingDateLabel } from './health/dates';
import { dateFromKey, formatSleep, formatWeight, type WeightUnit } from './health/format';
import type { SharedMetric } from './groups';

// recorded: has a value (0 is a value). no_data: shared, but nothing synced. not_shared: no value and no hint
// whether data exists.
export type Summary = { state: 'not_shared' } | { state: 'no_data' } | { state: 'recorded'; value: number; date: string };

export type MemberSummary = { userId: string; name: string; sleep: Summary; weight: Summary };

type Slept = { user_id: string; date: string; minutes: number };
type Weighed = { user_id: string; measured_on: string; kg: number };

function pick(shared: boolean, found: { value: number; date: string } | undefined): Summary {
  if (!shared) return { state: 'not_shared' };
  return found ? { state: 'recorded', ...found } : { state: 'no_data' };
}

// Merges members, who shares what, and the readings the server returned into one row per member.
// The latest sleep date wins; the server already returns only the latest weight per member.
export function buildMemberSummaries(
  members: { userId: string; name: string }[],
  shares: Record<string, SharedMetric[]>,
  sleep: Slept[],
  weights: Weighed[],
): MemberSummary[] {
  const lastSleep = new Map<string, { value: number; date: string }>();
  for (const r of sleep) {
    const prev = lastSleep.get(r.user_id);
    if (!prev || r.date > prev.date) lastSleep.set(r.user_id, { value: Number(r.minutes), date: r.date });
  }
  const weight = new Map(weights.map((r) => [r.user_id, { value: Number(r.kg), date: r.measured_on }]));
  return members.map((m) => ({
    userId: m.userId,
    name: m.name,
    sleep: pick(shares[m.userId]?.includes('sleep') ?? false, lastSleep.get(m.userId)),
    weight: pick(shares[m.userId]?.includes('weight') ?? false, weight.get(m.userId)),
  }));
}

const text = (s: Summary, fmt: (v: number) => string, now: Date) =>
  s.state === 'not_shared'
    ? 'Not shared'
    : s.state === 'no_data'
      ? 'No data'
      : `${fmt(s.value)}, ${readingDateLabel(dateFromKey(s.date), now)}`;

export const sleepText = (s: Summary, now: Date = new Date()) => text(s, formatSleep, now);
export const weightText = (s: Summary, unit: WeightUnit, now: Date = new Date()) =>
  text(s, (kg) => formatWeight(kg, unit), now);
