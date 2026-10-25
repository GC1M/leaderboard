import { supabase } from './supabase';

// Mirrors gen_invite_code(): no I, O, 0, 1.
const CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/;

export type MyGroup = { id: string; name: string; role: 'owner' | 'member'; memberCount: number };
export type CreatedGroup = { id: string; name: string; inviteCode: string };

export function normalizeCode(input: string): string {
  return input.replace(/[\s-]/g, '').toUpperCase();
}

export function isValidCode(code: string): boolean {
  return CODE_RE.test(code);
}

export function inviteLink(code: string): string {
  return `leaderboard://join/${code}`;
}

export function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String(e.message) : '';
  if (msg.includes('invalid invite code')) return "That code doesn't match a group. Check it with whoever invited you.";
  if (msg.includes('not authenticated') || msg.includes('permission denied')) return 'You need to sign in first.';
  return 'Something went wrong. Check your connection and try again.';
}

async function friendly<T>(p: PromiseLike<{ data: T | null; error: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(friendlyError(error));
  return data as T;
}

export async function listMyGroups(): Promise<MyGroup[]> {
  const { data: auth } = await supabase.auth.getSession();
  const uid = auth.session?.user.id;
  if (!uid) throw new Error(friendlyError({ message: 'not authenticated' }));
  // RLS also exposes co-members' rows, so filter to the caller's own memberships.
  const rows = await friendly(
    supabase.from('group_members').select('role, groups(id, name, group_members(count))').eq('user_id', uid),
  );
  return rows
    .flatMap((r) => (r.groups ? [{ r, g: r.groups }] : []))
    .map(({ r, g }) => ({
      id: g.id,
      name: g.name,
      role: r.role as MyGroup['role'],
      memberCount: g.group_members[0]?.count ?? 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function createGroup(name: string): Promise<CreatedGroup> {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 60) throw new Error('Group name must be 1 to 60 characters.');
  const g = await friendly(supabase.rpc('create_group', { name: trimmed }));
  return { id: g.id, name: g.name, inviteCode: g.invite_code };
}

/** Returns the joined group's id. */
export async function joinGroup(input: string): Promise<string> {
  const code = normalizeCode(input);
  if (!isValidCode(code)) throw new Error('Invite codes are 8 characters, letters and numbers only.');
  return friendly(supabase.rpc('join_group', { code }));
}
