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
// The metrics a competition may rank, with the unit of a total. Raw weight, food intake and sleep are never ranked.
export const METRICS = [
  { value: 'steps', label: 'Steps', unit: 'steps' },
  { value: 'workout_minutes', label: 'Workout minutes', unit: 'min' },
  { value: 'workout_count', label: 'Workouts', unit: 'workouts' },
  { value: 'water_days_on_target', label: 'Water days', unit: 'days' },
  { value: 'active_days', label: 'Active days', unit: 'days' },
] as const;
export type CompetitionMetric = (typeof METRICS)[number]['value'];
export const SCORING = [{ value: 'total', label: 'Total' }, { value: 'daily_average', label: 'Daily average' }, { value: 'best_streak', label: 'Best streak' }] as const;
export type CompetitionScoring = (typeof SCORING)[number]['value'];
export const metricLabel = (metric: string) => METRICS.find((m) => m.value === metric)?.label ?? metric;
export const metricUnit = (metric: string) => METRICS.find((m) => m.value === metric)?.unit ?? metric;
// Steps and active days are filed under the device's local day, so those need the profile timezone to match.
export const metricNeedsTimezone = (metric: string) => metric === 'steps' || metric === 'active_days';
export const createCompetition = (input: { groupId: string; name: string; metric: CompetitionMetric; firstDay: string; endDay: string; timezone: string; includeManual: boolean; lateJoins: boolean; scoring: CompetitionScoring }) => checked(supabase.rpc('create_competition', {
  p_group_id: input.groupId, p_name: input.name, p_metric: input.metric, p_start_day: input.firstDay, p_end_day: input.endDay, p_timezone: input.timezone, p_include_manual: input.includeManual, p_late_joins: input.lateJoins, p_scoring: input.scoring,
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
const plural = (n: number, unit: string) => (n === 1 ? unit.replace(/s$/, '') : unit);
// A score in the competition's own words: "6,500 steps", "1,300 steps/day" for a daily average, "3 days" for a streak.
export function standingValue(row: Pick<CompetitionStanding, 'score' | 'eligibility'>, metric: string, scoring = 'total'): string {
  if (row.score === null) return eligibilityLabel(row.eligibility);
  const n = Number(row.score); const text = n.toLocaleString(undefined, { maximumFractionDigits: 1 });
  if (scoring === 'best_streak') return `${text} ${plural(n, 'days')}`;
  return scoring === 'daily_average' ? `${text} ${metricUnit(metric)}/day` : `${text} ${plural(n, metricUnit(metric))}`;
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
export function competitionGap(rows: Pick<CompetitionStanding, 'user_id' | 'display_name' | 'score' | 'rank'>[], uid: string, metric: string, scoring = 'total'): string | null {
  const me = rows.find((r) => r.user_id === uid);
  if (!me || me.score === null || me.rank === null) return null;
  const others = rows.filter((r) => r.user_id !== uid && r.score !== null && r.rank !== null);
  const amount = (n: number) => standingValue({ score: n, eligibility: 'eligible' }, metric, scoring);
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
// Every eligible participant's counted value per day (days with nothing counted are absent), for the race chart.
export const getCompetitionDailyValues = (id: string) => checked(supabase.rpc('competition_daily_values', { p_id: id }));
export type RaceLine = { user_id: string; display_name: string; rank: number; score: number; totals: number[] };
// Cumulative totals per elapsed day for each ranked member, in standing order. Only `total` scoring adds up day by day,
// so callers show the chart for that mode alone. Missing days carry the previous total forward.
export function raceSeries(days: string[], values: { user_id: string; day: string; value: number }[], standings: Pick<CompetitionStanding, 'user_id' | 'display_name' | 'rank' | 'score'>[]): RaceLine[] {
  return standings.filter((s): s is typeof s & { rank: number; score: number } => s.rank !== null && s.score !== null).sort((a, b) => a.rank - b.rank).map((s) => {
    let sum = 0;
    const totals = days.map((day) => { sum += values.filter((v) => v.user_id === s.user_id && v.day === day).reduce((t, v) => t + Number(v.value), 0); return sum; });
    return { user_id: s.user_id, display_name: s.display_name, rank: s.rank, score: s.score, totals };
  });
}
// Metrics whose day value is 1 or 0 (on target or not) rather than an amount.
export const dayCountMetric = (metric: string) => metric === 'water_days_on_target' || metric === 'active_days';
export type DayGridRow = { user_id: string; display_name: string; rank: number; cells: (number | null)[] };
// Each ranked member's value on each given day, in standing order; null where nothing was counted that day.
export function dayGrid(days: string[], values: { user_id: string; day: string; value: number }[], standings: Pick<CompetitionStanding, 'user_id' | 'display_name' | 'rank' | 'score'>[]): DayGridRow[] {
  const at = new Map(values.map((v) => [`${v.user_id} ${v.day}`, Number(v.value)]));
  return standings.filter((s): s is typeof s & { rank: number } => s.rank !== null && s.score !== null).sort((a, b) => a.rank - b.rank)
    .map((s) => ({ user_id: s.user_id, display_name: s.display_name, rank: s.rank, cells: days.map((d) => at.get(`${s.user_id} ${d}`) ?? null) }));
}
// Who had the biggest value each day (ties share it); nobody wins a day where the best is zero or missing.
export const dayWinners = (rows: DayGridRow[], dayCount: number) => Array.from({ length: dayCount }, (_, i) => {
  const best = Math.max(0, ...rows.map((r) => r.cells[i] ?? 0));
  return best > 0 ? rows.filter((r) => r.cells[i] === best).map((r) => r.user_id) : [];
});
const longestRun = (cells: (number | null)[]) => cells.reduce<[number, number]>(([run, best], v) => { const n = (v ?? 0) > 0 ? run + 1 : 0; return [n, Math.max(best, n)]; }, [0, 0])[1];
const mean = (cells: (number | null)[]) => { const v = cells.filter((x): x is number => x !== null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
// `who` holds user ids, so the card can say "You".
export type Highlight = { key: string; title: string; who: string[]; detail: string };
// Fun facts from the day-by-day values. `rows` cover the days so far (today last when `live`); a day still in progress
// is left out of comparisons it would unfairly drag down. Each highlight appears only when it says something.
export function competitionHighlights(rows: DayGridRow[], days: string[], live: boolean, metric: string, scoring: string, standings: Pick<CompetitionStanding, 'user_id' | 'display_name' | 'rank' | 'score'>[]): Highlight[] {
  if (rows.length < 2 || !days.length) return [];
  const unit = metricUnit(metric); const counts = dayCountMetric(metric);
  const done = live ? days.length - 1 : days.length;
  const short = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const out: Highlight[] = [];
  if (!counts) {
    const big = rows.flatMap((r) => r.cells.map((v, i) => ({ r, v: v ?? 0, i }))).reduce((a, b) => (b.v > a.v ? b : a));
    if (big.v > 0) out.push({ key: 'biggest', title: 'Biggest day', who: [big.r.user_id], detail: `${big.v.toLocaleString()} ${unit} on ${short(days[big.i])}` });
    const wins = dayWinners(rows, days.length).flat().reduce<Record<string, number>>((m, id) => ({ ...m, [id]: (m[id] ?? 0) + 1 }), {});
    const most = Math.max(0, ...Object.values(wins));
    if (most > 1) out.push({ key: 'wins', title: 'Most days won', who: Object.keys(wins).filter((id) => wins[id] === most), detail: `${most} of ${days.length} days` });
  }
  const runs = rows.map((r) => longestRun(r.cells)); const run = Math.max(...runs);
  if (run >= 2) out.push({ key: 'streak', title: 'Longest streak', who: rows.filter((_, i) => runs[i] === run).map((r) => r.user_id), detail: `${run} days in a row ${metric === 'water_days_on_target' ? 'on target' : counts ? 'active' : `with ${unit}`}` });
  if (counts && done >= 2) {
    const perfect = rows.filter((r) => r.cells.slice(0, done).every((v) => v === 1));
    if (perfect.length) out.push({ key: 'perfect', title: 'Perfect so far', who: perfect.map((r) => r.user_id), detail: `Every finished day ${metric === 'water_days_on_target' ? 'on target' : 'active'}` });
  }
  if (!counts && done >= 4) {
    // Most improved: second half of the finished days against the first half.
    const half = Math.floor(done / 2);
    const gains = rows.map((r) => { const a = mean(r.cells.slice(0, half)); const b = mean(r.cells.slice(half, done)); return a === null || b === null ? null : b - a; });
    const gain = Math.max(0, ...gains.map((g) => g ?? 0));
    if (gain > 0) out.push({ key: 'improved', title: 'Most improved', who: [rows[gains.indexOf(gain)].user_id], detail: `+${Math.round(gain).toLocaleString()} ${unit} a day lately` });
  }
  if (!counts && done >= 3) {
    // Steadiest: smallest swing around their own average, among people with at least three finished days counted.
    const spread = rows.map((r) => { const v = r.cells.slice(0, done).filter((x): x is number => x !== null); const m = mean(v); return v.length < 3 || !m ? null : Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / v.length) / m; });
    const ok = spread.filter((s): s is number => s !== null);
    if (ok.length >= 2) out.push({ key: 'steady', title: 'Steadiest', who: [rows[spread.indexOf(Math.min(...ok))].user_id], detail: `Most even ${unit} day to day` });
  }
  // Closest battle: the two neighbouring ranks nearest each other, once there are at least three people to compare.
  const ranked = standings.filter((s): s is typeof s & { rank: number; score: number } => s.rank !== null && s.score !== null).sort((a, b) => a.rank - b.rank);
  if (ranked.length >= 3) {
    const pairs = ranked.slice(1).map((s, i) => ({ a: ranked[i], b: s, gap: ranked[i].score - s.score }));
    const close = pairs.reduce((x, y) => (y.gap < x.gap ? y : x));
    out.push({ key: 'battle', title: 'Closest battle', who: [close.a.user_id, close.b.user_id], detail: close.gap === 0 ? 'Dead even' : `${standingValue({ score: close.gap, eligibility: 'eligible' }, metric, scoring)} apart` });
  }
  return out;
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
