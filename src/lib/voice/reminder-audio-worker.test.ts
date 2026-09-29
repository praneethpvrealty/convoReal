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
}));

const QUEUED_AT = '2026-09-29T10:00:00.000+00:00';

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
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
    state.requeued.push(job);
    return true;
  },
}));

import { processReminderAudioJob } from './reminder-audio-worker';

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
    expect(state.mutations).toContainEqual([
      'delete',
      [['account_id', 'acct-1'], ['id', 'claim-1'], ['created_at', QUEUED_AT]],
    ]);
    expect(state.mutations).toContainEqual([
      'update',
      [['id', 'appt-1'], ['account_id', 'acct-1'], ['reminders_rearmed_at', null]],
    ]);
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
