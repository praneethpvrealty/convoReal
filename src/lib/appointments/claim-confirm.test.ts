import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  results: [] as Array<'stamped' | 'gone' | 'failed' | 'duplicate'>,
  updates: 0,
  patches: [] as Array<Record<string, unknown>>,
  inserts: [] as Array<Record<string, unknown>>,
  queued: [] as Array<{ attempts?: number }>,
  queueFails: false,
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const builder = {
        update: (patch: Record<string, unknown>) => {
          state.patches.push(patch);
          return builder;
        },
        insert: (row: Record<string, unknown>) => {
          state.inserts.push(row);
          return builder;
        },
        eq: () => builder,
        select: () => builder,
        then: (resolve: (v: { error: null }) => unknown) => resolve({ error: null }),
        maybeSingle: async () => {
          state.updates += 1;
          const result =
            state.results.length > 1 ? state.results.shift()! : state.results[0];
          if (result === 'failed') return { data: null, error: { message: 'timeout' } };
          if (result === 'duplicate') return { data: null, error: { code: '23505', message: 'duplicate' } };
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
  appointmentId: 'appt-1',
  contactId: 'contact-1',
  liaisonId: null,
  reminderType: '1h' as const,
  rearmedAt: null,
  waMessageId: 'wamid.1',
  sentAt: '2026-09-29T10:00:05.000Z',
};

function reset(results: Array<'stamped' | 'gone' | 'failed' | 'duplicate'>) {
  state.results = results;
  state.updates = 0;
  state.patches = [];
  state.inserts = [];
  state.queued = [];
  state.queueFails = false;
}

describe('[CAL-010] confirming a reminder claim', () => {
  it('stamps the claim, and keeps the earlier message id on a claim the cron renewed meanwhile', async () => {
    reset(['stamped']);
    expect(await stampClaimSent(supabaseAdmin(), confirmation)).toBe('stamped');
    reset(['gone', 'stamped']);
    expect(await stampClaimSent(supabaseAdmin(), confirmation)).toBe('gone');
    expect(state.patches).toEqual([
      { sent_at: confirmation.sentAt, wa_message_id: 'wamid.1' },
      { prior_wa_message_id: 'wamid.1' },
    ]);
    expect(state.inserts).toEqual([]);
  });

  it('puts a released claim back as confirmed, since its send went out', async () => {
    reset(['gone', 'gone', 'stamped']);
    expect(await stampClaimSent(supabaseAdmin(), confirmation)).toBe('stamped');
    expect(state.inserts).toEqual([
      {
        id: 'claim-1',
        account_id: 'acct-1',
        appointment_id: 'appt-1',
        contact_id: 'contact-1',
        reminder_type: '1h',
        rearmed_at: null,
        sent_at: confirmation.sentAt,
        wa_message_id: 'wamid.1',
      },
    ]);
  });

  it('keeps the earlier message id on a claim re-made under a new id while it was being put back', async () => {
    reset(['gone', 'gone', 'duplicate', 'stamped']);
    expect(await stampClaimSent(supabaseAdmin(), confirmation)).toBe('gone');
    expect(state.patches.at(-1)).toEqual({ prior_wa_message_id: 'wamid.1' });
  });

  it('holds the confirmation in process for the caller\'s window when the queue refuses too', async () => {
    reset(['failed', 'failed', 'failed', 'stamped']);
    state.queueFails = true;
    expect(await confirmClaimSent(supabaseAdmin(), confirmation, 5_000)).toBe(true);
    expect(state.updates).toBe(4);
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

  it('reports false only once the hold ran out with neither the database nor the queue taking it', async () => {
    reset(['failed']);
    state.queueFails = true;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await confirmClaimSent(supabaseAdmin(), confirmation, 0)).toBe(false);
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
