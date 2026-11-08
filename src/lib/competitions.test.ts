import { competitionDay, competitionGap, competitionInviteLink, competitionState, createCompetition, joinCompetition, leaveCompetition } from './competitions';
const mockRpc = jest.fn();
jest.mock('./supabase', () => ({ supabase: { rpc: (...args: unknown[]) => mockRpc(...args) } }));
beforeEach(() => { jest.clearAllMocks(); mockRpc.mockResolvedValue({ data: null, error: null }); });
test('competition invites use the existing group join flow and reject arbitrary paths', () => {
  const id = '00000000-0000-0000-0000-000000000039';
  expect(competitionInviteLink('ABCD2345', id)).toBe(`leaderboard://join/ABCD2345?competition=${id}`);
  expect(() => competitionInviteLink('ABCD2345', 'https://outside.example')).toThrow();
});
test('creation sends rules and dates but never enrolls the creator', async () => {
  await createCompetition({ groupId: 'g1', name: 'Walk', firstDay: '2027-03-14', endDay: '2027-03-15', timezone: 'America/New_York', includeManual: false });
  expect(mockRpc).toHaveBeenCalledTimes(1);
  expect(mockRpc).toHaveBeenCalledWith('create_competition', expect.objectContaining({ p_metric: 'steps', p_timezone: 'America/New_York', p_include_manual: false }));
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
  expect(competitionGap([r('a', 600, 2), r('b', 1800, 1)], 'a', 'workout_duration')).toBe('20 min behind b for 1st');
});
