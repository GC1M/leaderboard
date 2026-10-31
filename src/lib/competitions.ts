import type { Database } from './database.types';
import { isValidCode, isValidGroupId } from './groups';
import { supabase } from './supabase';
export type Competition = Database['public']['Tables']['competitions']['Row'];
export type Participation = Database['public']['Tables']['competition_participants']['Row'];
const message = (e: unknown) => e && typeof e === 'object' && 'message' in e ? String(e.message) : 'Could not update the competition. Try again.';
async function checked<T>(request: PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  const { data, error } = await request;
  if (error) throw new Error(message(error));
  return data;
}
export const getCompetitions = (groupId: string) => checked(supabase.from('competitions').select('*').eq('group_id', groupId).order('starts_at', { ascending: false }));
export const getCompetition = (id: string) => checked(supabase.from('competitions').select('*').eq('id', id).maybeSingle());
export const getParticipation = (id: string, uid: string) => checked(supabase.from('competition_participants').select('*').eq('competition_id', id).eq('user_id', uid).maybeSingle());
export const joinCompetition = (id: string) => checked(supabase.rpc('join_competition', { p_id: id }));
export const leaveCompetition = (id: string) => checked(supabase.rpc('leave_competition', { p_id: id }));
export const createCompetition = (input: { groupId: string; name: string; firstDay: string; endDay: string; timezone: string; includeManual: boolean }) => checked(supabase.rpc('create_competition', {
  p_group_id: input.groupId, p_name: input.name, p_metric: 'steps', p_start_day: input.firstDay, p_end_day: input.endDay, p_timezone: input.timezone, p_include_manual: input.includeManual,
}));
export function competitionInviteLink(code: string, id: string) {
  if (!isValidCode(code) || !isValidGroupId(id)) throw new Error('Invalid competition invitation.');
  return `leaderboard://join/${code}?competition=${id}`;
}
export function competitionState(c: Pick<Competition, 'status' | 'starts_at' | 'ends_at'>, now = new Date()): string {
  if (c.status === 'cancelled') return 'Cancelled';
  if (c.status === 'finalized') return 'Final results';
  return now.getTime() < Date.parse(c.starts_at) ? 'Upcoming' : now.getTime() < Date.parse(c.ends_at) ? 'Active' : 'Provisional results';
}
export function competitionDay(at: string, timezone: string) {
  return new Date(at).toLocaleDateString(undefined, { timeZone: timezone, dateStyle: 'medium' });
}
