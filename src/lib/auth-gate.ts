import type { Session } from '@supabase/supabase-js';

export type AuthGate = 'loading' | 'signed-in' | 'signed-out';

export const authGate = (loading: boolean, session: Session | null): AuthGate =>
  loading ? 'loading' : session ? 'signed-in' : 'signed-out';
