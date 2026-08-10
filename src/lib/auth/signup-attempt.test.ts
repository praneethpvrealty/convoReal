import { describe, it, expect } from 'vitest';

import { signupGate } from './signup-attempt';

describe('signupGate', () => {
  it('files a visitor with no token as the waitlist wall', () => {
    expect(
      signupGate({ betaToken: null, inviteToken: null, bypassGate: false }),
    ).toBe('no_invite');
  });

  it('separates a beta seat from a team invite', () => {
    expect(
      signupGate({ betaToken: 'abc', inviteToken: null, bypassGate: false }),
    ).toBe('beta');
    expect(
      signupGate({ betaToken: null, inviteToken: 'xyz', bypassGate: false }),
    ).toBe('team_invite');
  });

  it('reads the escape hatch as its own door, not as a wall', () => {
    expect(
      signupGate({ betaToken: null, inviteToken: null, bypassGate: true }),
    ).toBe('bypass');
  });

  it('prefers a real token over the escape hatch', () => {
    expect(
      signupGate({ betaToken: 'abc', inviteToken: null, bypassGate: true }),
    ).toBe('beta');
    expect(
      signupGate({ betaToken: null, inviteToken: 'xyz', bypassGate: true }),
    ).toBe('team_invite');
  });

  it('prefers a beta seat over a team invite when both are present', () => {
    expect(
      signupGate({ betaToken: 'abc', inviteToken: 'xyz', bypassGate: false }),
    ).toBe('beta');
  });
});
