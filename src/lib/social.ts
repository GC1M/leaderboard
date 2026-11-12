import { friendly, isValidGroupId, myId } from './groups';
import { supabase } from './supabase';

// Friends: a request either way, accepted by the person asked. Declining, cancelling and unfriending delete the row.
export type Friend = { userId: string; name: string; status: 'friend' | 'incoming' | 'outgoing' };
export type Person = { userId: string; name: string };

export async function listFriends(): Promise<Friend[]> {
  const uid = await myId();
  const rows = await friendly(
    supabase
      .from('friendships')
      .select('requester_id, addressee_id, status, requester:profiles!friendships_requester_id_fkey(display_name), addressee:profiles!friendships_addressee_id_fkey(display_name)'),
  );
  return rows
    .map((r) => {
      const mine = r.requester_id === uid;
      return {
        userId: mine ? r.addressee_id : r.requester_id,
        name: (mine ? r.addressee : r.requester)?.display_name ?? 'Unknown',
        status: r.status === 'accepted' ? 'friend' : mine ? 'outgoing' : 'incoming',
      } as Friend;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** People you share a group with (so also anyone in your competitions) who aren't already a friend or request. */
export async function listPeopleToAdd(known: Friend[]): Promise<Person[]> {
  const uid = await myId();
  const rows = await friendly(supabase.from('group_members').select('user_id, profiles(display_name)').neq('user_id', uid));
  const skip = new Set(known.map((f) => f.userId));
  const out = new Map<string, Person>();
  for (const r of rows) if (!skip.has(r.user_id)) out.set(r.user_id, { userId: r.user_id, name: r.profiles?.display_name ?? 'Unknown' });
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function sendFriendRequest(userId: string): Promise<void> {
  const uid = await myId();
  const { error } = await supabase.from('friendships').insert({ requester_id: uid, addressee_id: userId });
  // 23505: a request already exists one way or the other.
  if (error && (error as { code?: string }).code !== '23505') throw new Error("Couldn't send that request. Check your connection and try again.");
}

export async function acceptFriendRequest(userId: string): Promise<void> {
  const uid = await myId();
  const rows = await friendly(
    supabase.from('friendships').update({ status: 'accepted' }).eq('requester_id', userId).eq('addressee_id', uid).select('status'),
  );
  if (!rows?.length) throw new Error('That request is no longer there.');
}

/** Declines an incoming request, cancels an outgoing one, or unfriends. */
export async function removeFriend(userId: string): Promise<void> {
  const uid = await myId();
  await friendly(
    supabase.from('friendships').delete().or(`and(requester_id.eq.${uid},addressee_id.eq.${userId}),and(requester_id.eq.${userId},addressee_id.eq.${uid})`),
  );
}

// Chat: one thread per group, per competition, and per friend pair.
export type Thread = { kind: 'group' | 'competition' | 'friend'; id: string };
export type Message = { id: string; senderId: string; senderName: string; body: string; createdAt: string };

/** Reads the chat route's params; null when none is a valid id. */
export function threadFromParams(p: { group?: string; competition?: string; friend?: string }): Thread | null {
  for (const kind of ['group', 'competition', 'friend'] as const) {
    const id = p[kind];
    if (typeof id === 'string' && isValidGroupId(id)) return { kind, id };
  }
  return null;
}

export async function threadTitle(t: Thread): Promise<string> {
  const { data } = t.kind === 'friend'
    ? await supabase.from('profiles').select('name:display_name').eq('id', t.id).maybeSingle()
    : t.kind === 'group'
      ? await supabase.from('groups').select('name').eq('id', t.id).maybeSingle()
      : await supabase.from('competitions').select('name').eq('id', t.id).maybeSingle();
  return data?.name ?? 'Chat';
}

/** Newest first. */
export async function listMessages(t: Thread, uid: string, limit = 100): Promise<Message[]> {
  let q = supabase.from('messages').select('id, sender_id, body, created_at, sender:profiles!messages_sender_id_fkey(display_name)');
  q = t.kind === 'friend'
    ? q.or(`and(sender_id.eq.${uid},recipient_id.eq.${t.id}),and(sender_id.eq.${t.id},recipient_id.eq.${uid})`)
    : q.eq(t.kind === 'group' ? 'group_id' : 'competition_id', t.id);
  const rows = await friendly(q.order('created_at', { ascending: false }).limit(limit));
  return rows.map((r) => ({ id: r.id, senderId: r.sender_id, senderName: r.sender?.display_name ?? 'Former member', body: r.body, createdAt: r.created_at }));
}

export async function sendMessage(t: Thread, body: string): Promise<void> {
  const text = body.trim();
  if (!text) return;
  if (text.length > 2000) throw new Error('Messages can be up to 2000 characters.');
  const { error } = await supabase.from('messages').insert({
    body: text,
    group_id: t.kind === 'group' ? t.id : null,
    competition_id: t.kind === 'competition' ? t.id : null,
    recipient_id: t.kind === 'friend' ? t.id : null,
  });
  if (!error) return;
  throw new Error(
    String((error as { message?: string }).message).includes('row-level security')
      ? t.kind === 'friend' ? 'You can only message friends.' : t.kind === 'group' ? "You're not in this group anymore." : 'Join the competition to chat.'
      : "Couldn't send. Check your connection and try again.",
  );
}

/** Calls onChange whenever a message lands in this thread. RLS on the realtime feed hides other threads. */
export function watchThread(t: Thread, uid: string, onChange: () => void): () => void {
  // DMs can't filter on "either side", so listen for messages to you; your own sends reload after the insert.
  const filter = t.kind === 'friend' ? `recipient_id=eq.${uid}` : `${t.kind === 'group' ? 'group_id' : 'competition_id'}=eq.${t.id}`;
  const channel = supabase
    .channel(`chat:${t.kind}:${t.id}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter }, onChange)
    .subscribe();
  return () => void supabase.removeChannel(channel);
}
