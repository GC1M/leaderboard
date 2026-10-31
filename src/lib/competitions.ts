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
type StandingRow = Database['public']['Functions']['competition_standings']['Returns'][number];
// Function metadata cannot express these SQL NULLs; preserve no-data and privacy states in the client.
export type CompetitionStanding = Omit<StandingRow, 'score' | 'rank' | 'updated_at'> & { score: number | null; rank: number | null; updated_at: string | null };
export const getCompetitionStandings = (id: string) => checked(supabase.rpc('competition_standings', { p_id: id }));
export const finalizeCompetition = (id: string) => checked(supabase.rpc('finalize_competition', { p_id: id }));
export function standingValue(row: Pick<CompetitionStanding, 'score' | 'eligibility'>, metric: string): string {
  if (row.score === null) return eligibilityLabel(row.eligibility);
  return metric === 'workout_duration' ? `${Math.round(row.score / 60).toLocaleString()} min` : `${Number(row.score).toLocaleString()} ${metric === 'steps' ? 'steps' : 'workouts'}`;
}
export function eligibilityLabel(value: string): string {
  return ({ eligible: 'Eligible', no_data: 'No data', not_sharing: 'Not sharing', timezone_mismatch: 'Timezone does not match', left_group: 'No longer in group', manual_entries_excluded: 'Manual entries excluded' } as Record<string, string>)[value] ?? 'Data unavailable';
}
export const moderateCompetition = (id: string, action: 'cancel' | 'remove', reason: string, userId?: string) => checked(supabase.rpc('moderate_competition', { p_id: id, p_action: action, p_reason: reason, ...(userId ? { p_user_id: userId } : {}) }));
export const getCompetitionAudit = (id: string) => checked(supabase.from('competition_audit').select('*').eq('competition_id', id).order('created_at', { ascending: false }).limit(50));
export const getMyContributions = (id: string) => checked(supabase.rpc('my_competition_contributions', { p_id: id }));
export const getCompetitionParticipants = (id: string) => checked(supabase.from('competition_participants').select('*').eq('competition_id', id));
export function contributionReason(reason: string): string {
  return ({ eligible: 'Included', after_finalization: 'Changed after finalization; frozen result unchanged', outside_period: 'Session crosses a competition boundary', duplicate_import_summary: 'Detailed imported session counted instead', competition_cancelled: 'Competition cancelled', not_enrolled: 'Not enrolled' } as Record<string, string>)[reason] ?? eligibilityLabel(reason);
}
