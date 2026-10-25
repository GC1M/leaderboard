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
