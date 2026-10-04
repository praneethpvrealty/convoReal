import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  burnCredits: vi.fn(),
  refundCredits: vi.fn(),
  refundBurn: vi.fn(),
  synthesize: vi.fn(),
  send: vi.fn(),
  insertResult: { data: null, error: null } as {
    data: unknown;
    error: { code?: string; message: string } | null;
  },
  unlockReads: [] as Array<unknown>,
}));

const claimRow = {
  id: 'claim-1',
  created_at: '2026-10-04T10:00:00.000+00:00',
  appointment: { reminders_rearmed_at: null },
};

vi.mock('@/lib/credits/burn', () => ({
  burnCredits: (...args: unknown[]) => h.burnCredits(...args),
  refundCredits: (...args: unknown[]) => h.refundCredits(...args),
}));
vi.mock('@/lib/credits/refund-burn', () => ({
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
        insert: () => {
          inserting = true;
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
        maybeSingle: async () => ({ data: claimRow, error: null }),
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

const unlockKey = 'unlock:acct-1:prop-1';
const audioKey = 'reminder-audio:appt-1:contact-1:morning';

function unlockRequest() {
  return new NextRequest('http://localhost/api/match-unlocks', {
    method: 'POST',
    body: JSON.stringify({ property_id: 'prop-1' }),
  });
}

const job: ReminderAudioJob = {
  kind: 'reminder_audio',
  accountId: 'acct-1',
  appointmentId: 'appt-1',
  contactId: 'contact-1',
  claimId: 'claim-1',
  claimedAt: claimRow.created_at,
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

beforeEach(() => {
  vi.clearAllMocks();
  h.unlockReads = [];
  h.insertResult = { data: null, error: null };
  h.burnCredits.mockResolvedValue({
    success: true,
    balanceAfter: 10,
    deficit: 0,
  });
  h.refundCredits.mockResolvedValue({ success: true, balanceAfter: 60 });
  const note = join(mkdtempSync(join(tmpdir(), 'crd004-')), 'note.ogg');
  writeFileSync(note, 'ogg');
  h.synthesize.mockResolvedValue(note);
  h.send.mockResolvedValue({ success: true, whatsappMessageId: 'wamid.1' });
});

describe('match unlock refunds stay on refundCredits: the key names the (account, property) subject and a concurrent winner’s kept charge shares it [CRD-004]', () => {
  it('burns under the subject key and records that key on the unlock row', async () => {
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
      expect.objectContaining({ retryKey: unlockKey })
    );
    expect(h.refundCredits).not.toHaveBeenCalled();
    expect(h.refundBurn).not.toHaveBeenCalled();
  });

  it('refunds the losing duplicate by feature and amount, never by the shared key', async () => {
    h.insertResult = {
      data: null,
      error: { code: '23505', message: 'duplicate key' },
    };
    h.unlockReads = [null, { id: 'winner', property_id: 'prop-1' }];

    const res = await POST(unlockRequest());
    const body = await res.json();

    expect(body.already).toBe(true);
    expect(body.unlock).toEqual({ id: 'winner', property_id: 'prop-1' });
    expect(h.refundCredits).toHaveBeenCalledTimes(1);
    expect(h.refundCredits).toHaveBeenCalledWith('acct-1', 'match_unlock', 50, {
      description: 'match_unlock duplicate refund',
    });
    expect(h.refundBurn).not.toHaveBeenCalled();
  });

  it('refunds an unrecorded unlock by feature and amount, never by the shared key', async () => {
    h.insertResult = {
      data: null,
      error: { code: '57014', message: 'statement timeout' },
    };

    const res = await POST(unlockRequest());

    expect(res.status).toBe(500);
    expect(h.refundCredits).toHaveBeenCalledWith('acct-1', 'match_unlock', 50, {
      description: 'match_unlock failed-insert refund',
    });
    expect(h.refundBurn).not.toHaveBeenCalled();
  });

  it('refunds nothing when the account cannot afford the unlock', async () => {
    h.burnCredits.mockResolvedValue({
      success: false,
      balanceAfter: 5,
      deficit: 45,
    });

    const res = await POST(unlockRequest());

    expect(res.status).toBe(402);
    expect(h.refundCredits).not.toHaveBeenCalled();
    expect(h.refundBurn).not.toHaveBeenCalled();
  });

  it('does not import the keyed refund', () => {
    const source = read('src/app/api/match-unlocks/route.ts');
    expect(source).not.toContain('credits/refund-burn');
    expect(source).toContain(`unlock:\${ctx.accountId}:\${propertyId}`);
  });
});

describe('reminder audio refunds stay on refundCredits: a re-armed or taken-over claim burns the same key again after a kept charge [CRD-004]', () => {
  it('burns under the recipient and type key', async () => {
    await processReminderAudioJob(job);

    expect(h.burnCredits).toHaveBeenCalledWith('acct-1', 'reminder_audio', 2, {
      retryKey: audioKey,
    });
  });

  it('refunds a failed render by feature and amount, then falls back to the template', async () => {
    h.synthesize.mockRejectedValue(new Error('tts down'));

    await processReminderAudioJob(job);

    expect(h.refundCredits).toHaveBeenCalledTimes(1);
    expect(h.refundCredits).toHaveBeenCalledWith(
      'acct-1',
      'reminder_audio',
      2,
      { description: 'reminder audio refund (appt-1/contact-1/morning)' }
    );
    expect(h.refundBurn).not.toHaveBeenCalled();
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.send.mock.calls[0][0]).toMatchObject({ kind: 'template' });
  });

  it('refunds a failed voice-note send by feature and amount', async () => {
    h.send.mockResolvedValueOnce({ success: false, error: 'blocked' });

    await processReminderAudioJob(job);

    expect(h.refundCredits).toHaveBeenCalledTimes(1);
    expect(h.refundBurn).not.toHaveBeenCalled();
    expect(h.send).toHaveBeenCalledTimes(2);
  });

  it('keeps the charge and refunds nothing when the voice note goes out', async () => {
    await processReminderAudioJob(job);

    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.refundCredits).not.toHaveBeenCalled();
    expect(h.refundBurn).not.toHaveBeenCalled();
  });

  it('does not import the keyed refund', () => {
    const source = read('src/lib/voice/reminder-audio-worker.ts');
    expect(source).not.toContain('credits/refund-burn');
    expect(source).toContain(
      'reminder-audio:${job.appointmentId}:${job.contactId}:${job.reminderType}'
    );
  });
});
