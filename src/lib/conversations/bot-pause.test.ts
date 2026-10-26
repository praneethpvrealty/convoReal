import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { botPauseUpdate, isBotPaused, isBotPausedRow } from './bot-pause';
import {
  INBOUND_STEPS,
  STEPS_WHILE_BOT_PAUSED,
} from '@/lib/whatsapp/inbound/chain/steps';

function fakeDb(row: { bot_paused_at: string | null } | null) {
  const filters: Record<string, unknown> = {};
  const chain = {
    select: () => chain,
    eq: (column: string, value: unknown) => {
      filters[column] = value;
      return chain;
    },
    maybeSingle: () => Promise.resolve({ data: row, error: null }),
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
    });
    expect(botPauseUpdate(false, now)).toEqual({ bot_paused_at: null });
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
