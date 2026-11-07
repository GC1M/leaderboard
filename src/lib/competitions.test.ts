import { competitionDay, competitionInviteLink, competitionState, createCompetition, joinCompetition, leaveCompetition } from './competitions';
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
