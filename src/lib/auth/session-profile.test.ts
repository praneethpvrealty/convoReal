import { describe, expect, it } from 'vitest';

import {
  parseSessionProfileResponse,
  toSessionProfile,
  type SessionProfileRow,
} from './session-profile';

const row: SessionProfileRow = {
  id: 'p-1',
  full_name: 'Asha',
  email: 'asha@example.com',
  phone: null,
  avatar_url: null,
  role: null,
  beta_features: null,
  account_id: 'acct-1',
  account_role: 'owner',
  org_role: 'org_manager',
  team_id: null,
  is_read_only: null,
  ui_languages: ['en', 'kn'],
  active_ui_language: 'kn',
  showcase_style: null,
  showcase_3d_enabled: null,
  account: [{ id: 'acct-1', name: 'Asha Realty', status: 'active' }],
};

describe('[ACC-008] session profile shape', () => {
  it('normalises a profile row the same way for every reader', () => {
    expect(toSessionProfile(row)).toEqual({
      profile: {
        id: 'p-1',
        full_name: 'Asha',
        email: 'asha@example.com',
        phone: null,
        avatar_url: null,
        role: null,
        beta_features: [],
        account_id: 'acct-1',
        account_role: 'owner',
        org_role: 'org_manager',
        team_id: null,
        is_read_only: false,
        ui_languages: ['en', 'kn'],
        active_ui_language: 'kn',
        showcase_style: null,
        showcase_3d_enabled: null,
      },
      account: { id: 'acct-1', name: 'Asha Realty', status: 'active' },
    });
  });

  it('drops a role the app does not know rather than trusting it', () => {
    const { profile } = toSessionProfile({
      ...row,
      account_role: 'superuser',
      org_role: 'org_overlord',
    });
    expect(profile.account_role).toBeNull();
    expect(profile.org_role).toBeNull();
  });

  it('keeps "no profile row" apart from a malformed answer', () => {
    expect(parseSessionProfileResponse({ data: null })).toBeNull();
    const result = toSessionProfile(row);
    expect(parseSessionProfileResponse({ data: result })).toEqual(result);
    expect(() => parseSessionProfileResponse({})).toThrow();
    expect(() => parseSessionProfileResponse(null)).toThrow();
    expect(() =>
      parseSessionProfileResponse({ data: { profile: {} } })
    ).toThrow();
  });
});
