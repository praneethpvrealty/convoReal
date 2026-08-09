import { describe, it, expect } from 'vitest';

import { parseBuyerAlertsCommand } from './alerts';

describe('parseBuyerAlertsCommand', () => {
  it('matches stop/pause and start/resume phrasings', () => {
    expect(parseBuyerAlertsCommand('STOP ALERTS')).toBe('stop');
    expect(parseBuyerAlertsCommand('pause alerts')).toBe('stop');
    expect(parseBuyerAlertsCommand('stop property alerts')).toBe('stop');
    expect(parseBuyerAlertsCommand('Stop deal alerts')).toBe('stop');
    expect(parseBuyerAlertsCommand('START ALERTS')).toBe('start');
    expect(parseBuyerAlertsCommand('resume alerts')).toBe('start');
    expect(parseBuyerAlertsCommand('start property alerts')).toBe('start');
  });

  it('ignores normal conversation', () => {
    expect(parseBuyerAlertsCommand('please stop sending me alerts')).toBeNull();
    expect(parseBuyerAlertsCommand('stop')).toBeNull();
    expect(parseBuyerAlertsCommand('any alerts?')).toBeNull();
    expect(parseBuyerAlertsCommand('stop updates')).toBeNull();
    expect(parseBuyerAlertsCommand(null)).toBeNull();
    expect(parseBuyerAlertsCommand(undefined)).toBeNull();
  });
});

import { applyBuyerAlertsCommand } from './alerts';

function stubDb(captured: { consent?: string }) {
  return {
    from: () => ({
      update: (patch: { buyer_alerts_consent: string }) => {
        captured.consent = patch.buyer_alerts_consent;
        return {
          eq: () => ({ eq: async () => ({ error: null }) }),
        };
      },
    }),
  } as never;
}

describe('applyBuyerAlertsCommand', () => {
  it('close declines consent exactly like stop', async () => {
    // The template promised "no further updates" — the decline must be
    // recorded so the broadcast sender refuses this contact from now on.
    const captured: { consent?: string } = {};
    await applyBuyerAlertsCommand({
      command: 'close',
      accountId: 'a1',
      contactId: 'c1',
      db: stubDb(captured),
    });
    expect(captured.consent).toBe('declined');
  });

  it('close acknowledges the decision before making the pitch', async () => {
    const text = await applyBuyerAlertsCommand({
      command: 'close',
      accountId: 'a1',
      contactId: 'c1',
      db: stubDb({}),
    });
    expect(text).not.toBeNull();
    const ack = text!.indexOf('your enquiry is closed');
    const pitch = text!.indexOf('intelligent listing engine');
    expect(ack).toBeGreaterThanOrEqual(0);
    expect(pitch).toBeGreaterThan(ack);
    // The way back in must be stated, since nothing else will be sent.
    expect(text).toContain('START ALERTS');
    expect(text).toContain('last update');
  });

  it('plain STOP ALERTS keeps its short confirmation', async () => {
    const text = await applyBuyerAlertsCommand({
      command: 'stop',
      accountId: 'a1',
      contactId: 'c1',
      db: stubDb({}),
    });
    expect(text).toContain("won't receive property alerts");
    expect(text).not.toContain('intelligent listing engine');
  });
});
