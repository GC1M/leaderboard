import { supabase } from '@/lib/supabase';

// Health data belongs to the account that explicitly connected this device. Never resolve the
// payload's owner after a native query: the user could have changed accounts while it was running.
export async function assertHealthOwner(userId: string): Promise<void> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !userId || data.session?.user.id !== userId) throw new Error('Health account changed. Try again.');
}
