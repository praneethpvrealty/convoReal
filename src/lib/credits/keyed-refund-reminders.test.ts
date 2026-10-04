import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  burnCredits: vi.fn(),
  refundBurn: vi.fn(),
  synthesize: vi.fn(),
  send: vi.fn(),
  claimRow: {
    id: 'claim-1',
    created_at: '2026-10-04T10:00:00.000+00:00',
    appointment: { reminders_rearmed_at: null },
  } as {
    id: string;
    created_at: string;
    appointment: { reminders_rearmed_at: string | null };
  },
}));

vi.mock('@/lib/credits/burn', () => ({
  burnCredits: (...args: unknown[]) => h.burnCredits(...args),
}));
vi.mock('@/lib/credits/refund-burn', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/credits/refund-burn')>()),
  refundBurn: (...args: unknown[]) => h.refundBurn(...args),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () => ({ data: h.claimRow, error: null }),
      };
      return builder;
    },
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        getPublicUrl: () => ({ data: { publicUrl: 'https://cdn/note.ogg' } }),
      }),
    },
  }),
}));
vi.mock('@/lib/whatsapp/meta-api-dispatcher', () => ({
  sendWhatsAppMessageAndPersist: (...args: unknown[]) => h.send(...args),
}));
vi.mock('@/lib/whatsapp/template-language', () => ({
  loadTemplateForContact: async () => ({ template: null, language: 'en' }),
}));
vi.mock('@/lib/appointments/claim-confirm', () => ({
  confirmClaimSent: async () => undefined,
}));
vi.mock('@/lib/voice/announcement-worker', () => ({
  synthesizeVoiceNoteOgg: (...args: unknown[]) => h.synthesize(...args),
}));
vi.mock('@/lib/voice/reminder-audio', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/voice/reminder-audio')>()),
  enqueueReminderAudioJob: async () => true,
  parkReminderAudioJob: async () => true,
}));

import { processReminderAudioJob } from '@/lib/voice/reminder-audio-worker';
import type { ReminderAudioJob } from '@/lib/voice/reminder-audio';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

const CLAIMED_AT = '2026-10-04T10:00:00.000+00:00';
const TAKEN_OVER_AT = '2026-10-04T10:25:00.000+00:00';

function burnKeyOf(call: number): string {
  return h.burnCredits.mock.calls[call][3].retryKey;
}

function writeNote(): string {
  const note = join(mkdtempSync(join(tmpdir(), 'crd004-')), 'note.ogg');
  writeFileSync(note, 'ogg');
  return note;
}

const job: ReminderAudioJob = {
  kind: 'reminder_audio',
  accountId: 'acct-1',
  appointmentId: 'appt-1',
  contactId: 'contact-1',
  claimId: 'claim-1',
  claimedAt: CLAIMED_AT,
  rearmedAt: null,
  userId: 'user-1',
  reminderType: 'morning',
  spokenText: 'Your visit is tomorrow',
  fallback: {
    templateName: 'visit_reminder',
    templateParams: ['a'],
    bodyText: 'Your visit is tomorrow',
  },
};

function takeOver() {
  h.claimRow = { ...h.claimRow, created_at: TAKEN_OVER_AT };
  return { ...job, claimedAt: TAKEN_OVER_AT };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.claimRow = {
    id: 'claim-1',
    created_at: CLAIMED_AT,
    appointment: { reminders_rearmed_at: null },
  };
  h.burnCredits.mockResolvedValue({
    success: true,
    balanceAfter: 10,
    deficit: 0,
  });
  h.refundBurn.mockResolvedValue({ status: 'refunded', refunded: 50 });
  h.synthesize.mockImplementation(async () => writeNote());
  h.send.mockResolvedValue({ success: true, whatsappMessageId: 'wamid.1' });
});

describe('reminder audio burns under a key that names one run, and every refund names that key [CRD-004]', () => {
  it('burns under a key minted for this run', async () => {
    await processReminderAudioJob(job);

    expect(h.burnCredits).toHaveBeenCalledWith('acct-1', 'reminder_audio', 2, {
      retryKey: expect.stringMatching(/^reminder_audio:/),
    });
  });

  it('gives a replayed job a key of its own, so two runs never share a charge', async () => {
    await processReminderAudioJob(job);
    await processReminderAudioJob({ ...job });

    expect(burnKeyOf(0)).not.toBe(burnKeyOf(1));
  });

  it('gives a taken-over claim a key of its own, so the old charge is never reversed', async () => {
    await processReminderAudioJob(job);
    await processReminderAudioJob(takeOver());

    expect(burnKeyOf(0)).not.toBe(burnKeyOf(1));
  });

  it('refunds a failed render by the key it burned under, then falls back to the template', async () => {
    h.synthesize.mockRejectedValue(new Error('tts down'));

    await processReminderAudioJob(job);

    expect(h.refundBurn).toHaveBeenCalledTimes(1);
    expect(h.refundBurn).toHaveBeenCalledWith(
      'acct-1',
      'reminder_audio',
      burnKeyOf(0),
      expect.objectContaining({
        reason: 'reminder audio refund (appt-1/contact-1/morning)',
      })
    );
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.send.mock.calls[0][0]).toMatchObject({ kind: 'template' });
  });

  it('refunds a failed voice-note send by the key it burned under', async () => {
    h.send.mockResolvedValueOnce({ success: false, error: 'blocked' });

    await processReminderAudioJob(job);

    expect(h.refundBurn).toHaveBeenCalledTimes(1);
    expect(h.refundBurn.mock.calls[0][2]).toBe(burnKeyOf(0));
    expect(h.send).toHaveBeenCalledTimes(2);
  });

  it('refunds a note whose claim was taken over mid-render by the key it burned under', async () => {
    h.synthesize.mockImplementation(async () => {
      h.claimRow = { ...h.claimRow, created_at: TAKEN_OVER_AT };
      return writeNote();
    });

    await processReminderAudioJob(job);

    expect(h.send).not.toHaveBeenCalled();
    expect(h.refundBurn).toHaveBeenCalledTimes(1);
    expect(h.refundBurn.mock.calls[0][2]).toBe(burnKeyOf(0));
  });

  it('keeps the charge and refunds nothing when the voice note goes out', async () => {
    await processReminderAudioJob(job);

    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.refundBurn).not.toHaveBeenCalled();
  });

  it('mints a key for the run when the job carries no claim clock', async () => {
    await processReminderAudioJob({ ...job, claimedAt: null });
    await processReminderAudioJob({ ...job, claimedAt: null });

    expect(burnKeyOf(0)).toMatch(/^reminder_audio:/);
    expect(burnKeyOf(0)).not.toBe(burnKeyOf(1));
  });
});

describe('no legacy refund remains for the features these keys charge [CRD-004]', () => {
  it.each([
    'src/lib/voice/reminder-audio-worker.ts',
    'src/lib/voice/reminder-call.ts',
    'src/app/api/cron/voice-campaigns/route.ts',
    'src/app/api/webhooks/voice-agent/route.ts',
  ])('%s does not use refundCredits', (path) => {
    expect(read(path)).not.toContain('refundCredits');
  });

  it('mints a key per reminder call', () => {
    expect(read('src/lib/appointments/reminder.ts')).toContain(
      "retryKey: newBurnKey('voice_campaign_call')"
    );
  });
});
