import { competitionDay, competitionDays, competitionGap, dailySteps, getMyCompetitions, raceSeries, rivalPace, competitionInviteLink, competitionState, createCompetition, joinCompetition, leaveCompetition, standingValue } from './competitions';
const mockRpc = jest.fn(); const mockFrom = jest.fn();
jest.mock('./supabase', () => ({ supabase: { rpc: (...args: unknown[]) => mockRpc(...args), from: (...args: unknown[]) => mockFrom(...args) } }));
beforeEach(() => { jest.clearAllMocks(); mockRpc.mockResolvedValue({ data: null, error: null }); });
test('competition invites use the existing group join flow and reject arbitrary paths', () => {
  const id = '00000000-0000-0000-0000-000000000039';
  expect(competitionInviteLink('ABCD2345', id)).toBe(`leaderboard://join/ABCD2345?competition=${id}`);
  expect(() => competitionInviteLink('ABCD2345', 'https://outside.example')).toThrow();
});
test('creation sends rules and dates but never enrolls the creator', async () => {
  await createCompetition({ groupId: 'g1', name: 'Walk', metric: 'active_days', firstDay: '2027-03-14', endDay: '2027-03-15', timezone: 'America/New_York', includeManual: false, lateJoins: true, scoring: 'best_streak' });
  expect(mockRpc).toHaveBeenCalledTimes(1);
  expect(mockRpc).toHaveBeenCalledWith('create_competition', expect.objectContaining({ p_metric: 'active_days', p_timezone: 'America/New_York', p_include_manual: false, p_late_joins: true, p_scoring: 'best_streak' }));
});
test('join and leave are distinct server operations; failures are displayed', async () => {
  await joinCompetition('c1'); await leaveCompetition('c1');
  expect(mockRpc.mock.calls.map((c) => c[0])).toEqual(['join_competition', 'leave_competition']);
  mockRpc.mockResolvedValue({ data: null, error: { message: 'enrollment closes when the competition starts' } });
  await expect(joinCompetition('c1')).rejects.toThrow('enrollment closes');
});
test('lifecycle and date labels respect boundaries and the competition timezone', () => {
  const c = { status: 'scheduled', starts_at: '2027-03-14T05:00:00Z', ends_at: '2027-03-15T04:00:00Z' };
  expect(competitionState(c, new Date('2027-03-14T04:59:59Z'))).toBe('Upcoming');
  expect(competitionState(c, new Date(c.starts_at))).toBe('Active');
  expect(competitionState(c, new Date(c.ends_at))).toBe('Provisional results');
  expect(competitionDay(c.starts_at, 'America/New_York')).toContain('14');
  expect(competitionState({ ...c, status: 'finalized' })).toBe('Final results');
  expect(competitionState({ ...c, status: 'cancelled' })).toBe('Cancelled');
});
test('competition gap names the next place up, leads, ties, and skips unranked rows', () => {
  const r = (user_id: string, score: number | null, rank: number | null, display_name = user_id) => ({ user_id, display_name, score, rank });
  const rows = [r('m', 48310, 1, 'Maya'), r('me', 46170, 2), r('d', 39800, 3), r('p', 39800, 3), r('s', null, null)];
  expect(competitionGap(rows, 'me', 'steps')).toBe('2,140 steps behind Maya for 1st');
  expect(competitionGap(rows, 'd', 'steps')).toBe('6,370 steps behind me for 2nd');
  expect(competitionGap(rows, 'm', 'steps')).toBe('You lead by 2,140 steps');
  expect(competitionGap(rows, 's', 'steps')).toBeNull();
  expect(competitionGap([r('a', 10, 1), r('b', 10, 1)], 'a', 'steps')).toBe('Tied for 1st');
  expect(competitionGap([r('a', 5, 3), r('b', 9, 1), r('c', 9, 1)], 'a', 'steps')).toBe('4 steps behind 1st place');
  expect(competitionGap([r('a', 0, 1)], 'a', 'steps')).toBe('You are in 1st');
  expect(competitionGap([r('a', 10, 2), r('b', 30, 1)], 'a', 'workout_minutes')).toBe('20 min behind b for 1st');
  expect(competitionGap([r('a', 2, 2), r('b', 5, 1)], 'a', 'steps', 'best_streak')).toBe('3 days behind b for 1st');
  expect(competitionGap([r('a', 1200.5, 2), r('b', 1300, 1)], 'a', 'steps', 'daily_average')).toBe('99.5 steps/day behind b for 1st');
});
test('standing values carry each metric and scoring mode, with singulars', () => {
  const v = (score: number | null, metric: string, scoring?: string) => standingValue({ score, eligibility: score === null ? 'no_data' : 'eligible' }, metric, scoring);
  expect(v(6500, 'steps')).toBe('6,500 steps');
  expect(v(75, 'workout_minutes')).toBe('75 min');
  expect(v(1, 'workout_count')).toBe('1 workout');
  expect(v(2, 'workout_count')).toBe('2 workouts');
  expect(v(1, 'water_days_on_target')).toBe('1 day');
  expect(v(4, 'active_days')).toBe('4 days');
  expect(v(1300, 'steps', 'daily_average')).toBe('1,300 steps/day');
  expect(v(0.5, 'active_days', 'daily_average')).toBe('0.5 days/day');
  expect(v(3, 'water_days_on_target', 'best_streak')).toBe('3 days');
  expect(v(1, 'steps', 'best_streak')).toBe('1 day');
  expect(v(null, 'steps')).toBe('No data');
});
test('competition days follow the competition timezone across daylight saving', () => {
  expect(competitionDays({ starts_at: '2026-11-01T04:00:00Z', ends_at: '2026-11-03T05:00:00Z', timezone: 'America/New_York' })).toEqual(['2026-11-01', '2026-11-02']);
  expect(competitionDays({ starts_at: '2026-11-01T04:00:00Z', ends_at: '2026-11-02T05:00:00Z', timezone: 'America/New_York' })).toEqual(['2026-11-01']);
});
test('daily steps keep missing days apart from recorded zeroes and excluded entries', () => {
  const rows = dailySteps(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04'], [
    { measured_on: '2026-11-01', value: 4000, included: true }, { measured_on: '2026-11-01', value: 500, included: true },
    { measured_on: '2026-11-02', value: 0, included: true }, { measured_on: '2026-11-03', value: 900, included: false, reason: 'manual_entries_excluded' }, { measured_on: '2026-11-03', value: 300, included: false, reason: 'not_sharing' },
  ], '2026-11-03');
  expect(rows.map((r) => [r.value, r.excluded, r.future])).toEqual([[4500, 0, false], [0, 0, false], [null, 900, false], [null, 0, true]]);
});
test('race series add each day up in standing order, carry gaps forward and leave unranked members out', () => {
  const lines = raceSeries(['2026-11-01', '2026-11-02', '2026-11-03'], [
    { user_id: 'b', day: '2026-11-01', value: 5 }, { user_id: 'b', day: '2026-11-03', value: 1 },
    { user_id: 'a', day: '2026-11-01', value: 1 }, { user_id: 'a', day: '2026-11-02', value: 2 }, { user_id: 'a', day: '2026-11-03', value: 3 },
    { user_id: 'c', day: '2026-11-01', value: 9 },
  ], [{ user_id: 'b', display_name: 'Theo', rank: 2, score: 6 }, { user_id: 'a', display_name: 'Maya', rank: 1, score: 6 }, { user_id: 'c', display_name: 'Ana', rank: null, score: null }]);
  expect(lines.map((l) => [l.display_name, l.totals])).toEqual([['Maya', [1, 3, 6]], ['Theo', [5, 5, 6]]]);
});
test('rival pace chases the nearest person ahead, or the runner-up when you lead', () => {
  const rows = [{ user_id: 'a', display_name: 'Maya', score: 90 }, { user_id: 'b', display_name: 'Theo', score: 60 }, { user_id: 'me', display_name: 'Sam', score: 50 }, { user_id: 'c', display_name: 'Ana', score: null }];
  expect(rivalPace(rows, 'me', 3)).toEqual({ name: 'Theo', perDay: 20 });
  expect(rivalPace(rows, 'a', 3)).toEqual({ name: 'Theo', perDay: 20 });
  expect(rivalPace([rows[2]], 'me', 3)).toBeNull();
  expect(rivalPace(rows, 'c', 3)).toBeNull();
});
test('rival pace edges', () => {
  const r = (user_id: string, score: number | null) => ({ user_id, display_name: user_id, score });
  expect(rivalPace([r('me', 5), r('a', 9)], 'me', 0)).toBeNull();
  expect(rivalPace([r('me', 5), r('a', 9)], 'me', 2)).toEqual({ name: 'a', perDay: 5 });
  expect(rivalPace([r('me', 9), r('a', 9)], 'me', 3)).toEqual({ name: 'a', perDay: 3 });
  expect(rivalPace([r('me', 10), r('a', 30), r('b', 20)], 'me', 1)).toEqual({ name: 'b', perDay: 20 });
  expect(rivalPace([r('me', 0), r('a', null)], 'me', 2)).toBeNull();
});
test('daily steps count only rule exclusions and keep mixed days apart', () => {
  const rows = dailySteps(['2026-11-01'], [{ measured_on: '2026-11-01', value: 100, included: true }, { measured_on: '2026-11-01', value: 50, included: false, reason: 'manual_entries_excluded' }, { measured_on: '2026-11-01', value: 70, included: false, reason: 'timezone_mismatch' }], '2026-10-31');
  expect(rows[0]).toEqual({ day: '2026-11-01', value: 100, excluded: 50, future: true });
});
test('competition days: short spring-forward day and empty range', () => {
  expect(competitionDays({ starts_at: '2027-03-14T05:00:00Z', ends_at: '2027-03-15T04:00:00Z', timezone: 'America/New_York' })).toEqual(['2027-03-14']);
  expect(competitionDays({ starts_at: '2027-03-14T05:00:00Z', ends_at: '2027-03-14T05:00:00Z', timezone: 'America/New_York' })).toEqual([]);
});
test('my competitions mark the ones you joined and surface errors', async () => {
  type Chain = { select: jest.Mock; eq: jest.Mock; order: jest.Mock; then: (resolve: (v: unknown) => unknown) => unknown };
  const chain = (result: unknown) => { const q = { then: (resolve: (v: unknown) => unknown) => resolve(result) } as Chain; q.select = jest.fn(() => q); q.eq = jest.fn(() => q); q.order = jest.fn(() => q); return q; };
  const comps = chain({ data: [{ id: 'c1' }, { id: 'c2' }], error: null }); const parts = chain({ data: [{ competition_id: 'c2' }], error: null });
  mockFrom.mockImplementation((t: string) => (t === 'competitions' ? comps : parts));
  expect((await getMyCompetitions('u1')).map((c) => [c.id, c.joined])).toEqual([['c1', false], ['c2', true]]);
  expect(comps.select).toHaveBeenCalledWith('*, groups(name)');
  expect(parts.eq).toHaveBeenCalledWith('user_id', 'u1'); expect(parts.eq).toHaveBeenCalledWith('status', 'joined');
  mockFrom.mockImplementation(() => chain({ data: null, error: { message: 'boom' } }));
  await expect(getMyCompetitions('u1')).rejects.toThrow('boom');
});
