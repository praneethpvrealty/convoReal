'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import { createClient } from '@/lib/supabase/client';
import type { User } from '@supabase/supabase-js';
import {
  canEditSettings as canEditSettingsFor,
  canManageMembers as canManageMembersFor,
  canSendMessages as canSendMessagesFor,
  canViewGuardedLocation as canViewGuardedLocationFor,
  hasMinOrgRole,
  type AccountRole,
  type OrgRole,
} from '@/lib/auth/roles';
import {
  SESSION_PROFILE_PATH,
  SESSION_PROFILE_SELECT,
  parseSessionProfileResponse,
  toSessionProfile,
  type SessionAccount,
  type SessionProfile,
  type SessionProfileResult,
  type SessionProfileRow,
} from '@/lib/auth/session-profile';
import { reloadTo } from '@/lib/navigation';
import { SIGN_OUT_REASON_STORAGE_KEY } from '@/lib/auth/sign-out-reason';
import {
  clearDeliberateSignOut,
  isDeliberateSignOut,
  markDeliberateSignOut,
} from '@/lib/auth/deliberate-sign-out';

type Profile = SessionProfile;
type AccountSummary = SessionAccount;

interface AuthContextValue {
  user: User | null;
  profile: Profile | null;
  /**
   * Session-level loading. Flips to false as soon as we know whether
   * a user is signed in, *without* waiting for the profile row. Use
   * this for chrome (sidebar / header) that can render with just the
   * user object.
   */
  loading: boolean;
  /**
   * Profile-row loading. Stays true until `fetchProfile` settles
   * (success, missing row, or error). Code that branches on
   * `profile.beta_features` MUST gate on this — otherwise it sees the
   * `{ loading: false, profile: null }` window during initial load
   * and may take the "not opted in" branch incorrectly.
   */
  profileLoading: boolean;
  /**
   * True when the profile row fetch failed (network blip, DB timeout,
   * RLS hiccup) after retrying — as opposed to a fetch that succeeded
   * and genuinely found no row. Callers that redirect on `!profile`
   * (e.g. the dashboard shell sending a profile-less user to
   * /profile-setup) MUST check this first: treating a failed fetch as
   * "no profile" sends the user to /profile-setup, which then re-fetches
   * successfully and sends them back to /dashboard, whose own fetch may
   * fail again — an infinite redirect loop that never renders anything.
   */
  profileError: boolean;
  signOut: () => Promise<void>;
  /** Re-fetch the current user's profile row — call after a save from
   *  the settings form so header/sidebar reflect the change without a
   *  full page reload. */
  refreshProfile: () => Promise<void>;

  // ----------------------------------------------------------
  // Account-scoped context (added by the account-sharing series)
  //
  // All of these are nullable until `profileLoading` is false.
  // After the profile resolves they're guaranteed to be set,
  // because migration 017 made `account_id` / `account_role`
  // NOT NULL on `profiles`.
  // ----------------------------------------------------------

  /** Account id the current user belongs to. Null while loading. */
  accountId: string | null;
  /** Role within that account. Null while loading. Deprecated —
   *  prefer `orgRole`, kept in sync by a DB trigger for legacy callers. */
  accountRole: AccountRole | null;
  /** Lightweight account meta — id + name + status. Null while loading. */
  account: AccountSummary | null;
  /** True when the account has been archived by a super-admin. While
   *  true the dashboard shell renders a read-only overlay and all write
   *  operations should be blocked at the API level. */
  isAccountArchived: boolean;
  /** True if `accountRole === 'owner'`. */
  isOwner: boolean;
  /** True if `accountRole === 'admin'` (does NOT include owner — use canManageMembers for "admin or above"). */
  isAdmin: boolean;
  /** True if `accountRole === 'agent'`. */
  isAgent: boolean;
  /** True if `accountRole === 'viewer'`. */
  isViewer: boolean;
  /** True if the caller can manage members (admin+). */
  canManageMembers: boolean;
  /** True if the caller can edit account-wide settings (admin+). */
  canEditSettings: boolean;
  /** True if the caller can send messages and edit operational data (agent+). */
  canSendMessages: boolean;
  /** True if the caller sees guarded properties' exact location and
   *  private photos account-wide (admin+). Listing agents additionally
   *  see their own properties — that per-property exception is decided
   *  server-side, not by this flag. */
  canViewGuardedLocations: boolean;

  // ----------------------------------------------------------
  // Org hierarchy (migration 082_org_hierarchy.sql) — source of
  // truth going forward. `accountRole` above stays populated (kept
  // in sync by a DB trigger) for the ~50-100 existing consumers that
  // haven't migrated yet; new code should prefer these instead.
  // ----------------------------------------------------------

  /** Caller's org-hierarchy role. Null while loading. */
  orgRole: OrgRole | null;
  /** Caller's team. Null for Org Managers and for any account still
   *  in Solo Mode (no teams created yet). */
  teamId: string | null;
  /** Former 'viewer' role folds into org_agent + this flag — check this
   *  instead of `isViewer` (dead post-082, see roles.ts). */
  isReadOnly: boolean;
  /** True if `orgRole === 'org_manager'`. */
  isOrgManager: boolean;
  /** True if `orgRole === 'org_leader'`. */
  isOrgLeader: boolean;
  /** True if `orgRole === 'org_coordinator'` — a scoped operator with
   *  agent-level capabilities plus account-wide contact/inbox visibility
   *  (incl. the unassigned queue), but no member or settings access. */
  isOrgCoordinator: boolean;
  /** True if `orgRole === 'org_agent'`. */
  isOrgAgent: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * AuthProvider — wrap this around the dashboard layout.
 * Makes ONE getSession() call for the whole tree instead of one per
 * component, avoiding internal lock contention in the Supabase client.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const hadUserRef = useRef(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [loading, setLoading] = useState(true);
  // Tracked separately from `loading`. The session settles fast (one
  // local cookie read); the profile fetch crosses the network and
  // settles later. Callers that gate on `profile.*` need to know which
  // window they're in — see the type doc above.
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState(false);

  // Shared across init, auth-state-change listener, and the exposed
  // refreshProfile() callback. Reads the current session's user id and
  // pulls the matching profile row along with its account summary.
  //
  // Falls back to the same-origin profile route and retries both before
  // giving up — a transient network/DB
  // blip must not be mistaken for "this user has no profile row", which
  // is exactly what caused the /dashboard <-> /profile-setup redirect
  // loop: a failed fetch left `profile` at null, the dashboard shell
  // read that as "no profile" and redirected to /profile-setup, whose
  // fresh fetch then succeeded and redirected straight back.
  const fetchProfile = useCallback(async (userId: string) => {
    const supabase = createClient();
    setProfileLoading(true);
    setProfileError(false);

    const applyResult = (result: SessionProfileResult) => {
      setProfile(result.profile);
      setAccount(result.account);
    };

    const attemptViaApi = async () => {
      const res = await fetch(SESSION_PROFILE_PATH, {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (!res.ok) {
        throw new Error(`profile API answered ${res.status}`);
      }
      const result = parseSessionProfileResponse(await res.json());
      if (result) applyResult(result);
    };

    const attemptFetch = async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select(SESSION_PROFILE_SELECT)
        .eq('user_id', userId)
        .maybeSingle();

      if (error) {
        // Backward-compatible fallback for forks that haven't applied the
        // account migrations yet (no profiles.account_id -> accounts FK).
        if (
          error.code === 'PGRST200' &&
          error.message.includes(
            "relationship between 'profiles' and 'accounts'"
          )
        ) {
          const { data: legacyData, error: legacyError } = await supabase
            .from('profiles')
            .select(
              'id, full_name, email, phone, avatar_url, role, beta_features'
            )
            .eq('user_id', userId)
            .maybeSingle();

          if (legacyError) {
            console.error('[AuthProvider] legacy fetchProfile error:', {
              message: legacyError.message,
              details: legacyError.details,
              hint: legacyError.hint,
              code: legacyError.code,
            });
            throw legacyError;
          }

          if (legacyData) {
            setProfile({
              id: legacyData.id,
              full_name: legacyData.full_name,
              email: legacyData.email,
              phone: legacyData.phone ?? null,
              avatar_url: legacyData.avatar_url,
              role: legacyData.role,
              beta_features: legacyData.beta_features ?? [],
              account_id: null,
              account_role: null,
              org_role: null,
              team_id: null,
              is_read_only: false,
              // Legacy path predates migration 247 and never selects
              // these; the locale provider narrows the defaults anyway.
              ui_languages: [],
              active_ui_language: null,
              showcase_style: null,
              showcase_3d_enabled: null,
            });
            setAccount(null);
          }
          return;
        }

        console.error('[AuthProvider] fetchProfile error:', {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        throw error;
      }

      if (data) applyResult(toSessionProfile(data as SessionProfileRow));
      // data === null && error === null: `.maybeSingle()` genuinely
      // found no row for this user — a real "no profile yet" case, not
      // a fetch failure. Leave `profile` at null and `profileError`
      // false so the caller correctly routes to /profile-setup.
    };

    // A profile fetch that HANGS (stalled connection, wedged proxy) is
    // worse than one that fails: profileLoading stays true forever and
    // every profile-dependent surface silently falls back — header
    // shows "User", role gates treat the caller as least-privileged
    // ("Read-only view — templates are managed by your Organization
    // Manager"), and account-scoped lists render empty ("No templates
    // yet"). Cap each attempt so a hang becomes a retry, then a real
    // error state — the shell's "We couldn't load your profile / Retry"
    // screen — instead of a zombie UI that misreports permissions.
    const withTimeout = (attempt: () => Promise<void>, ms: number) =>
      Promise.race([
        attempt(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`profile fetch timed out after ${ms}ms`)),
            ms
          )
        ),
      ]);

    // The direct read goes from the browser to the Supabase host; the
    // fallback goes to this app's own origin, which reads the same row
    // server-side under the caller's session. A browser that cannot
    // reach Supabase for a moment (extension, flaky route, a Chrome
    // network process awaiting relaunch) still reaches the app, so the
    // dashboard loads instead of stopping on the error screen.
    const attempts: Array<[label: string, run: () => Promise<void>]> = [
      ['direct read', attemptFetch],
      ['API fallback', attemptViaApi],
      ['direct read retry', attemptFetch],
      ['API fallback retry', attemptViaApi],
    ];

    try {
      let lastError: unknown = null;
      let loaded = false;
      for (const [index, [label, run]] of attempts.entries()) {
        if (index === 2) {
          await new Promise((resolve) => setTimeout(resolve, 1_500));
        }
        try {
          await withTimeout(run, 8_000);
          loaded = true;
          break;
        } catch (err) {
          lastError = err;
          console.warn(`[AuthProvider] profile ${label} failed:`, err);
        }
      }
      if (!loaded) {
        console.error('[AuthProvider] fetchProfile failed:', lastError);
        setProfileError(true);
      }
    } finally {
      setProfileLoading(false);
    }
  }, []);

  useEffect(() => {
    const supabase = createClient();
    let mounted = true;

    const safetyTimer = setTimeout(() => {
      if (mounted) {
        console.warn('[AuthProvider] getSession() timed out after 3s');
        setLoading(false);
        setProfileLoading(false);
      }
    }, 3000);

    const init = async () => {
      try {
        const {
          data: { session },
          error,
        } = await supabase.auth.getSession();

        if (error)
          console.error('[AuthProvider] getSession error:', error.message);

        if (!mounted) return;
        const currentUser = session?.user ?? null;
        hadUserRef.current = Boolean(currentUser);
        setUser(currentUser);

        if (currentUser) {
          // Don't block session loading on profile fetch — chrome
          // (header, sidebar) can render from the user object alone,
          // profile enriches async. Callers that need to branch on
          // profile data gate on `profileLoading` instead.
          setProfileLoading(true);
          fetchProfile(currentUser.id);
        } else {
          // No user → no profile to load. Flip profileLoading off so
          // pages that gate on it don't wait forever on the logged-out
          // path (the route guard or redirect should fire instead).
          setProfileLoading(false);
        }
      } catch (err) {
        console.error('[AuthProvider] init threw:', err);
      } finally {
        if (mounted) setLoading(false);
        clearTimeout(safetyTimer);
      }
    };

    init();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      const currentUser = session?.user ?? null;
      if (
        event === 'SIGNED_OUT' &&
        hadUserRef.current &&
        !isDeliberateSignOut()
      ) {
        try {
          sessionStorage.setItem(SIGN_OUT_REASON_STORAGE_KEY, 'expired');
        } catch {}
      }
      if (event === 'SIGNED_IN' && currentUser && !hadUserRef.current) {
        clearDeliberateSignOut();
      }
      hadUserRef.current = Boolean(currentUser);
      setUser(currentUser);

      if (currentUser) {
        setProfileLoading(true);
        fetchProfile(currentUser.id);
      } else {
        setProfile(null);
        setAccount(null);
        setProfileLoading(false);
      }

      setLoading(false);
    });

    return () => {
      mounted = false;
      clearTimeout(safetyTimer);
      subscription.unsubscribe();
    };
  }, [fetchProfile]);

  const signOut = useCallback(async () => {
    markDeliberateSignOut();
    const supabase = createClient();
    try {
      // Fire-and-forget/timeout the network call to avoid blocking the user redirect
      // if Supabase is having an outage.
      await Promise.race([
        supabase.auth.signOut(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Signout timeout')), 2000)
        ),
      ]);
    } catch (err) {
      console.warn(
        '[signOut] Supabase network signout failed or timed out:',
        err
      );
    }
    setUser(null);
    setProfile(null);
    setAccount(null);
    reloadTo('/login');
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!user?.id) return;
    await fetchProfile(user.id);
  }, [user?.id, fetchProfile]);

  // Derive the role booleans once per profile change rather than on
  // every consumer render. Cheap regardless, but the memo also gives
  // each derived value a stable identity for React.memo / useEffect
  // dependencies downstream.
  const derived = useMemo(() => {
    const role = profile?.account_role ?? null;
    const orgRole = profile?.org_role ?? null;
    const accountStatus = Array.isArray(account)
      ? (account[0] as AccountSummary | undefined)?.status
      : (account as AccountSummary | null)?.status;
    return {
      accountRole: role,
      accountId: profile?.account_id ?? null,
      isAccountArchived: accountStatus === 'archived',
      isOwner: role === 'owner',
      isAdmin: role === 'admin',
      isAgent: role === 'agent',
      isViewer: role === 'viewer',
      orgRole,
      teamId: profile?.team_id ?? null,
      isReadOnly: profile?.is_read_only ?? false,
      isOrgManager: orgRole === 'org_manager',
      isOrgLeader: orgRole === 'org_leader',
      isOrgCoordinator: orgRole === 'org_coordinator',
      isOrgAgent: orgRole === 'org_agent',
      // Capability predicates read orgRole when available (source of
      // truth going forward), falling back to the legacy accountRole
      // for any profile that somehow lacks it (shouldn't happen
      // post-082, but fails closed rather than throwing).
      canManageMembers: orgRole
        ? hasMinOrgRole(orgRole, 'org_leader')
        : role
          ? canManageMembersFor(role)
          : false,
      canEditSettings: orgRole
        ? hasMinOrgRole(orgRole, 'org_leader')
        : role
          ? canEditSettingsFor(role)
          : false,
      canSendMessages: orgRole
        ? hasMinOrgRole(orgRole, 'org_agent')
        : role
          ? canSendMessagesFor(role)
          : false,
      canViewGuardedLocations: orgRole
        ? hasMinOrgRole(orgRole, 'org_leader')
        : role
          ? canViewGuardedLocationFor(role)
          : false,
    };
  }, [
    profile?.account_role,
    profile?.account_id,
    profile?.org_role,
    profile?.team_id,
    profile?.is_read_only,
    account,
  ]);

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        profileLoading,
        profileError,
        signOut,
        refreshProfile,
        account,
        ...derived,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

/**
 * useAuth — read the shared auth state from context.
 * Must be used inside an <AuthProvider>.
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    // Fallback for components rendered outside the provider (shouldn't
    // happen in normal flow, but don't crash the page). Account state
    // collapses to least-privileged null — every `canX` boolean is
    // false so UI gates fail closed.
    return {
      user: null,
      profile: null,
      loading: false,
      profileLoading: false,
      profileError: false,
      signOut: async () => {
        reloadTo('/login');
      },
      refreshProfile: async () => {},
      account: null,
      accountId: null,
      accountRole: null,
      isAccountArchived: false,
      isOwner: false,
      isAdmin: false,
      isAgent: false,
      isViewer: false,
      canManageMembers: false,
      canEditSettings: false,
      canSendMessages: false,
      canViewGuardedLocations: false,
      orgRole: null,
      teamId: null,
      isReadOnly: false,
      isOrgManager: false,
      isOrgLeader: false,
      isOrgCoordinator: false,
      isOrgAgent: false,
    };
  }
  return ctx;
}
