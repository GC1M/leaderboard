import { clearFoodPending } from './food/pending';
import { clearMeasurementDraft } from './measurement-draft';
import { deleteHealthJournal } from './health/journal';
import { secureStorage } from './secure-storage';
import { supabase } from './supabase';
import { clearAllDrafts } from './workout-draft';
import { clearAllTemplateDrafts } from './workout-template-draft';

export const NAME_MAX = 40;

async function myId(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const uid = data.session?.user.id;
  if (!uid) throw new Error('You need to sign in first.');
  return uid;
}

export async function getDisplayName(): Promise<string> {
  const { data, error } = await supabase.from('profiles').select('display_name').eq('id', await myId()).single();
  if (error) throw new Error("Couldn't load your profile. Check your connection and try again.");
  return data.display_name;
}

export async function updateDisplayName(name: string): Promise<string> {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > NAME_MAX) throw new Error(`Your name must be 1 to ${NAME_MAX} characters.`);
  const { error } = await supabase.from('profiles').update({ display_name: trimmed }).eq('id', await myId());
  if (error) throw new Error("Couldn't save your name. Check your connection and try again.");
  return trimmed;
}

// Deletes every food entry, recipe and custom food on the server, then the unsent food changes on this device,
// so nothing queued re-creates what was just deleted. Sharing choices stay: a group then sees no food logged.
// HOOK(#48): Apple Health food samples this app wrote are NOT removed here, and the confirm dialog says so. #48
// (docs/food/health-export.md) queues Health deletes per entry through the shared export queue, and that needs
// the entry ids, so once it lands, offer "also remove from Apple Health" in profile/index.tsx and, if chosen,
// queue those deletes for the exported entries BEFORE calling this (the rows are gone afterwards).
export async function deleteFoodHistory(): Promise<void> {
  const uid = await myId();
  const { error } = await supabase.rpc('delete_my_food_history');
  if (error) throw new Error("Couldn't delete your food history. Check your connection and try again.");
  await clearFoodPending(uid);
}

// Deletes the auth user server-side (cascades to everything), then the local session, which stops Health
// sync, then this device's Health import state. Local cleanup is best effort: the account is already gone.
export async function deleteAccount(): Promise<void> {
  const uid = await myId();
  const { error } = await supabase.rpc('delete_my_account');
  if (error) throw new Error("Couldn't delete your account. Check your connection and try again.");
  await supabase.auth.signOut({ scope: 'local' });
  await Promise.allSettled([deleteHealthJournal(uid), secureStorage.removeItem(`health-connection-${uid}`), clearAllDrafts(uid), clearAllTemplateDrafts(uid), clearFoodPending(uid), clearMeasurementDraft(uid, 'weight'), clearMeasurementDraft(uid, 'sleep'), clearMeasurementDraft(uid, 'steps')]);
}
