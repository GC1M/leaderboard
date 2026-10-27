import { lastNDates, localDateKey, startOfLocalDay, weekStartKey } from './health/dates';
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

// Native drops the sign-in route's query params when the auth guard flips, so join/[code] also parks the invite here.
export const pendingInvite = { code: '' };

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

export type SharedMetric = 'steps' | 'sleep' | 'weight' | 'workouts';

async function myId(): Promise<string> {
  const { data: auth } = await supabase.auth.getSession();
  const uid = auth.session?.user.id;
  if (!uid) throw new Error(friendlyError({ message: 'not authenticated' }));
  return uid;
}

/** What the caller shares with this group. No row means not shared. */
export async function getMyShares(groupId: string): Promise<SharedMetric[]> {
  const uid = await myId();
  const rows = await friendly(supabase.from('metric_shares').select('metric').eq('group_id', groupId).eq('user_id', uid));
  return rows.map((r) => r.metric as SharedMetric);
}

/** Turns sharing of one metric with one group on or off. Takes effect on the group's next read. */
export async function setShare(groupId: string, metric: SharedMetric, on: boolean): Promise<void> {
  const uid = await myId();
  const row = { group_id: groupId, user_id: uid, metric };
  await friendly(
    on
      ? supabase.from('metric_shares').upsert(row, { ignoreDuplicates: true })
      : supabase.from('metric_shares').delete().match(row),
  );
}

/** Who shares what with this group (members can read this to tell "not shared" from "no data"). */
export async function getGroupShares(groupId: string): Promise<Record<string, SharedMetric[]>> {
  const rows = await friendly(supabase.from('metric_shares').select('user_id, metric').eq('group_id', groupId));
  const out: Record<string, SharedMetric[]> = {};
  for (const r of rows) (out[r.user_id] ??= []).push(r.metric as SharedMetric);
  return out;
}

// Raw rows: the server only returns members who share. A "not a member" error is left as is for isNotMember.
export async function getGroupSleep(groupId: string, days = 7) {
  // Through tomorrow: a member in a timezone ahead of yours can already have tonight's sleep dated tomorrow.
  const now = new Date();
  const { data, error } = await supabase.rpc('group_sleep', {
    p_group_id: groupId, p_from: lastNDates(days, now)[0], p_to: localDateKey(startOfLocalDay(now, -1)),
  });
  if (error) throw error;
  return data;
}

export async function getGroupWeights(groupId: string) {
  const { data, error } = await supabase.rpc('group_latest_weight', { p_group_id: groupId });
  if (error) throw error;
  return data;
}

// Weekly workout count and total time per member who shares workouts with this group, and nothing else.
// From the Monday `weeks - 1` weeks back through tomorrow (a member ahead of you can already be in tomorrow's week).
export async function getGroupWorkouts(groupId: string, weeks = 4) {
  const now = new Date();
  const { data, error } = await supabase.rpc('group_workouts', {
    p_group_id: groupId, p_from: weekStartKey(now, weeks - 1), p_to: localDateKey(startOfLocalDay(now, -1)),
  });
  if (error) throw error;
  return data;
}

/** True when the caller isn't (or is no longer) in the group, so the screen should be left. */
export function isNotMember(e: unknown): boolean {
  const o = (typeof e === 'object' && e ? e : {}) as { message?: unknown; code?: unknown };
  return String(o.message ?? '').includes('not a member of this group') || o.code === 'PGRST116';
}

// Reject malformed deep links before sending a UUID filter to PostgREST.
export const isValidGroupId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
