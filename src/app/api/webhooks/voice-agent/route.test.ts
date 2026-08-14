import { describe, it, expect, afterEach, vi } from 'vitest';
import { parseVoiceCallPayload, POST } from './route';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('parseVoiceCallPayload', () => {
  it('rejects payloads without a caller phone', () => {
    expect(parseVoiceCallPayload(null)).toBeNull();
    expect(parseVoiceCallPayload('call')).toBeNull();
    expect(parseVoiceCallPayload({})).toBeNull();
    expect(parseVoiceCallPayload({ caller_phone: '   ' })).toBeNull();
    expect(parseVoiceCallPayload({ caller_phone: 12345 })).toBeNull();
  });

  it('applies defaults for a minimal payload', () => {
    const parsed = parseVoiceCallPayload({ caller_phone: '+91 98765 43210' });
    expect(parsed).toMatchObject({
      callerPhone: '+91 98765 43210',
      callId: null,
      callerName: null,
      direction: 'inbound',
      outcome: 'connected',
      durationSeconds: null,
      calledAt: null,
      budgetMax: null,
      areas: [],
      propertyInterest: null,
      campaignId: null,
      qualification: null,
    });
  });

  it('parses campaign linkage and the qualification block', () => {
    const parsed = parseVoiceCallPayload({
      caller_phone: '9876543210',
      campaign_id: 'a4e7a6de-0000-0000-0000-000000000000',
      qualification: {
        budget_confirmed: false,
        stated_budget: 25000000,
        stated_areas: ['HSR Layout'],
        wants_alternatives: true,
        do_not_call: false,
      },
    });
    expect(parsed?.campaignId).toBe('a4e7a6de-0000-0000-0000-000000000000');
    expect(parsed?.qualification).toEqual({
      budgetConfirmed: false,
      statedBudget: 25000000,
      statedAreas: ['HSR Layout'],
      wantsAlternatives: true,
      doNotCall: false,
    });
  });

  it('keeps only allowlisted outcomes', () => {
    expect(
      parseVoiceCallPayload({
        caller_phone: '9876543210',
        outcome: 'no_answer',
      })?.outcome
    ).toBe('no_answer');
    expect(
      parseVoiceCallPayload({ caller_phone: '9876543210', outcome: 'ai_magic' })
        ?.outcome
    ).toBe('connected');
  });

  it('folds callback_requested into a connected outcome only', () => {
    expect(
      parseVoiceCallPayload({
        caller_phone: '9876543210',
        callback_requested: true,
      })?.outcome
    ).toBe('callback_requested');
    expect(
      parseVoiceCallPayload({
        caller_phone: '9876543210',
        outcome: 'no_answer',
        callback_requested: true,
      })?.outcome
    ).toBe('no_answer');
  });

  it('sanitises requirement fields', () => {
    const parsed = parseVoiceCallPayload({
      caller_phone: '9876543210',
      duration_seconds: 184.7,
      called_at: '2026-08-14T09:30:00Z',
      requirement: {
        text: '3 BHK in Whitefield under 1.2Cr',
        budget_max: 12000000,
        areas: ['Whitefield', ' Whitefield ', '', 42, 'HSR Layout'],
        property_interest: 'Flat/ Apartment',
      },
    });
    expect(parsed?.durationSeconds).toBe(184);
    expect(parsed?.calledAt).toBe('2026-08-14T09:30:00.000Z');
    expect(parsed?.budgetMax).toBe(12000000);
    expect(parsed?.areas).toEqual(['Whitefield', 'HSR Layout']);
    expect(parsed?.requirementText).toBe('3 BHK in Whitefield under 1.2Cr');
  });

  it('drops invalid durations, timestamps and budgets', () => {
    const parsed = parseVoiceCallPayload({
      caller_phone: '9876543210',
      duration_seconds: -5,
      called_at: 'yesterday-ish',
      requirement: { budget_max: 'a lot' },
    });
    expect(parsed?.durationSeconds).toBeNull();
    expect(parsed?.calledAt).toBeNull();
    expect(parsed?.budgetMax).toBeNull();
  });
});

describe('POST /api/webhooks/voice-agent', () => {
  const url = 'http://localhost/api/webhooks/voice-agent';
  const post = (query: string) =>
    POST(
      new Request(`${url}${query}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ caller_phone: '9876543210' }),
      })
    );

  it('fails closed with 503 when VOICE_AGENT_WEBHOOK_TOKEN is unset', async () => {
    vi.stubEnv('VOICE_AGENT_WEBHOOK_TOKEN', '');
    const res = await post('?token=anything&account_id=acc');
    expect(res.status).toBe(503);
  });

  it('rejects a wrong token with 401', async () => {
    vi.stubEnv('VOICE_AGENT_WEBHOOK_TOKEN', 'right-token');
    const res = await post('?token=wrong-token&account_id=acc');
    expect(res.status).toBe(401);
  });

  it('requires account_id', async () => {
    vi.stubEnv('VOICE_AGENT_WEBHOOK_TOKEN', 'right-token');
    const res = await post('?token=right-token');
    expect(res.status).toBe(400);
  });
});
