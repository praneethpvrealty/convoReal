import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  agentReplyBotPauseUpdate,
  botPauseLabel,
  botPauseUpdate,
  isBotPaused,
  isBotPausedRow,
} from './bot-pause';
import {
  INBOUND_STEPS,
  STEPS_WHILE_BOT_PAUSED,
} from '@/lib/whatsapp/inbound/chain/steps';

function fakeDb(
  row: { bot_paused_at: string | null } | null,
  error: { message: string } | null = null
) {
  const filters: Record<string, unknown> = {};
  const chain = {
    select: () => chain,
    eq: (column: string, value: unknown) => {
      filters[column] = value;
      return chain;
    },
    maybeSingle: () => Promise.resolve({ data: row, error }),
  };
  return {
    db: { from: () => chain } as unknown as SupabaseClient,
    filters,
  };
}

describe('[INB-044] the per-chat bot switch', () => {
  it('writes the pause time when switched off and clears it when switched on', () => {
    const now = new Date('2026-10-26T10:36:00.000Z');
    expect(botPauseUpdate(true, now)).toEqual({
      bot_paused_at: '2026-10-26T10:36:00.000Z',
      bot_paused_until: null,
    });
    expect(botPauseUpdate(false, now)).toEqual({
      bot_paused_at: null,
      bot_paused_until: null,
    });
  });

  it('reads a row as paused only while the pause time is set', () => {
    expect(isBotPausedRow({ bot_paused_at: '2026-10-26T10:36:00Z' })).toBe(
      true
    );
    expect(isBotPausedRow({ bot_paused_at: null })).toBe(false);
    expect(isBotPausedRow(null)).toBe(false);
  });

  it('looks the conversation up within the account', async () => {
    const { db, filters } = fakeDb({ bot_paused_at: '2026-10-26T10:36:00Z' });
    await expect(isBotPaused(db, 'acc-1', 'conv-1')).resolves.toBe(true);
    expect(filters).toEqual({ id: 'conv-1', account_id: 'acc-1' });
    await expect(isBotPaused(db, 'acc-1', null)).resolves.toBe(false);
  });

  it('still records a stop, an alerts change or a closed enquiry while the bot is off', () => {
    for (const consent of [
      'buyerAlertsCommand',
      'ownerDigestCommand',
      'closeEnquiryTap',
    ]) {
      expect(STEPS_WHILE_BOT_PAUSED.has(consent), consent).toBe(true);
    }
  });

  it('holds the bot back when the lookup fails', async () => {
    const { db } = fakeDb(null, { message: 'transient connection error' });
    await expect(isBotPaused(db, 'acc-1', 'conv-1')).resolves.toBe(true);
  });

  it('keeps only steps that never reply to the lead while the bot is off', () => {
    const names = new Set(INBOUND_STEPS.map((step) => step.name));
    for (const name of STEPS_WHILE_BOT_PAUSED) {
      expect(names.has(name), name).toBe(true);
    }
    for (const replying of [
      'leadQuestion',
      'leadConversation',
      'requirementReply',
      'flowDispatch',
      'automations',
      'preferenceFlowRequest',
      'specificPropertyInterest',
      'inventorySelection',
    ]) {
      expect(names.has(replying), replying).toBe(true);
      expect(STEPS_WHILE_BOT_PAUSED.has(replying), replying).toBe(false);
    }
  });
});

describe('[INB-046] the bot pauses itself while a person is replying', () => {
  const now = new Date('2026-10-26T11:00:00.000Z');

  it('holds the bot for four hours from the reply', () => {
    expect(agentReplyBotPauseUpdate(now)).toEqual({
      bot_paused_until: '2026-10-26T15:00:00.000Z',
    });
  });

  it('counts as paused only until the hold runs out', () => {
    const row = {
      bot_paused_at: null,
      bot_paused_until: '2026-10-26T15:00:00Z',
    };
    expect(isBotPausedRow(row, now)).toBe(true);
    expect(isBotPausedRow(row, new Date('2026-10-26T15:00:01Z'))).toBe(false);
  });

  it('labels a timed hold with its end and a manual switch as off', () => {
    const time = (at: Date) => at.toISOString().slice(11, 16);
    expect(
      botPauseLabel(
        { bot_paused_at: null, bot_paused_until: '2026-10-26T15:00:00Z' },
        time,
        now
      )
    ).toBe('Bot paused till 15:00');
    expect(
      botPauseLabel(
        { bot_paused_at: '2026-10-26T10:00:00Z', bot_paused_until: null },
        time,
        now
      )
    ).toBe('Bot off');
    expect(botPauseLabel({}, time, now)).toBeNull();
  });

  it('switching the bot on ends a timed hold too', () => {
    expect(botPauseUpdate(false, now).bot_paused_until).toBeNull();
  });
});
