import { describe, expect, it } from 'vitest';

import { buildEngineInvite, buildEngineInviteLink } from './engine-invite';

const official = { phone: '+91 98765 43210', prefix: '', sandbox: false };
const sandbox = { phone: '15550001111', prefix: '#abc12 ', sandbox: true };

describe('buildEngineInviteLink', () => {
  it('strips formatting from the Engine number', () => {
    expect(buildEngineInviteLink(official)).toBe(
      'https://wa.me/919876543210?text=START%20ALERTS'
    );
  });

  it('carries the sandbox routing code ahead of the command', () => {
    expect(buildEngineInviteLink(sandbox)).toBe(
      'https://wa.me/15550001111?text=%23abc12%20START%20ALERTS'
    );
  });
});

describe('buildEngineInvite', () => {
  it('greets by first name and ends on the link', () => {
    const message = buildEngineInvite(official, 'Ganesh Kumar');
    expect(message.startsWith('Hi Ganesh 👋')).toBe(true);
    expect(message.endsWith(buildEngineInviteLink(official))).toBe(true);
  });

  it('sells the move on buyer value, not channel logistics', () => {
    // The invite goes out from the agent's personal number; the reasons
    // to tap are what the engine does for the buyer — speed, steal
    // deals, no spam — with STOP ALERTS as the risk reversal.
    const message = buildEngineInvite(official, 'Ganesh Kumar');
    expect(message).toContain('moment');
    expect(message).toContain('steal deals');
    expect(message).toContain('STOP ALERTS');
  });

  it('falls back to a neutral greeting for an unnamed contact', () => {
    expect(buildEngineInvite(official, '   ').startsWith('Hi there 👋')).toBe(
      true
    );
  });
});
