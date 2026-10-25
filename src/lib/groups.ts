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
  if (msg.includes('only the group owner')) return 'Only the group owner can do that.';
  if (msg.includes('no manual entry for today')) return 'They have no manual steps for today. Health steps sync from their phone and can\'t be deleted.';
  if (msg.includes('not a member of this group')) return "That person isn't in this group anymore.";
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

// RLS turns a forbidden write into "0 rows", not an error, so check that a row was actually touched.
async function touchedOne(p: PromiseLike<{ data: unknown[] | null; error: unknown }>, notAllowed: string) {
  const rows = await friendly(p);
  if (!rows?.length) throw new Error(notAllowed);
}

/** Owner only. Memberships go with it (on delete cascade). */
export function deleteGroup(id: string): Promise<void> {
  return touchedOne(supabase.from('groups').delete().eq('id', id).select('id'), 'Only the group owner can delete it.');
}

/** Members only; the owner deletes the group instead. */
export async function leaveGroup(id: string): Promise<void> {
  const { data: auth } = await supabase.auth.getSession();
  const uid = auth.session?.user.id;
  if (!uid) throw new Error(friendlyError({ message: 'not authenticated' }));
  return touchedOne(
    supabase.from('group_members').delete().eq('group_id', id).eq('user_id', uid).select('user_id'),
    "The owner can't leave. Delete the group instead.",
  );
}

export type Member = { userId: string; name: string; role: 'owner' | 'member' };

export async function listMembers(groupId: string): Promise<Member[]> {
  const rows = await friendly(
    supabase.from('group_members').select('user_id, role, profiles(display_name)').eq('group_id', groupId),
  );
  return rows
    .map((r) => ({ userId: r.user_id, name: r.profiles?.display_name ?? 'Unknown', role: r.role as Member['role'] }))
    .sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === 'owner' ? -1 : 1));
}

/** Owner only (groups_update policy). */
export async function renameGroup(id: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 60) throw new Error('Group name must be 1 to 60 characters.');
  return touchedOne(supabase.from('groups').update({ name: trimmed }).eq('id', id).select('id'), 'Only the group owner can rename it.');
}

export async function removeMember(groupId: string, userId: string): Promise<void> {
  await friendly(supabase.rpc('remove_member', { p_group_id: groupId, p_user_id: userId }));
}

/** Owner deletes a member's manual steps for the member's today, e.g. an obviously wrong typed-in number. */
export async function deleteMemberManualSteps(groupId: string, userId: string): Promise<void> {
  await friendly(supabase.rpc('delete_member_manual_entry', { p_group_id: groupId, p_user_id: userId, p_metric: 'steps' }));
}
