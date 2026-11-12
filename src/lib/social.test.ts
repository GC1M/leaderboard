import {
  acceptFriendRequest,
  listFriends,
  listMessages,
  listPeopleToAdd,
  removeFriend,
  sendFriendRequest,
  sendMessage,
  threadFromParams,
  watchThread,
} from './social';
import { supabase } from './supabase';

jest.mock('./supabase', () => ({
  supabase: { from: jest.fn(), channel: jest.fn(), removeChannel: jest.fn(), auth: { getSession: jest.fn() } },
}));
const from = supabase.from as unknown as jest.Mock;
const channel = supabase.channel as unknown as jest.Mock;
const getSession = supabase.auth.getSession as unknown as jest.Mock;

const ME = '11111111-1111-1111-1111-111111111111';
const BOB = '22222222-2222-2222-2222-222222222222';

// A PostgREST builder stand-in: every call chains and records, and awaiting it yields `result`.
function builder(result: { data?: unknown; error?: unknown }) {
  const calls: [string, unknown[]][] = [];
  const b: Record<string, unknown> = {
    calls,
    then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve({ data: null, error: null, ...result }).then(ok, bad),
  };
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'neq', 'or', 'order', 'limit', 'maybeSingle'])
    b[m] = (...args: unknown[]) => (calls.push([m, args]), b);
  return b as { calls: [string, unknown[]][] };
}

beforeEach(() => {
  jest.clearAllMocks();
  getSession.mockResolvedValue({ data: { session: { user: { id: ME } } } });
});

test('threadFromParams takes the first valid id and rejects junk', () => {
  expect(threadFromParams({ group: BOB })).toEqual({ kind: 'group', id: BOB });
  expect(threadFromParams({ competition: BOB })).toEqual({ kind: 'competition', id: BOB });
  expect(threadFromParams({ friend: BOB })).toEqual({ kind: 'friend', id: BOB });
  expect(threadFromParams({ group: 'nope', friend: 'x),or(1' })).toBeNull();
  expect(threadFromParams({})).toBeNull();
});

test('listFriends labels each row from the caller side and sorts by name', async () => {
  from.mockReturnValue(builder({ data: [
    { requester_id: ME, addressee_id: BOB, status: 'pending', requester: { display_name: 'Me' }, addressee: { display_name: 'Zed' } },
    { requester_id: BOB, addressee_id: ME, status: 'pending', requester: { display_name: 'Amy' }, addressee: { display_name: 'Me' } },
    { requester_id: ME, addressee_id: 'c', status: 'accepted', requester: { display_name: 'Me' }, addressee: null },
  ] }));
  expect(await listFriends()).toEqual([
    { userId: BOB, name: 'Amy', status: 'incoming' },
    { userId: 'c', name: 'Unknown', status: 'friend' },
    { userId: BOB, name: 'Zed', status: 'outgoing' },
  ]);
});

test('listPeopleToAdd dedupes group mates and skips existing friends and requests', async () => {
  const b = builder({ data: [
    { user_id: BOB, profiles: { display_name: 'Bob' } },
    { user_id: BOB, profiles: { display_name: 'Bob' } },
    { user_id: 'c', profiles: { display_name: 'Cat' } },
  ] });
  from.mockReturnValue(b);
  expect(await listPeopleToAdd([{ userId: 'c', name: 'Cat', status: 'outgoing' }])).toEqual([{ userId: BOB, name: 'Bob' }]);
  expect(b.calls).toContainEqual(['neq', ['user_id', ME]]);
});

test('sendFriendRequest treats an existing request as done and other errors as failures', async () => {
  const b = builder({ error: { code: '23505' } });
  from.mockReturnValue(b);
  await expect(sendFriendRequest(BOB)).resolves.toBeUndefined();
  expect(b.calls).toContainEqual(['insert', [{ requester_id: ME, addressee_id: BOB }]]);
  from.mockReturnValue(builder({ error: { code: '42501', message: 'row-level security' } }));
  await expect(sendFriendRequest(BOB)).rejects.toThrow(/Couldn't send/);
});

test('acceptFriendRequest only accepts a request addressed to me, and says so when it is gone', async () => {
  const b = builder({ data: [{ status: 'accepted' }] });
  from.mockReturnValue(b);
  await acceptFriendRequest(BOB);
  expect(b.calls).toEqual(expect.arrayContaining([['update', [{ status: 'accepted' }]], ['eq', ['requester_id', BOB]], ['eq', ['addressee_id', ME]]]));
  from.mockReturnValue(builder({ data: [] }));
  await expect(acceptFriendRequest(BOB)).rejects.toThrow(/no longer there/);
});

test('removeFriend deletes the pair either way round', async () => {
  const b = builder({ data: null });
  from.mockReturnValue(b);
  await removeFriend(BOB);
  expect(b.calls).toContainEqual(['or', [`and(requester_id.eq.${ME},addressee_id.eq.${BOB}),and(requester_id.eq.${BOB},addressee_id.eq.${ME})`]]);
});

test('listMessages filters by thread and maps rows newest first', async () => {
  const b = builder({ data: [{ id: 'm1', sender_id: BOB, body: 'hi', created_at: 't', sender: null }] });
  from.mockReturnValue(b);
  expect(await listMessages({ kind: 'group', id: BOB }, ME)).toEqual([{ id: 'm1', senderId: BOB, senderName: 'Former member', body: 'hi', createdAt: 't' }]);
  expect(b.calls).toEqual(expect.arrayContaining([['eq', ['group_id', BOB]], ['order', ['created_at', { ascending: false }]], ['limit', [100]]]));
  const dm = builder({ data: [] });
  from.mockReturnValue(dm);
  await listMessages({ kind: 'friend', id: BOB }, ME);
  expect(dm.calls).toContainEqual(['or', [`and(sender_id.eq.${ME},recipient_id.eq.${BOB}),and(sender_id.eq.${BOB},recipient_id.eq.${ME})`]]);
});

test('sendMessage trims, skips blanks, sets exactly one thread column and explains RLS refusals', async () => {
  const b = builder({});
  from.mockReturnValue(b);
  await sendMessage({ kind: 'competition', id: BOB }, '   ');
  expect(from).not.toHaveBeenCalled();
  await sendMessage({ kind: 'competition', id: BOB }, ' go ');
  expect(b.calls).toContainEqual(['insert', [{ body: 'go', group_id: null, competition_id: BOB, recipient_id: null }]]);
  await expect(sendMessage({ kind: 'group', id: BOB }, 'x'.repeat(2001))).rejects.toThrow(/2000/);
  from.mockReturnValue(builder({ error: { message: 'new row violates row-level security policy for table "messages"' } }));
  await expect(sendMessage({ kind: 'friend', id: BOB }, 'hi')).rejects.toThrow(/only message friends/);
  await expect(sendMessage({ kind: 'competition', id: BOB }, 'hi')).rejects.toThrow(/Join the competition/);
  from.mockReturnValue(builder({ error: { message: 'fetch failed' } }));
  await expect(sendMessage({ kind: 'group', id: BOB }, 'hi')).rejects.toThrow(/connection/);
});

test('watchThread subscribes with the thread filter and unsubscribes on cleanup', () => {
  const ch = { on: jest.fn(), subscribe: jest.fn() };
  ch.on.mockReturnValue(ch);
  ch.subscribe.mockReturnValue(ch);
  channel.mockReturnValue(ch);
  const stop = watchThread({ kind: 'group', id: BOB }, ME, jest.fn());
  expect(ch.on).toHaveBeenCalledWith('postgres_changes', expect.objectContaining({ table: 'messages', filter: `group_id=eq.${BOB}` }), expect.any(Function));
  stop();
  expect(supabase.removeChannel).toHaveBeenCalledWith(ch);
  watchThread({ kind: 'friend', id: BOB }, ME, jest.fn());
  expect(ch.on).toHaveBeenLastCalledWith('postgres_changes', expect.objectContaining({ filter: `recipient_id=eq.${ME}` }), expect.any(Function));
});
