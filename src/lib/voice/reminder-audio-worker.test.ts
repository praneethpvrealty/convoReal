import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  claims: new Set<string>(),
  burns: 0,
  sends: 0,
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => {
      let claimId: unknown = null;
      const builder = {
        select: () => builder,
        eq: (_column: string, value: unknown) => {
          claimId = value;
          return builder;
        },
        maybeSingle: async () => ({
          data: state.claims.has(String(claimId)) ? { id: claimId } : null,
          error: null,
        }),
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
  refundCredits: async () => undefined,
}));

vi.mock('@/lib/whatsapp/meta-api-dispatcher', () => ({
  sendWhatsAppMessageAndPersist: async () => {
    state.sends += 1;
    return { success: true, whatsappMessageId: null };
  },
}));

vi.mock('@/lib/whatsapp/template-language', () => ({
  loadTemplateForContact: async () => ({ template: null, language: 'en' }),
}));

vi.mock('./announcement-worker', () => ({
  synthesizeVoiceNoteOgg: async () => '',
}));

import { processReminderAudioJob } from './reminder-audio-worker';

const job = {
  kind: 'reminder_audio' as const,
  accountId: 'acct-1',
  appointmentId: 'appt-1',
  contactId: 'contact-1',
  claimId: 'claim-1',
  userId: null,
  reminderType: '1h' as const,
  spokenText: 'Reminder',
  fallback: { templateName: 'appointment_reminder', templateParams: [], bodyText: 'Reminder' },
};

describe('processReminderAudioJob', () => {
  it('[CAL-010] drops a note whose claim was released by a reopen or reschedule', async () => {
    state.claims = new Set();
    state.burns = 0;
    state.sends = 0;
    await processReminderAudioJob(job);
    expect(state.burns).toBe(0);
    expect(state.sends).toBe(0);
  });

  it('sends when the claim it was queued under still stands', async () => {
    state.claims = new Set(['claim-1']);
    state.burns = 0;
    state.sends = 0;
    await processReminderAudioJob(job);
    expect(state.burns).toBe(1);
    expect(state.sends).toBe(1);
  });
});
