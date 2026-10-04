import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  burnCredits: vi.fn(),
  refundBurn: vi.fn(),
  synthesize: vi.fn(),
  send: vi.fn(),
  insertResult: { data: null, error: null } as {
    data: unknown;
    error: { code?: string; message: string } | null;
  },
  insertedRows: [] as Array<Record<string, unknown>>,
  unlockReads: [] as Array<unknown>,
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
vi.mock('@/lib/auth/account', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/account')>()),
  requireRole: async () => ({
    accountId: 'acct-1',
    userId: 'user-1',
    role: 'agent',
  }),
}));
vi.mock('@/lib/den/masking', () => ({ UNLOCKED_PROPERTY_SELECT: '*' }));
vi.mock('@/lib/den/auth', () => ({
  denAdmin: () => ({
    from: (table: string) => {
      let inserting = false;
      const builder = {
        select: () => builder,
        eq: () => builder,
        insert: (row: Record<string, unknown>) => {
          inserting = true;
          h.insertedRows.push(row);
          return builder;
        },
        single: async () => h.insertResult,
        maybeSingle: async () => {
          if (table === 'properties') {
            return {
              data: {
                id: 'prop-1',
                account_id: 'owner-acct',
                deal_mode: 'open',
                is_published: true,
              },
              error: null,
            };
          }
          if (table === 'den_match_unlocks' && !inserting) {
            return { data: h.unlockReads.shift() ?? null, error: null };
          }
          return { data: null, error: null };
        },
      };
      return builder;
    },
  }),
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

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/match-unlocks/route';
import { processReminderAudioJob } from '@/lib/voice/reminder-audio-worker';
import type { ReminderAudioJob } from '@/lib/voice/reminder-audio';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

const CLAIMED_AT = '2026-10-04T10:00:00.000+00:00';
const TAKEN_OVER_AT = '2026-10-04T10:25:00.000+00:00';
const claimEpoch = (iso: string) => new Date(iso).getTime();

function unlockRequest() {
  return new NextRequest('http://localhost/api/match-unlocks', {
    method: 'POST',
    body: JSON.stringify({ property_id: 'prop-1' }),
  });
}

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
  h.unlockReads = [];
  h.insertedRows = [];
  h.insertResult = { data: null, error: null };
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

describe('match unlock burns under a key that names one charge, and every refund names that key [CRD-004]', () => {
  it('burns under a key minted for the request and records it on the unlock row', async () => {
    h.insertResult = {
      data: { id: 'u1', account_id: 'acct-1', property_id: 'prop-1' },
      error: null,
    };

    const res = await POST(unlockRequest());

    expect(res.status).toBe(200);
    expect(h.burnCredits).toHaveBeenCalledWith(
      'acct-1',
      'match_unlock',
      50,
      expect.objectContaining({
        retryKey: expect.stringMatching(/^match_unlock:/),
      })
    );
    expect(h.insertedRows[0].retry_key).toBe(burnKeyOf(0));
    expect(h.refundBurn).not.toHaveBeenCalled();
  });

  it('mints a different key for every request, so a concurrent duplicate cannot share a kept charge', async () => {
    h.insertResult = { data: { id: 'u1' }, error: null };

    await POST(unlockRequest());
    await POST(unlockRequest());

    expect(burnKeyOf(0)).not.toBe(burnKeyOf(1));
  });

  it('refunds the losing duplicate by its own key and leaves the winner’s charge alone', async () => {
    h.insertResult = { data: { id: 'winner' }, error: null };
    await POST(unlockRequest());
    const winnerKey = burnKeyOf(0);
    expect(h.refundBurn).not.toHaveBeenCalled();

    h.insertResult = {
      data: null,
      error: { code: '23505', message: 'duplicate key' },
    };
    h.unlockReads = [null, { id: 'winner', property_id: 'prop-1' }];
    const res = await POST(unlockRequest());
    const body = await res.json();

    const loserKey = burnKeyOf(1);
    expect(body.already).toBe(true);
    expect(body.unlock).toEqual({ id: 'winner', property_id: 'prop-1' });
    expect(h.refundBurn).toHaveBeenCalledTimes(1);
    expect(h.refundBurn).toHaveBeenCalledWith(
      'acct-1',
      'match_unlock',
      loserKey,
      expect.objectContaining({ reason: 'match_unlock duplicate refund' })
    );
    expect(loserKey).not.toBe(winnerKey);
  });

  it('refunds an unrecorded unlock by the key it burned under', async () => {
    h.insertResult = {
      data: null,
      error: { code: '57014', message: 'statement timeout' },
    };

    const res = await POST(unlockRequest());

    expect(res.status).toBe(500);
    expect(h.refundBurn).toHaveBeenCalledTimes(1);
    expect(h.refundBurn).toHaveBeenCalledWith(
      'acct-1',
      'match_unlock',
      burnKeyOf(0),
      expect.objectContaining({ reason: 'match_unlock failed-insert refund' })
    );
  });

  it('burns afresh on a retry after a refunded failure instead of finding the refunded burn', async () => {
    h.insertResult = {
      data: null,
      error: { code: '57014', message: 'statement timeout' },
    };
    await POST(unlockRequest());
    h.insertResult = { data: { id: 'u1' }, error: null };
    await POST(unlockRequest());

    expect(burnKeyOf(1)).not.toBe(burnKeyOf(0));
    expect(h.refundBurn).toHaveBeenCalledTimes(1);
  });

  it('refunds nothing when the account cannot afford the unlock', async () => {
    h.burnCredits.mockResolvedValue({
      success: false,
      balanceAfter: 5,
      deficit: 45,
    });

    const res = await POST(unlockRequest());

    expect(res.status).toBe(402);
    expect(h.refundBurn).not.toHaveBeenCalled();
  });

  it('returns an existing unlock without burning', async () => {
    h.unlockReads = [{ id: 'existing', property_id: 'prop-1' }];

    const res = await POST(unlockRequest());
    const body = await res.json();

    expect(body.already).toBe(true);
    expect(h.burnCredits).not.toHaveBeenCalled();
    expect(h.refundBurn).not.toHaveBeenCalled();
  });
});

describe('reminder audio burns under a key that names one claim run, and every refund names that key [CRD-004]', () => {
  it('burns under the claim and its clock', async () => {
    await processReminderAudioJob(job);

    expect(h.burnCredits).toHaveBeenCalledWith('acct-1', 'reminder_audio', 2, {
      retryKey: `reminder-audio:claim-1:${claimEpoch(CLAIMED_AT)}`,
    });
  });

  it('shares the key between duplicates of one claim run, so the burn dedupe still holds', async () => {
    await processReminderAudioJob(job);
    await processReminderAudioJob({ ...job });

    expect(burnKeyOf(0)).toBe(burnKeyOf(1));
  });

  it('uses a different key once the claim has been taken over, so the old charge is never reused or reversed', async () => {
    await processReminderAudioJob(job);
    await processReminderAudioJob(takeOver());

    expect(burnKeyOf(0)).not.toBe(burnKeyOf(1));
    expect(burnKeyOf(1)).toBe(
      `reminder-audio:claim-1:${claimEpoch(TAKEN_OVER_AT)}`
    );
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
    'src/app/api/match-unlocks/route.ts',
    'src/lib/voice/reminder-audio-worker.ts',
    'src/lib/voice/reminder-call.ts',
    'src/app/api/cron/voice-campaigns/route.ts',
    'src/app/api/webhooks/voice-agent/route.ts',
  ])('%s does not use refundCredits', (path) => {
    expect(read(path)).not.toContain('refundCredits');
  });

  it('names the claim run in the reminder call key', () => {
    expect(read('src/lib/appointments/reminder.ts')).toContain(
      'voice-reminder:${claim.id}:${new Date(claim.created_at).getTime()}'
    );
  });
});
