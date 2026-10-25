import {
  createGroup,
  deleteGroup,
  deleteMemberSteps,
  friendlyError,
  inviteLink,
  isValidCode,
  joinGroup,
  leaveGroup,
  listMyGroups,
  removeMember,
  renameGroup,
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
  await deleteMemberSteps('g', 'u', '2026-10-25');
  expect(rpc).toHaveBeenCalledWith('delete_member_metric', { p_group_id: 'g', p_user_id: 'u', p_date: '2026-10-25', p_metric: 'steps' });
  rpc.mockResolvedValue({ data: null, error: { message: 'no entry for that day' } });
  await expect(deleteMemberSteps('g', 'u', '2026-10-25')).rejects.toThrow(/no steps for that day/);
});
