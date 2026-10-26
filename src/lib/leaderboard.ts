import { localDateKey } from './health/dates';
import { supabase } from './supabase';

export type Metric = 'steps' | 'workout_minutes' | 'weight_kg' | 'screen_min';
export type Period = 'day' | 'week';

// recorded: value is set and may be 0. no_data: nothing recorded. not_shared: the member doesn't share
// this metric with the group, so there is no value (and no hint whether data exists).
export type RowState = 'recorded' | 'no_data' | 'not_shared';

export type LeaderboardRow = {
  userId: string;
  name: string;
  value: number | null;
  rank: number;
  state: RowState;
};

export async function getLeaderboard(groupId: string, metric: Metric, period: Period): Promise<LeaderboardRow[]> {
  const { data, error } = await supabase.rpc('group_leaderboard', {
    p_group_id: groupId,
    p_metric: metric,
    p_period: period,
  });
  if (error) throw error;
  // Postgres numeric/bigint can arrive as strings depending on the client path.
  return data.map((r) => ({
    userId: r.user_id,
    name: r.display_name,
    value: r.value === null ? null : Number(r.value),
    rank: Number(r.rank),
    state: r.state as RowState,
  }));
}

// No value to show or rank: nothing recorded, or not shared. A recorded 0 is a value.
export const hasNoData = (row: Pick<LeaderboardRow, 'value'>) => row.value === null;

// Largest recorded value, for lane bars. 0 when nobody has one.
export const leaderValue = (rows: LeaderboardRow[]) => Math.max(0, ...rows.map((r) => r.value ?? 0));

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
export function sourceLabel(period: Period, manualDays: number, state: RowState): { text: string; manual: boolean } {
  if (state === 'not_shared') return { text: 'Not sharing with this group', manual: false };
  if (state === 'no_data') return { text: 'No data yet', manual: false };
  if (manualDays === 0) return { text: 'Health', manual: false };
  if (period === 'day') return { text: 'Manual', manual: true };
  return { text: `${manualDays} of 7 days manual`, manual: true };
}

export type Standing = { rankLabel: string; members: number; value: number | null; leader: number };

// Your place in one group's rows, for the summary cards. null if you're not in the rows.
export function myStanding(rows: LeaderboardRow[], me: string): Standing | null {
  const i = rows.findIndex((r) => r.userId === me);
  if (i < 0) return null;
  return { rankLabel: rankLabels(rows)[i], members: rows.length, value: rows[i].value, leader: leaderValue(rows) };
}
