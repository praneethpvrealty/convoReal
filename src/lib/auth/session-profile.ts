import type { ShowcaseStyle } from '../showcase/style';
import {
  isAccountRole,
  isOrgRole,
  type AccountRole,
  type OrgRole,
} from './roles';

export const SESSION_PROFILE_PATH = '/api/auth/profile';

export const SESSION_PROFILE_SELECT =
  'id, full_name, email, phone, avatar_url, role, beta_features, account_id, account_role, org_role, team_id, is_read_only, ui_languages, active_ui_language, showcase_style, showcase_3d_enabled, account:accounts!inner(id, name, status, default_language, journey_compartment_scope)';

export interface SessionProfile {
  id: string;
  full_name: string | null;
  email: string;
  phone: string | null;
  avatar_url: string | null;
  role: string | null;
  /**
   * Opted-in beta feature keys for this account. No current feature
   * reads this — Flows was the last user and went to soft-GA in PR
   * #134 — but the column survives for future beta gates.
   */
  beta_features: string[];
  account_id: string | null;
  account_role: AccountRole | null;
  /** Org-hierarchy role (migration 082) — source of truth going forward. */
  org_role: OrgRole | null;
  team_id: string | null;
  /** Former 'viewer' role folds into org_agent + this flag. */
  is_read_only: boolean;
  /** Languages this agent reads, and which one the app renders in
   *  (migration 247). Shared with the mobile app, which reads the same
   *  profile row. Narrowed by the locale provider, never trusted raw. */
  ui_languages: string[];
  active_ui_language: string | null;
  showcase_style: ShowcaseStyle | null;
  showcase_3d_enabled: boolean | null;
}

export interface SessionAccount {
  id: string;
  name: string;
  status: string;
  /** Outbound language default (migration 246). Absent on rows read
   *  before the column existed — callers narrow with toLanguageCode(). */
  default_language?: string;
  journey_compartment_scope?: string;
}

export interface SessionProfileResult {
  profile: SessionProfile;
  account: SessionAccount | null;
}

export interface SessionProfileResponse {
  data: SessionProfileResult | null;
}

export interface SessionProfileRow {
  id: string;
  full_name: string | null;
  email: string;
  phone?: string | null;
  avatar_url: string | null;
  role: string | null;
  beta_features?: string[] | null;
  account_id?: string | null;
  account_role?: string | null;
  org_role?: string | null;
  team_id?: string | null;
  is_read_only?: boolean | null;
  ui_languages?: string[] | null;
  active_ui_language?: string | null;
  showcase_style?: ShowcaseStyle | null;
  showcase_3d_enabled?: boolean | null;
  account?: SessionAccount | SessionAccount[] | null;
}

export function toSessionProfile(row: SessionProfileRow): SessionProfileResult {
  const account = Array.isArray(row.account)
    ? (row.account[0] ?? null)
    : (row.account ?? null);

  return {
    profile: {
      id: row.id,
      full_name: row.full_name,
      email: row.email,
      phone: row.phone ?? null,
      avatar_url: row.avatar_url,
      role: row.role,
      beta_features: row.beta_features ?? [],
      ui_languages: row.ui_languages ?? [],
      active_ui_language: row.active_ui_language ?? null,
      showcase_style: row.showcase_style ?? null,
      showcase_3d_enabled: row.showcase_3d_enabled ?? null,
      account_id: row.account_id ?? null,
      account_role: isAccountRole(row.account_role) ? row.account_role : null,
      org_role: isOrgRole(row.org_role) ? row.org_role : null,
      team_id: row.team_id ?? null,
      is_read_only: row.is_read_only ?? false,
    },
    account,
  };
}

export function parseSessionProfileResponse(
  body: unknown
): SessionProfileResult | null {
  if (!body || typeof body !== 'object' || !('data' in body)) {
    throw new Error('Malformed session profile response');
  }
  const data = (body as { data: unknown }).data;
  if (data === null) return null;
  if (
    !data ||
    typeof data !== 'object' ||
    !('profile' in data) ||
    !data.profile ||
    typeof data.profile !== 'object' ||
    typeof (data.profile as { id?: unknown }).id !== 'string'
  ) {
    throw new Error('Malformed session profile response');
  }
  return data as SessionProfileResult;
}
