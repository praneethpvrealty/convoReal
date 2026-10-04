import { describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  profileLoading: false,
  orgRole: 'org_agent' as string | null,
  isReadOnly: false,
  isOrgManager: false,
  canManageMembers: false,
  canEditSettings: false,
  canSendMessages: true,
  canViewGuardedLocations: false,
}));

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));

import { useCan } from './useCan';

describe("useCan('make-changes')", () => {
  it('matches the server write gate: an agent who is not read-only', () => {
    auth.isReadOnly = false;
    auth.canSendMessages = true;
    expect(useCan('make-changes')).toBe(true);
  });

  it('[ACC-002] refuses a read-only agent that send-messages still lets through', () => {
    auth.isReadOnly = true;
    auth.canSendMessages = true;
    expect(useCan('send-messages')).toBe(true);
    expect(useCan('make-changes')).toBe(false);
  });

  it('refuses a role below agent', () => {
    auth.isReadOnly = false;
    auth.canSendMessages = false;
    expect(useCan('make-changes')).toBe(false);
  });
});
