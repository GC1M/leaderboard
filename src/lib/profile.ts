import { deleteHealthJournal } from './health/journal';
import { secureStorage } from './secure-storage';
import { supabase } from './supabase';

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

// Deletes the auth user server-side (cascades to everything), then this device's Health import state and
// the local session. Local cleanup is best effort: the account is already gone.
export async function deleteAccount(): Promise<void> {
  const uid = await myId();
  const { error } = await supabase.rpc('delete_my_account');
  if (error) throw new Error("Couldn't delete your account. Check your connection and try again.");
  await Promise.allSettled([deleteHealthJournal(uid), secureStorage.removeItem(`health-connection-${uid}`)]);
  await supabase.auth.signOut({ scope: 'local' });
}
