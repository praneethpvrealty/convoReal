import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  burnCredits: vi.fn(),
  refundBurn: vi.fn(),
  refundCredits: vi.fn(),
  startOutboundCall: vi.fn(),
}));

vi.mock('@/lib/credits/burn', () => ({
  burnCredits: (...args: unknown[]) => h.burnCredits(...args),
  refundCredits: (...args: unknown[]) => h.refundCredits(...args),
}));
vi.mock('@/lib/credits/refund-burn', () => ({
  refundBurn: (...args: unknown[]) => h.refundBurn(...args),
}));
vi.mock('./config', () => ({
  getVoiceConfig: async () => ({
    is_active: true,
    reminder_calls_enabled: true,
  }),
  resolveDialCredentials: () => ({
    ok: true,
    mode: 'shared',
    agentId: 'agent',
    apiKey: 'key',
    provider: 'sarvam',
  }),
}));
vi.mock('./outbound-call', () => ({
  startOutboundCall: (...args: unknown[]) => h.startOutboundCall(...args),
}));
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (v: string) => v }));

import { placeReminderCall } from './reminder-call';
import { voiceCallBurnKey } from './campaigns';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

const call = {
  admin: {} as never,
  accountId: 'acct-1',
  contactId: 'contact-1',
  phone: '+919999999999',
  retryKey: 'voice-reminder:claim-1:1790000000000',
  context: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  h.burnCredits.mockResolvedValue({
    success: true,
    balanceAfter: 90,
    deficit: 0,
  });
});

describe('voiceCallBurnKey [CRD-002]', () => {
  it('names one dial attempt, so each attempt is refunded on its own', () => {
    expect(voiceCallBurnKey('rec-1', 2)).toBe('voice-call:rec-1:2');
    expect(voiceCallBurnKey('rec-1', 2)).not.toBe(voiceCallBurnKey('rec-1', 3));
    expect(voiceCallBurnKey('rec-1', 2)).not.toBe(voiceCallBurnKey('rec-2', 2));
  });
});

describe('a reminder call that cannot start [CRD-002]', () => {
  it('refunds the charge it burned, by that charge’s own key', async () => {
    h.startOutboundCall.mockResolvedValue({ ok: false, error: 'busy line' });

    expect(await placeReminderCall(call)).toBe(false);

    expect(h.burnCredits).toHaveBeenCalledWith(
      'acct-1',
      'voice_campaign_call',
      250,
      { retryKey: call.retryKey }
    );
    expect(h.refundBurn).toHaveBeenCalledTimes(1);
    expect(h.refundBurn).toHaveBeenCalledWith(
      'acct-1',
      'voice_campaign_call',
      call.retryKey,
      expect.objectContaining({ reason: expect.stringContaining('contact-1') })
    );
    expect(h.refundCredits).not.toHaveBeenCalled();
  });

  it('refunds nothing when the call started', async () => {
    h.startOutboundCall.mockResolvedValue({ ok: true });

    expect(await placeReminderCall(call)).toBe(true);
    expect(h.refundBurn).not.toHaveBeenCalled();
  });

  it('refunds nothing when the burn was refused', async () => {
    h.burnCredits.mockResolvedValue({
      success: false,
      balanceAfter: 0,
      deficit: 250,
    });

    expect(await placeReminderCall(call)).toBe(false);
    expect(h.startOutboundCall).not.toHaveBeenCalled();
    expect(h.refundBurn).not.toHaveBeenCalled();
  });
});

describe('every refund of a voice campaign attempt names its charge [CRD-002]', () => {
  const dispatcher = read('src/app/api/cron/voice-campaigns/route.ts');
  const webhook = read('src/app/api/webhooks/voice-agent/route.ts');

  it('charges and refunds the dial under one key the three refund paths share', () => {
    expect(dispatcher).toContain(
      '{ retryKey: voiceCallBurnKey(recipient.id, recipient.attempts + 1) }'
    );
    expect(dispatcher).toContain('voiceCallBurnKey(stale.id, stale.attempts)');
    expect(dispatcher).toContain(
      'voiceCallBurnKey(recipient.id, recipient.attempts + 1),\n            {\n              reason: `voice_campaign_call start-failure refund'
    );
    expect(webhook).toContain(
      'voiceCallBurnKey(recipient.id, recipient.attempts)'
    );
  });

  it('no longer refunds a dial by feature and amount', () => {
    expect(dispatcher).not.toContain('refundCredits');
    expect(webhook).not.toContain('refundCredits');
    expect(read('src/lib/voice/reminder-call.ts')).not.toContain(
      'refundCredits'
    );
  });

  it('reads the attempt number the stale requeue needs to find the charge', () => {
    expect(dispatcher).toContain(".select('id, account_id, attempts')");
    expect(webhook).toContain(
      "'id, status, attempts, campaign:voice_campaigns(max_attempts)'"
    );
  });
});

describe('a listing video render that fails [CRD-002]', () => {
  const route = read('src/app/api/properties/[id]/generate-video/route.ts');
  const worker = read('src/lib/video/listing-video-worker.ts');

  it('is charged under a key that travels with the queued job', () => {
    expect(route).toContain("newBurnKey('listing_video')");
    expect(route).toContain('retryKey: burnKey');
    expect(route).toMatch(/requestedBy: ctx\.userId,\s+burnKey,/);
    expect(worker).toContain('burnKey?: string;');
  });

  it('is refunded by that key, and by amount only for a job queued before keys existed', () => {
    expect(worker).toMatch(
      /if \(job\.burnKey\) \{\s+await refundBurn\(job\.accountId, 'listing_video', job\.burnKey/
    );
    expect(worker).toMatch(
      /\} else \{\s+await refundCredits\(\s+job\.accountId,\s+'listing_video'/
    );
  });
});
