import type { Session } from '@supabase/supabase-js';
import { useEffect } from 'react';
import { create } from 'zustand';

import { supabase } from './supabase';
import type { Profile } from './types';

interface AuthState {
  /** Undefined until the persisted session has been read from storage. */
  session: Session | null | undefined;
  /** Loaded right after sign-in; carries account_id for realtime channel names. */
  profile: Profile | null;
  setSession: (session: Session | null) => void;
  setProfile: (profile: Profile | null) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  session: undefined,
  profile: null,
  setSession: (session) => set({ session }),
  setProfile: (profile) => set({ profile }),
}));

/**
 * Mount once at the root. Restores the persisted session, follows auth
 * state changes, and loads the caller's profile (account scope).
 */
export function useAuthListener() {
  const setSession = useAuthStore((s) => s.setSession);
  const setProfile = useAuthStore((s) => s.setProfile);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (!session) {
        setProfile(null);
      }
    });
    return () => subscription.unsubscribe();
  }, [setSession, setProfile]);

  const userId = useAuthStore((s) => s.session?.user.id);
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    supabase
      .from('profiles')
      .select('account_id, account_role')
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled && data) setProfile(data as Profile);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, setProfile]);
}

/**
 * Mandatory OTP-verified WhatsApp number (migration 137): the web app
 * gates the dashboard on `phone_confirmed_at`; the mobile app applies
 * the same gate after login.
 */
export function isPhoneVerified(session: Session): boolean {
  return Boolean(session.user.phone_confirmed_at);
}
