import type { Session } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { create } from 'zustand';

import { asyncStoragePersister, queryClient } from './query';
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
 *
 * Supabase pauses token refresh while React Native is backgrounded. When
 * the app returns to the foreground, re-read the canonical auth session
 * as well as restarting refresh (see supabase.ts). This prevents a stale
 * Zustand session from leaving protected screens visible after the stored
 * refresh session has expired or been revoked while the app was asleep.
 */
export function useAuthListener() {
  const setSession = useAuthStore((s) => s.setSession);
  const setProfile = useAuthStore((s) => s.setProfile);

  useEffect(() => {
    let cancelled = false;

    const syncSession = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;
      setSession(session);
      if (!session) setProfile(null);
    };

    void syncSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (!session) {
        setProfile(null);
      }
    });

    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void syncSession();
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
      appStateSubscription.remove();
    };
  }, [setSession, setProfile]);

  const userId = useAuthStore((s) => s.session?.user.id);
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    supabase
      .from('profiles')
      .select('account_id, account_role, org_role, full_name, active_ui_language')
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

/**
 * Single sign-out path. Clear the in-memory auth state immediately so
 * Expo Router's protected layout can replace the current screen with the
 * login screen without waiting for Supabase's SIGNED_OUT event. Beyond
 * ending the Supabase session it wipes the TanStack Query cache — in
 * memory and the plaintext AsyncStorage copy — so Engine PII (contacts,
 * phone numbers, message bodies, deals) never outlives the signed-in user
 * on the device.
 */
export async function signOut(): Promise<void> {
  useAuthStore.setState({ session: null, profile: null });
  try {
    await supabase.auth.signOut();
  } finally {
    queryClient.clear();
    await asyncStoragePersister.removeClient();
    await AsyncStorage.removeItem('convoreal-query-cache');
  }
}
