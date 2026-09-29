import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  results: [] as Array<'stamped' | 'gone' | 'failed'>,
  updates: 0,
  queued: [] as Array<{ attempts?: number }>,
  queueFails: false,
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const builder = {
        update: () => builder,
        eq: () => builder,
        select: () => builder,
        maybeSingle: async () => {
          state.updates += 1;
          const result =
            state.results.length > 1 ? state.results.shift()! : state.results[0];
          if (result === 'failed') return { data: null, error: { message: 'timeout' } };
          if (result === 'gone') return { data: null, error: null };
          return { data: { id: 'claim-1' }, error: null };
        },
      };
      return builder;
    },
  }),
}));

vi.mock('@/lib/voice/reminder-audio', () => ({
  enqueueReminderClaimConfirm: async (job: { attempts?: number }) => {
    if (state.queueFails) return false;
    state.queued.push(job);
    return true;
  },
}));

import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  CLAIM_CONFIRM_HOLD,
  CLAIM_CONFIRM_RETRY,
  confirmClaimSent,
  processReminderClaimConfirmJob,
  stampClaimSent,
} from './claim-confirm';

CLAIM_CONFIRM_RETRY.delayMs = 0;
CLAIM_CONFIRM_HOLD.delayMs = 0;

const confirmation = {
  accountId: 'acct-1',
  claimId: 'claim-1',
  claimedAt: '2026-09-29T10:00:00.000+00:00',
  waMessageId: 'wamid.1',
  sentAt: '2026-09-29T10:00:05.000Z',
};

function reset(results: Array<'stamped' | 'gone' | 'failed'>) {
  state.results = results;
  state.updates = 0;
  state.queued = [];
  state.queueFails = false;
}

describe('[CAL-010] confirming a reminder claim', () => {
  it('stamps the claim, and reports a renewed claim as gone', async () => {
    reset(['stamped']);
    expect(await stampClaimSent(supabaseAdmin(), confirmation)).toBe('stamped');
    reset(['gone']);
    expect(await stampClaimSent(supabaseAdmin(), confirmation)).toBe('gone');
  });

  it('retries the stamp in process and lands it', async () => {
    reset(['failed', 'failed', 'stamped']);
    expect(await confirmClaimSent(supabaseAdmin(), confirmation)).toBe(true);
    expect(state.updates).toBe(3);
    expect(state.queued).toEqual([]);
  });

  it('hands the confirmation to the queue worker when the database keeps refusing', async () => {
    reset(['failed']);
    expect(await confirmClaimSent(supabaseAdmin(), confirmation)).toBe(true);
    expect(state.updates).toBe(CLAIM_CONFIRM_RETRY.attempts);
    expect(state.queued).toEqual([{ kind: 'reminder_claim_confirm', ...confirmation }]);
  });

  it('reports false only when neither the database nor the queue takes it', async () => {
    reset(['failed']);
    state.queueFails = true;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await confirmClaimSent(supabaseAdmin(), confirmation)).toBe(false);
    expect(errors.mock.calls.some((call) => String(call[1]).includes('"claimId":"claim-1"'))).toBe(true);
    errors.mockRestore();
  });

  it('the queued job stamps the claim, or requeues itself after a pause until it can', async () => {
    reset(['stamped']);
    await processReminderClaimConfirmJob({ kind: 'reminder_claim_confirm', ...confirmation });
    expect(state.queued).toEqual([]);

    reset(['failed']);
    await processReminderClaimConfirmJob({ kind: 'reminder_claim_confirm', ...confirmation, attempts: 2 });
    expect(state.queued).toEqual([{ kind: 'reminder_claim_confirm', ...confirmation, attempts: 3 }]);

    reset(['failed', 'failed', 'stamped']);
    state.queueFails = true;
    await processReminderClaimConfirmJob({ kind: 'reminder_claim_confirm', ...confirmation });
    expect(state.updates).toBe(3);
  });
});
