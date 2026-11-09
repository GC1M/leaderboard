import type { Session } from '@supabase/supabase-js';
import { AppState } from 'react-native';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { supabase } from './supabase';
import { syncTimezone } from './timezone';

type AuthState = { session: Session | null; loading: boolean };

const AuthContext = createContext<AuthState>({ session: null, loading: true });

export const useAuth = () => useContext(AuthContext);

// A stored session can outlive its account (deleted, or a reset dev database). Its token still verifies, so reads
// look fine while every write fails, until we ask the server. Offline errors keep the session.
function dropDeletedAccount() {
  supabase.auth.getUser().then(({ error }) => {
    if (error?.code === 'user_not_found') supabase.auth.signOut({ scope: 'local' }).catch(() => {});
  });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ session: null, loading: true });

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setState({ session: data.session, loading: false });
      if (data.session) dropDeletedAccount();
    });
    // Keep this callback synchronous: awaiting supabase calls inside it can deadlock the client.
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setState({ session, loading: false }));
    const appState = AppState.addEventListener('change', (s) => {
      if (s === 'active') supabase.auth.getSession().then(({ data: d }) => d.session && dropDeletedAccount());
    });
    return () => {
      data.subscription.unsubscribe();
      appState.remove();
    };
  }, []);

  // Covers every sign-in method and cold start with a stored session.
  const userId = state.session?.user.id;
  useEffect(() => {
    if (userId) syncTimezone(userId).catch(() => {});
  }, [userId]);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}
