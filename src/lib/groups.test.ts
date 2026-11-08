import {
  createGroup,
  deleteGroup,
  deleteMemberManualSteps,
  friendlyError,
  getGroupFood,
  getGroupWater,
  getGroupWorkouts,
  getMyShares,
  inviteLink,
  isValidCode,
  joinGroup,
  leaveGroup,
  listMyGroups,
  removeMember,
  renameGroup,
  setShare,
  normalizeCode,
} from './groups';
import { supabase } from './supabase';

jest.mock('./supabase', () => ({
  supabase: { rpc: jest.fn(), from: jest.fn(), auth: { getSession: jest.fn() } },
}));
const rpc = supabase.rpc as unknown as jest.Mock;
const from = supabase.from as unknown as jest.Mock;
const getSession = supabase.auth.getSession as unknown as jest.Mock;

beforeEach(() => jest.clearAllMocks());

test('normalizeCode trims, uppercases, strips spaces and dashes', () => {
  expect(normalizeCode('  k74m-q29x ')).toBe('K74MQ29X');
  expect(normalizeCode('k7 4m - q2 9x')).toBe('K74MQ29X');
});

test('isValidCode needs 8 chars from the invite alphabet', () => {
  expect(isValidCode('K74MQ29X')).toBe(true);
  expect(isValidCode('K74MQ29')).toBe(false);
  expect(isValidCode('K74MQ29XX')).toBe(false);
  for (const bad of ['I', 'O', '0', '1']) expect(isValidCode(`K74MQ29${bad}`)).toBe(false);
});

test('inviteLink', () => {
  expect(inviteLink('K74MQ29X')).toBe('leaderboard://join/K74MQ29X');
});

test('friendlyError maps known Postgres errors', () => {
  expect(friendlyError({ message: 'invalid invite code' })).toMatch(/doesn't match a group/);
  expect(friendlyError(new Error('not authenticated'))).toMatch(/sign in/);
  expect(friendlyError({ message: 'boom: secret detail' })).not.toMatch(/boom/);
});

test('joinGroup validates before calling, then sends the normalized code', async () => {
  await expect(joinGroup('abc')).rejects.toThrow(/8 characters/);
  expect(rpc).not.toHaveBeenCalled();
  rpc.mockResolvedValue({ data: 'gid', error: null });
  await expect(joinGroup(' k74m-q29x')).resolves.toBe('gid');
  expect(rpc).toHaveBeenCalledWith('join_group', { code: 'K74MQ29X' });
});

test('joinGroup maps an unknown code error', async () => {
  rpc.mockResolvedValue({ data: null, error: { message: 'invalid invite code' } });
  await expect(joinGroup('K74MQ29X')).rejects.toThrow(/doesn't match a group/);
});

test('createGroup trims, validates length, maps the row', async () => {
  await expect(createGroup('   ')).rejects.toThrow(/1 to 60/);
  await expect(createGroup('x'.repeat(61))).rejects.toThrow(/1 to 60/);
  rpc.mockResolvedValue({ data: { id: 'g1', name: 'Office', invite_code: 'K74MQ29X' }, error: null });
  await expect(createGroup(' Office ')).resolves.toEqual({ id: 'g1', name: 'Office', inviteCode: 'K74MQ29X' });
  expect(rpc).toHaveBeenCalledWith('create_group', { name: 'Office' });
});

test('listMyGroups filters to the caller, flattens, sorts by name', async () => {
  getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
  const eq = jest.fn().mockResolvedValue({
    data: [
      { role: 'member', groups: { id: 'b', name: 'Zed', group_members: [{ count: 3 }] } },
      { role: 'owner', groups: { id: 'a', name: 'Alpha', group_members: [{ count: 1 }] } },
    ],
    error: null,
  });
  from.mockReturnValue({ select: () => ({ eq }) });
  await expect(listMyGroups()).resolves.toEqual([
    { id: 'a', name: 'Alpha', role: 'owner', memberCount: 1 },
    { id: 'b', name: 'Zed', role: 'member', memberCount: 3 },
  ]);
  expect(eq).toHaveBeenCalledWith('user_id', 'u1');
});

test('listMyGroups rejects when signed out', async () => {
  getSession.mockResolvedValue({ data: { session: null } });
  await expect(listMyGroups()).rejects.toThrow(/sign in/);
});

// Chain stub for from(...).delete().eq().eq().select() resolving to `result`.
function deleteChain(result: { data: unknown[] | null; error: unknown }) {
  const chain: Record<string, jest.Mock> = {};
  for (const k of ['delete', 'update', 'eq']) chain[k] = jest.fn(() => chain);
  chain.select = jest.fn().mockResolvedValue(result);
  from.mockReturnValue(chain);
  return chain;
}

test('deleteGroup deletes by id and treats 0 rows as not allowed', async () => {
  const chain = deleteChain({ data: [{ id: 'g' }], error: null });
  await expect(deleteGroup('g')).resolves.toBeUndefined();
  expect(from).toHaveBeenCalledWith('groups');
  expect(chain.eq).toHaveBeenCalledWith('id', 'g');
  deleteChain({ data: [], error: null });
  await expect(deleteGroup('g')).rejects.toThrow(/Only the group owner/);
});

test('leaveGroup removes only my membership; owner gets told to delete', async () => {
  getSession.mockResolvedValue({ data: { session: { user: { id: 'me' } } } });
  const chain = deleteChain({ data: [{ user_id: 'me' }], error: null });
  await expect(leaveGroup('g')).resolves.toBeUndefined();
  expect(from).toHaveBeenCalledWith('group_members');
  expect(chain.eq).toHaveBeenCalledWith('group_id', 'g');
  expect(chain.eq).toHaveBeenCalledWith('user_id', 'me');
  deleteChain({ data: [], error: null });
  await expect(leaveGroup('g')).rejects.toThrow(/Delete the group instead/);
});

test('renameGroup trims, validates, and treats 0 rows as not allowed', async () => {
  await expect(renameGroup('g', '   ')).rejects.toThrow(/1 to 60/);
  const chain = deleteChain({ data: [{ id: 'g' }], error: null });
  await renameGroup('g', '  Office  ');
  expect(chain.update).toHaveBeenCalledWith({ name: 'Office' });
  deleteChain({ data: [], error: null });
  await expect(renameGroup('g', 'Office')).rejects.toThrow(/Only the group owner/);
});

test('owner RPCs send the right args and map errors', async () => {
  rpc.mockResolvedValue({ data: null, error: null });
  await removeMember('g', 'u');
  expect(rpc).toHaveBeenCalledWith('remove_member', { p_group_id: 'g', p_user_id: 'u' });
  await deleteMemberManualSteps('g', 'u');
  expect(rpc).toHaveBeenCalledWith('delete_member_manual_entry', { p_group_id: 'g', p_user_id: 'u', p_metric: 'steps' });
  rpc.mockResolvedValue({ data: null, error: { message: 'no manual entry for today' } });
  await expect(deleteMemberManualSteps('g', 'u')).rejects.toThrow(/no manual steps for today/);
});

test('getMyShares reads only my rows for the group', async () => {
  getSession.mockResolvedValue({ data: { session: { user: { id: 'me' } } } });
  const eq = jest.fn();
  const chain = { eq };
  eq.mockReturnValueOnce(chain).mockResolvedValueOnce({ data: [{ metric: 'steps' }, { metric: 'sleep' }], error: null });
  from.mockReturnValue({ select: () => chain });
  await expect(getMyShares('g')).resolves.toEqual(['steps', 'sleep']);
  expect(from).toHaveBeenCalledWith('metric_shares');
  expect(eq).toHaveBeenCalledWith('group_id', 'g');
  expect(eq).toHaveBeenCalledWith('user_id', 'me');
});

test('setShare inserts my row to share and deletes it to stop', async () => {
  getSession.mockResolvedValue({ data: { session: { user: { id: 'me' } } } });
  const upsert = jest.fn().mockResolvedValue({ data: null, error: null });
  const match = jest.fn().mockResolvedValue({ data: null, error: null });
  from.mockReturnValue({ upsert, delete: () => ({ match }) });
  await setShare('g', 'weight', true);
  expect(upsert).toHaveBeenCalledWith({ group_id: 'g', user_id: 'me', metric: 'weight' }, { ignoreDuplicates: true });
  await setShare('g', 'weight', false);
  expect(match).toHaveBeenCalledWith({ group_id: 'g', user_id: 'me', metric: 'weight' });
  upsert.mockResolvedValue({ data: null, error: { message: 'permission denied' } });
  await expect(setShare('g', 'sleep', true)).rejects.toThrow(/sign in/);
});

test('workouts can be shared and unshared like any metric', async () => {
  getSession.mockResolvedValue({ data: { session: { user: { id: 'me' } } } });
  const upsert = jest.fn().mockResolvedValue({ data: null, error: null });
  const match = jest.fn().mockResolvedValue({ data: null, error: null });
  from.mockReturnValue({ upsert, delete: () => ({ match }) });
  await setShare('g', 'workouts', true);
  expect(upsert).toHaveBeenCalledWith({ group_id: 'g', user_id: 'me', metric: 'workouts' }, { ignoreDuplicates: true });
  await setShare('g', 'workouts', false);
  expect(match).toHaveBeenCalledWith({ group_id: 'g', user_id: 'me', metric: 'workouts' });
});

test('getGroupWorkouts asks for whole weeks through tomorrow, and rethrows errors untouched', async () => {
  jest.useFakeTimers().setSystemTime(new Date(2026, 9, 28, 12)); // Wednesday
  try {
    rpc.mockResolvedValue({ data: [{ user_id: 'a', week_start: '2026-10-26', workout_count: 2, total_duration_s: 5400 }], error: null });
    await expect(getGroupWorkouts('g', 4)).resolves.toHaveLength(1);
    expect(rpc).toHaveBeenCalledWith('group_workouts', { p_group_id: 'g', p_from: '2026-10-05', p_to: '2026-10-29' });
    const err = { message: 'not a member of this group' };
    rpc.mockResolvedValue({ data: null, error: err });
    await expect(getGroupWorkouts('g')).rejects.toBe(err);
  } finally {
    jest.useRealTimers();
  }
});

test('food can be shared and unshared like any metric', async () => {
  getSession.mockResolvedValue({ data: { session: { user: { id: 'me' } } } });
  const upsert = jest.fn().mockResolvedValue({ data: null, error: null });
  const match = jest.fn().mockResolvedValue({ data: null, error: null });
  from.mockReturnValue({ upsert, delete: () => ({ match }) });
  await setShare('g', 'food', true);
  expect(upsert).toHaveBeenCalledWith({ group_id: 'g', user_id: 'me', metric: 'food' }, { ignoreDuplicates: true });
  await setShare('g', 'food', false);
  expect(match).toHaveBeenCalledWith({ group_id: 'g', user_id: 'me', metric: 'food' });
});

test('getGroupFood asks for the last days through tomorrow, and rethrows errors untouched', async () => {
  jest.useFakeTimers().setSystemTime(new Date(2026, 9, 28, 12));
  try {
    rpc.mockResolvedValue({ data: [{ user_id: 'a', local_date: '2026-10-28' }], error: null });
    await expect(getGroupFood('g', 7)).resolves.toHaveLength(1);
    expect(rpc).toHaveBeenCalledWith('group_food', { p_group_id: 'g', p_from: '2026-10-22', p_to: '2026-10-29' });
    const err = { message: 'not a member of this group' };
    rpc.mockResolvedValue({ data: null, error: err });
    await expect(getGroupFood('g')).rejects.toBe(err);
  } finally {
    jest.useRealTimers();
  }
});

test('getGroupWater asks for the last days through tomorrow', async () => {
  jest.useFakeTimers().setSystemTime(new Date(2026, 9, 28, 12));
  try {
    rpc.mockResolvedValue({ data: [{ user_id: 'a', local_date: '2026-10-28', total_ml: 500 }], error: null });
    await expect(getGroupWater('g', 7)).resolves.toHaveLength(1);
    expect(rpc).toHaveBeenCalledWith('group_water', { p_group_id: 'g', p_from: '2026-10-22', p_to: '2026-10-29' });
  } finally {
    jest.useRealTimers();
  }
});
