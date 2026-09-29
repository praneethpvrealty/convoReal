import { describe, expect, it, vi } from 'vitest';

type Lookup = 'stands' | 'gone' | 'renewed' | 'rearmed' | 'moved' | 'error';

const state = vi.hoisted(() => ({
  lookups: [] as Lookup[],
  burns: 0,
  refunds: 0,
  sends: 0,
  requeued: [] as Array<{ attempts?: number }>,
  mutations: [] as Array<[string, Array<[string, unknown]>]>,
  mutationError: null as { message: string } | null,
  rpcs: [] as Array<[string, Record<string, unknown>]>,
  parked: [] as Array<{ attempts?: number }>,
  enqueueFails: false,
  parkFailures: 0,
}));

const QUEUED_AT = '2026-09-29T10:00:00.000+00:00';

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.rpcs.push([name, args]);
      return { data: null, error: state.mutationError };
    },
    from: () => {
      const filters: Array<[string, unknown]> = [];
      let mutation: string | null = null;
      const builder = {
        select: () => builder,
        update: () => {
          mutation = 'update';
          return builder;
        },
        delete: () => {
          mutation = 'delete';
          return builder;
        },
        eq: (column: string, value: unknown) => {
          filters.push([column, value]);
          if (mutation && column !== 'account_id') state.mutations.push([mutation, [...filters]]);
          return builder;
        },
        is: (column: string, value: unknown) => {
          filters.push([column, value]);
          if (mutation) state.mutations.push([mutation, [...filters]]);
          return builder;
        },
        then: (resolve: (v: { error: { message: string } | null }) => unknown) =>
          resolve({ error: mutation ? state.mutationError : null }),
        maybeSingle: async () => {
          const answer =
            state.lookups.length > 1 ? state.lookups.shift()! : state.lookups[0];
          if (answer === 'error') return { data: null, error: { message: 'timeout' } };
          if (answer === 'gone') return { data: null, error: null };
          return {
            data: {
              id: 'claim-1',
              created_at: answer === 'renewed' ? '2026-09-29T10:05:00.000+00:00' : QUEUED_AT,
              appointment: {
                reminders_rearmed_at:
                  answer === 'rearmed'
                    ? '2026-09-29T10:02:00.000+00:00'
                    : answer === 'moved'
                      ? '2026-09-29T09:59:00.000+00:00'
                      : null,
              },
            },
            error: null,
          };
        },
      };
      return builder;
    },
  }),
}));

vi.mock('@/lib/credits/burn', () => ({
  burnCredits: async () => {
    state.burns += 1;
    return { success: false };
  },
  refundCredits: async () => {
    state.refunds += 1;
  },
}));

vi.mock('@/lib/whatsapp/meta-api-dispatcher', () => ({
  sendWhatsAppMessageAndPersist: async () => {
    state.sends += 1;
    return { success: true, whatsappMessageId: 'wamid.new' };
  },
}));

vi.mock('@/lib/whatsapp/template-language', () => ({
  loadTemplateForContact: async () => ({ template: null, language: 'en' }),
}));

vi.mock('./announcement-worker', () => ({
  synthesizeVoiceNoteOgg: async () => '',
}));

vi.mock('./reminder-audio', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./reminder-audio')>()),
  enqueueReminderAudioJob: async (job: { attempts?: number }) => {
    if (state.enqueueFails) return false;
    state.requeued.push(job);
    return true;
  },
  parkReminderAudioJob: async (job: { attempts?: number }) => {
    if (state.parkFailures > 0) {
      state.parkFailures -= 1;
      return false;
    }
    state.parked.push(job);
    return true;
  },
}));

import { processReminderAudioJob, RETAIN } from './reminder-audio-worker';

RETAIN.delayMs = 0;
RETAIN.rounds = 3;

const job = {
  kind: 'reminder_audio' as const,
  accountId: 'acct-1',
  appointmentId: 'appt-1',
  contactId: 'contact-1',
  claimId: 'claim-1',
  claimedAt: QUEUED_AT,
  userId: null,
  reminderType: '1h' as const,
  spokenText: 'Reminder',
  fallback: { templateName: 'appointment_reminder', templateParams: [], bodyText: 'Reminder' },
};

function reset(lookups: Lookup[]) {
  state.lookups = lookups;
  state.burns = 0;
  state.refunds = 0;
  state.sends = 0;
  state.requeued = [];
  state.mutations = [];
  state.mutationError = null;
  state.rpcs = [];
  state.parked = [];
  state.enqueueFails = false;
  state.parkFailures = 0;
}

describe('processReminderAudioJob', () => {
  it('[CAL-010] drops a note whose claim is gone', async () => {
    reset(['gone']);
    await processReminderAudioJob(job);
    expect(state.burns).toBe(0);
    expect(state.sends).toBe(0);
  });

  it('[CAL-010] drops a note whose claim the cron took over after a re-arm', async () => {
    reset(['renewed']);
    await processReminderAudioJob(job);
    expect(state.burns).toBe(0);
    expect(state.sends).toBe(0);
  });

  it('[CAL-010] drops a note once the appointment is re-armed, before the cron has touched the claim', async () => {
    reset(['rearmed']);
    await processReminderAudioJob(job);
    expect(state.burns).toBe(0);
    expect(state.sends).toBe(0);
  });

  it('[CAL-010] drops a note rendered from an appointment snapshot the re-arm has since replaced', async () => {
    reset(['moved']);
    await processReminderAudioJob({ ...job, rearmedAt: null });
    expect(state.sends).toBe(0);

    reset(['moved']);
    await processReminderAudioJob({ ...job, rearmedAt: '2026-09-29T09:59:00.000Z' });
    expect(state.sends).toBe(1);
  });

  it('[CAL-010] rechecks the claim before sending and drops a note superseded mid-way', async () => {
    reset(['stands', 'gone']);
    await processReminderAudioJob(job);
    expect(state.burns).toBe(1);
    expect(state.sends).toBe(0);
  });

  it('sends under a standing claim and records the message against that claim', async () => {
    reset(['stands']);
    await processReminderAudioJob(job);
    expect(state.burns).toBe(1);
    expect(state.sends).toBe(1);
    expect(state.mutations).toEqual([
      ['update', [['account_id', 'acct-1'], ['id', 'claim-1']]],
      ['update', [['account_id', 'acct-1'], ['id', 'claim-1'], ['created_at', QUEUED_AT]]],
    ]);
  });

  it('requeues, rather than drops, a note whose claim could not be read', async () => {
    reset(['error']);
    await processReminderAudioJob(job);
    expect(state.sends).toBe(0);
    expect(state.requeued).toEqual([{ ...job, attempts: 1 }]);
  });

  it('[CAL-010] hands the reminder back to the cron, unsent, once the claim lookup has failed for the last attempt', async () => {
    reset(['error']);
    await processReminderAudioJob({ ...job, attempts: 2, rearmedAt: null });
    expect(state.requeued).toEqual([]);
    expect(state.sends).toBe(0);
    expect(state.rpcs).toEqual([
      [
        'appointment_reminder_hand_back',
        {
          p_account_id: 'acct-1',
          p_appointment_id: 'appt-1',
          p_contact_id: 'contact-1',
          p_reminder_type: '1h',
          p_claim_id: 'claim-1',
          p_claimed_at: QUEUED_AT,
          p_rearmed_known: true,
          p_rearmed_at: null,
        },
      ],
    ]);
  });

  it('[CAL-010] parks the job when it can neither hand back nor requeue', async () => {
    reset(['error']);
    state.mutationError = { message: 'timeout' };
    state.enqueueFails = true;
    await processReminderAudioJob({ ...job, attempts: 2 });
    expect(state.sends).toBe(0);
    expect(state.requeued).toEqual([]);
    expect(state.parked).toEqual([{ ...job, attempts: 2 }]);
  });

  it('[CAL-010] holds the job across rounds until one store confirms it', async () => {
    reset(['error']);
    state.mutationError = { message: 'timeout' };
    state.enqueueFails = true;
    state.parkFailures = 2;
    await processReminderAudioJob({ ...job, attempts: 2 });
    expect(state.sends).toBe(0);
    expect(state.rpcs).toHaveLength(3);
    expect(state.parked).toEqual([{ ...job, attempts: 2 }]);
  });

  it('logs the payload only once every store has refused it for the whole window', async () => {
    reset(['error']);
    state.mutationError = { message: 'timeout' };
    state.enqueueFails = true;
    state.parkFailures = 99;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    await processReminderAudioJob({ ...job, attempts: 2 });
    expect(state.sends).toBe(0);
    expect(state.rpcs).toHaveLength(RETAIN.rounds);
    expect(state.parked).toEqual([]);
    expect(
      errors.mock.calls.some(
        (call) => typeof call[1] === 'string' && call[1].includes('"appointmentId":"appt-1"')
      )
    ).toBe(true);
    errors.mockRestore();
  });

  it('[CAL-010] keeps the job when the hand-back could not be confirmed', async () => {
    reset(['error']);
    state.mutationError = { message: 'timeout' };
    await processReminderAudioJob({ ...job, attempts: 2, rearmedAt: null });
    expect(state.sends).toBe(0);
    expect(state.requeued).toEqual([{ ...job, attempts: 3, rearmedAt: null }]);
  });

  it('treats a note queued before claims were recorded as standing', async () => {
    reset(['gone']);
    await processReminderAudioJob({ ...job, claimId: undefined, claimedAt: undefined });
    expect(state.sends).toBe(1);
    expect(state.mutations).toEqual([
      ['update', [['account_id', 'acct-1'], ['appointment_id', 'appt-1']]],
      ['update', [['account_id', 'acct-1'], ['appointment_id', 'appt-1'], ['contact_id', 'contact-1']]],
      ['update', [['account_id', 'acct-1'], ['appointment_id', 'appt-1'], ['contact_id', 'contact-1'], ['reminder_type', '1h']]],
    ]);
  });
});
