import 'react-native-url-polyfill/auto';

import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';

import { ENV } from './env';
import { LargeSecureStore } from './secure-store';

/**
 * The one Supabase client for the app. Anon key + user session, so
 * every PostgREST/Realtime/Storage request is RLS-scoped exactly like
 * the web client. Direct table reads (inbox, contacts) go through this;
 * writes that involve WhatsApp go through the Next.js API via
 * `apiFetch` (see ./api.ts) with this client's access token as bearer.
 */
export const supabase = createClient(ENV.supabaseUrl, ENV.supabaseAnonKey, {
  auth: {
    storage: new LargeSecureStore(),
    autoRefreshToken: true,
    persistSession: true,
    // No OAuth redirect URLs on native.
    detectSessionInUrl: false,
  },
});

/**
 * Realtime channel names must be unique per subscription: supabase-js
 * returns the SAME channel object for an identical name, so two hooks
 * (or a fast unmount/remount) using one name throw "cannot add
 * postgres_changes callbacks ... after subscribe()". Always create
 * channels through this helper.
 */
let channelSeq = 0;
export function uniqueChannel(base: string): string {
  channelSeq += 1;
  return `${base}:${channelSeq}`;
}

// Refresh tokens only while the app is foregrounded (Supabase RN guidance) —
// a backgrounded JS runtime can't reliably run the refresh timer anyway.
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
});
