import type { SessionProfile } from '@shared/lib/auth/session-profile';

import type { Profile } from './types';

export function toMobileProfile(profile: SessionProfile): Profile | null {
  if (!profile.account_id || !profile.account_role) return null;
  return {
    account_id: profile.account_id,
    account_role: profile.account_role,
    org_role: profile.org_role,
    full_name: profile.full_name,
    active_ui_language: profile.active_ui_language,
    is_read_only: profile.is_read_only,
  };
}
