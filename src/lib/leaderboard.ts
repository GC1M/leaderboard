import { localDateKey } from './health/dates';
import { supabase } from './supabase';

export type Metric = 'steps' | 'workout_minutes' | 'weight_kg' | 'screen_min';
export type Period = 'day' | 'week';

export type LeaderboardRow = {
  userId: string;
  name: string;
  value: number;
  rank: number;
};

export async function getLeaderboard(groupId: string, metric: Metric, period: Period): Promise<LeaderboardRow[]> {
  const { data, error } = await supabase.rpc('group_leaderboard', {
    p_group_id: groupId,
    p_metric: metric,
    p_period: period,
  });
  if (error) throw error;
  // Postgres numeric/bigint can arrive as strings depending on the client path.
  return data.map((r) => ({ userId: r.user_id, name: r.display_name, value: Number(r.value), rank: Number(r.rank) }));
}

// The RPC returns 0 for members with no data and ranks them last, so value 0 is the signal.
// ponytail: a real recorded 0 is shown as "no data yet" too; fine for steps. Revisit for screen_min.
export const hasNoData = (row: Pick<LeaderboardRow, 'value'>) => row.value === 0;

export function formatValue(metric: Metric, value: number): string {
  const n = Math.round(value);
  switch (metric) {
    case 'steps':
      return n.toLocaleString('en-US');
    case 'workout_minutes':
    case 'screen_min':
      return `${n.toLocaleString('en-US')} min`;
    case 'weight_kg':
      return `${n}%`;
  }
}

// The RPC's rank() already gives tied rows the same number; show it with a "T" prefix when shared.
export function rankLabels(rows: LeaderboardRow[]): string[] {
  return rows.map((r) => {
    if (hasNoData(r)) return '-';
    const tied = rows.some((o) => o !== r && o.rank === r.rank && !hasNoData(o));
    return `${tied ? 'T' : ''}${r.rank}`;
  });
}

// Same window as group_leaderboard: today, or Monday to Sunday of this week. Uses the device date; the RPC uses the
// profile timezone, which the app writes from the device on login, so they agree.
export function periodRange(period: Period, now: Date = new Date()): { from: string; to: string } {
  if (period === 'day') return { from: localDateKey(now), to: localDateKey(now) };
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
  return { from: localDateKey(monday), to: localDateKey(sunday) };
}

// Manual-entry step day count per member for the period, for members who share steps with this group.
export async function getManualDays(groupId: string, period: Period): Promise<Record<string, number>> {
  const { from, to } = periodRange(period);
  const { data, error } = await supabase.rpc('group_steps', { p_group_id: groupId, p_from: from, p_to: to });
  if (error) throw error;
  const counts: Record<string, number> = {};
  for (const r of data) if (r.source === 'manual') counts[r.user_id] = (counts[r.user_id] ?? 0) + 1;
  return counts;
}

// Caption under the name: where the number came from, so manual entries are visible, not hidden.
export function sourceLabel(period: Period, manualDays: number, noData: boolean): { text: string; manual: boolean } {
  if (noData) return { text: 'Not synced yet', manual: false };
  if (manualDays === 0) return { text: 'Health', manual: false };
  if (period === 'day') return { text: 'Manual', manual: true };
  return { text: `${manualDays} of 7 days manual`, manual: true };
}

export type Standing = { rankLabel: string; members: number; value: number; leader: number };

// Your place in one group's rows, for the summary cards. null if you're not in the rows.
export function myStanding(rows: LeaderboardRow[], me: string): Standing | null {
  const i = rows.findIndex((r) => r.userId === me);
  if (i < 0) return null;
  return { rankLabel: rankLabels(rows)[i], members: rows.length, value: rows[i].value, leader: Math.max(0, ...rows.map((r) => r.value)) };
}
