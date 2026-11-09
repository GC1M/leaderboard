import type { Database } from './database.types';
import { isValidCode, isValidGroupId } from './groups';
import { dateInZone } from './health/dates';
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
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
// One line on how far you are from the next place up, or how far ahead you lead. Null when you have no ranked score.
export function competitionGap(rows: Pick<CompetitionStanding, 'user_id' | 'display_name' | 'score' | 'rank'>[], uid: string, metric: string): string | null {
  const me = rows.find((r) => r.user_id === uid);
  if (!me || me.score === null || me.rank === null) return null;
  const others = rows.filter((r) => r.user_id !== uid && r.score !== null && r.rank !== null);
  const amount = (n: number) => standingValue({ score: n, eligibility: 'eligible' }, metric);
  const ahead = others.filter((r) => r.score! > me.score!);
  if (!ahead.length) {
    if (others.some((r) => r.score === me.score)) return `Tied for ${ordinal(me.rank)}`;
    const next = Math.max(...others.map((r) => r.score!));
    return others.length ? `You lead by ${amount(me.score - next)}` : 'You are in 1st';
  }
  const nearest = Math.min(...ahead.map((r) => r.score!));
  const target = ahead.filter((r) => r.score === nearest);
  return `${amount(nearest - me.score)} behind ${target.length === 1 ? target[0].display_name : `${ordinal(target[0].rank!)} place`}${target.length === 1 ? ` for ${ordinal(target[0].rank!)}` : ''}`;
}
const dayKey = (t: number, timezone: string) => dateInZone(new Date(t), timezone);
// Calendar days of the competition in its timezone. Stepping from noon keeps daylight saving shifts off the boundaries.
export function competitionDays(c: Pick<Competition, 'starts_at' | 'ends_at' | 'timezone'>): string[] {
  const days: string[] = []; const end = Date.parse(c.ends_at);
  for (let t = Date.parse(c.starts_at) + 12 * 3_600_000; t < end; t += 86_400_000) {
    const key = dayKey(t, c.timezone);
    if (days[days.length - 1] !== key) days.push(key);
  }
  return days;
}
export type DailySteps = { day: string; value: number | null; excluded: number; future: boolean };
// Your own included entries summed per day. Null means no entry that day, which is different from a recorded zero.
// Excluded only counts manual entries this competition leaves out; other reasons (sharing off, wrong timezone) are not rules of the competition.
export function dailySteps(days: string[], records: { measured_on: string; value: number; included: boolean; reason?: string }[], today: string): DailySteps[] {
  return days.map((day) => {
    const own = records.filter((r) => r.measured_on === day);
    const counted = own.filter((r) => r.included);
    return { day, value: counted.length ? counted.reduce((s, r) => s + Number(r.value), 0) : null, excluded: own.filter((r) => !r.included && r.reason === 'manual_entries_excluded').reduce((s, r) => s + Number(r.value), 0), future: day > today };
  });
}
// The daily pace of the person you are chasing (the runner-up when you lead), from totals already shared. Null when there is no one to compare with.
export function rivalPace(rows: Pick<CompetitionStanding, 'user_id' | 'display_name' | 'score'>[], uid: string, daysElapsed: number): { name: string; perDay: number } | null {
  const me = rows.find((r) => r.user_id === uid);
  const others = rows.filter((r) => r.user_id !== uid && r.score !== null);
  if (!me || me.score === null || !others.length || daysElapsed < 1) return null;
  const ahead = others.filter((r) => r.score! > me.score!);
  const rival = ahead.length ? ahead.reduce((a, b) => (b.score! < a.score! ? b : a)) : others.reduce((a, b) => (b.score! > a.score! ? b : a));
  return { name: rival.display_name, perDay: Math.round(rival.score! / daysElapsed) };
}
export type GroupCompetition = Competition & { groups: { name: string } | null; joined: boolean };
// Competitions across all your groups (row security limits them to groups you belong to), newest first.
export async function getMyCompetitions(uid: string): Promise<GroupCompetition[]> {
  const [rows, mine] = await Promise.all([
    checked(supabase.from('competitions').select('*, groups(name)').order('starts_at', { ascending: false })),
    checked(supabase.from('competition_participants').select('competition_id').eq('user_id', uid).eq('status', 'joined')),
  ]);
  const joined = new Set((mine ?? []).map((p) => p.competition_id));
  return (rows ?? []).map((r) => ({ ...r, joined: joined.has(r.id) }));
}
