import { describe, expect, it } from 'vitest';

import type { SessionProfile } from '@shared/lib/auth/session-profile';

import { toMobileProfile } from './session-profile';

const profile: SessionProfile = {
  id: 'p-1',
  full_name: 'Asha',
  email: 'asha@example.com',
  phone: null,
  avatar_url: null,
  role: null,
  beta_features: [],
  account_id: 'acct-1',
  account_role: 'agent',
  org_role: 'org_agent',
  team_id: null,
  is_read_only: true,
  ui_languages: [],
  active_ui_language: 'kn',
  showcase_style: null,
  showcase_3d_enabled: null,
};

describe('[ACC-008] toMobileProfile', () => {
  it('keeps the account scope and read-only flag from the API answer', () => {
    expect(toMobileProfile(profile)).toEqual({
      account_id: 'acct-1',
      account_role: 'agent',
      org_role: 'org_agent',
      full_name: 'Asha',
      active_ui_language: 'kn',
      is_read_only: true,
    });
  });

  it('refuses a profile with no account to scope to', () => {
    expect(toMobileProfile({ ...profile, account_id: null })).toBeNull();
    expect(toMobileProfile({ ...profile, account_role: null })).toBeNull();
  });
});
