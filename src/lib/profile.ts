import { clearFoodPending } from './food/pending';
import { bumpFoodSyncGeneration } from './health/food-export';
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
// Apple Health food samples this app wrote are the user's choice and are handled by the caller (profile screen),
// which settles them through the #48 export queue. They are not touched here.
export async function deleteFoodHistory(): Promise<void> {
  const uid = await myId();
  const del = async () => {
    const { error } = await supabase.rpc('delete_my_food_history');
    if (error) throw new Error("Couldn't delete your food history. Check your connection and try again.");
  };
  bumpFoodSyncGeneration(); // a diary sync that read rows before this must not queue from them
  try {
    await del();
    await clearFoodPending(uid);
    // A flush that was in flight may have saved an entry after the first delete; the queue is empty now, so this is final.
    await del();
  } finally {
    bumpFoodSyncGeneration();
  }
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
