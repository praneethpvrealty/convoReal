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

/**
 * [INB-010] START ALERTS in the lead's own words re-opens their search.
 * "Close my enquiry" once marked the contact dead and the goodbye said
 * "just reply START ALERTS" — but the reply only flipped consent: the
 * contact stayed dead, so the confirmation was refused by the
 * dispatcher's dead-contact gate and no alert could ever follow.
 */

interface Captured {
  patch?: Record<string, unknown>;
  notes: Record<string, unknown>[];
}

function stubDb(captured: Captured, before: { is_dead?: boolean } | null) {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: before }) }),
        }),
      }),
      update: (patch: Record<string, unknown>) => {
        captured.patch = patch;
        return {
          eq: () => ({ eq: async () => ({ error: null }) }),
        };
      },
      insert: async (row: Record<string, unknown>) => {
        if (table === 'contact_notes') captured.notes.push(row);
        return { error: null };
      },
    }),
  } as never;
}

describe('applyBuyerAlertsCommand', () => {
  it('[INB-010] START ALERTS grants consent and revives a lead a close marked dead', async () => {
    const captured: Captured = { notes: [] };
    const text = await applyBuyerAlertsCommand({
      command: 'start',
      accountId: 'a1',
      contactId: 'c1',
      db: stubDb(captured, { is_dead: true }),
    });
    expect(captured.patch).toMatchObject({
      buyer_alerts_consent: 'granted',
      is_dead: false,
      dead_at: null,
      dead_reason: null,
      requirement_active: true,
    });
    expect(captured.notes[0]).toMatchObject({
      contact_id: 'c1',
      account_id: 'a1',
      note_text: expect.stringContaining('START ALERTS'),
    });
    expect(text).toContain("You'll receive property alerts");
  });

  it('leaves no note when the lead was never dead', async () => {
    const captured: Captured = { notes: [] };
    await applyBuyerAlertsCommand({
      command: 'start',
      accountId: 'a1',
      contactId: 'c1',
      db: stubDb(captured, { is_dead: false }),
    });
    expect(captured.patch).toMatchObject({ buyer_alerts_consent: 'granted' });
    expect(captured.notes).toEqual([]);
  });

  it('plain STOP ALERTS declines consent and keeps its short confirmation', async () => {
    const captured: Captured = { notes: [] };
    const text = await applyBuyerAlertsCommand({
      command: 'stop',
      accountId: 'a1',
      contactId: 'c1',
      db: stubDb(captured, null),
    });
    expect(captured.patch).toEqual({
      buyer_alerts_consent: 'declined',
      updated_at: expect.any(String),
    });
    expect(text).toContain("won't receive property alerts");
    expect(text).not.toContain('intelligent listing engine');
  });
});
