import { supabase } from './supabase';

export const deviceTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export const needsTimezoneUpdate = (stored: string | null | undefined, device: string | null | undefined) =>
  !!device && stored !== device;

// Leaderboard "today" comes from profiles.timezone, which defaults to UTC.
export async function syncTimezone(userId: string) {
  const device = deviceTimezone();
  const { data } = await supabase.from('profiles').select('timezone').eq('id', userId).maybeSingle();
  if (data && needsTimezoneUpdate(data.timezone, device)) {
    await supabase.from('profiles').update({ timezone: device }).eq('id', userId);
  }
}
