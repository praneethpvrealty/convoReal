import type { Session } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { create } from 'zustand';

import {
  SESSION_PROFILE_PATH,
  parseSessionProfileResponse,
} from '@shared/lib/auth/session-profile';

import { toMobileProfile } from './session-profile';
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
      else if (!useAuthStore.getState().profile) void ensureProfile();
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

    const appStateSubscription = AppState.addEventListener(
      'change',
      (state) => {
        if (state === 'active') void syncSession();
      }
    );

    return () => {
      cancelled = true;
      subscription.unsubscribe();
      appStateSubscription.remove();
    };
  }, [setSession, setProfile]);

  const userId = useAuthStore((s) => s.session?.user.id);
  useEffect(() => {
    if (userId) void ensureProfile();
  }, [userId]);
}

const PROFILE_COLUMNS =
  'account_id, account_role, org_role, full_name, active_ui_language, is_read_only';
const PROFILE_LOAD_ATTEMPTS = 3;
const PROFILE_RETRY_DELAY_MS = 1500;

let profileLoad: Promise<Profile | null> | null = null;

/**
 * The signed-in user's profile — the store's copy, or one loaded now.
 * The store only fills in after the launch-time fetch succeeds, and a
 * fetch that failed on a cold start used to leave it empty for the whole
 * session: every helper that read `profile.account_id` off the store
 * then gave up silently, so a personal-WhatsApp share went out and was
 * reported as not recorded without a single request being made. Loading
 * on demand, with retries, means one bad request at launch no longer
 * decides the rest of the session.
 */
export async function ensureProfile(): Promise<Profile | null> {
  const { profile, session } = useAuthStore.getState();
  if (profile) return profile;
  const userId = session?.user.id ?? (await currentUserId());
  if (!userId) return null;
  if (!profileLoad) {
    profileLoad = loadProfile(userId).finally(() => {
      profileLoad = null;
    });
  }
  return profileLoad;
}

/** The signed-in user's id, from the store or the persisted session. */
export async function currentUserId(): Promise<string | null> {
  const stored = useAuthStore.getState().session?.user.id;
  if (stored) return stored;
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.user.id ?? null;
}

async function loadProfile(userId: string): Promise<Profile | null> {
  for (let attempt = 1; attempt <= PROFILE_LOAD_ATTEMPTS; attempt++) {
    const { data, error } = await supabase
      .from('profiles')
      .select(PROFILE_COLUMNS)
      .eq('user_id', userId)
      .maybeSingle();
    if (data) {
      const profile = data as Profile;
      if (useAuthStore.getState().session?.user.id === userId) {
        useAuthStore.setState({ profile });
      }
      return profile;
    }
    if (!error) return null;
    if (attempt === PROFILE_LOAD_ATTEMPTS) return loadProfileViaApi(userId);
    await new Promise((resolve) =>
      setTimeout(resolve, PROFILE_RETRY_DELAY_MS * attempt)
    );
  }
  return null;
}

async function loadProfileViaApi(userId: string): Promise<Profile | null> {
  try {
    const { apiFetch } = await import('./api');
    const result = parseSessionProfileResponse(
      await apiFetch<unknown>(SESSION_PROFILE_PATH)
    );
    const profile = result ? toMobileProfile(result.profile) : null;
    if (profile && useAuthStore.getState().session?.user.id === userId) {
      useAuthStore.setState({ profile });
    }
    return profile;
  } catch {
    return null;
  }
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
    await import('./media-cache')
      .then(({ clearMediaCache }) => clearMediaCache())
      .catch(() => undefined);
  }
}
