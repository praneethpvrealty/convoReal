import { describe, expect, it } from 'vitest';
import { hashOtpCode, MAX_OTP_ATTEMPTS } from './admin-otp';
import {
  computeExtendedUntil,
  effectivePeriodEnd,
  evaluateExtensionChallenge,
  hashExtensionPayload,
  hashRevokePayload,
  isValidExtensionReason,
  MAX_BULK_ACCOUNTS,
  MAX_EXTENSION_DAYS,
  parseExtensionRequest,
  parseRevokeRequest,
  type ExtensionChallengeRow,
} from './admin-extension';

const NOW = Date.parse('2026-08-06T10:00:00.000Z');
const FUTURE = new Date(NOW + 60_000).toISOString();
const PAST = new Date(NOW - 60_000).toISOString();

const ACCOUNT_A = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_B = '22222222-2222-4222-8222-222222222222';

function body(over: Record<string, unknown> = {}) {
  return { accountIds: [ACCOUNT_A], days: 7, reason: 'outage', ...over };
}

function parsed(over: Record<string, unknown> = {}) {
  const result = parseExtensionRequest(body(over));
  if (!result.ok)
    throw new Error(`expected a valid request, got: ${result.error}`);
  return result.value;
}

describe('parseExtensionRequest', () => {
  it('accepts a minimal single-account grant', () => {
    expect(parsed()).toEqual({
      accountIds: [ACCOUNT_A],
      days: 7,
      reason: 'outage',
      note: null,
      incidentRef: null,
      customerMessage: null,
      notify: true,
    });
  });

  it('notifies unless notify is explicitly false, so a dropped field never silences the apology', () => {
    expect(parsed({ notify: undefined }).notify).toBe(true);
    expect(parsed({ notify: null }).notify).toBe(true);
    expect(parsed({ notify: true }).notify).toBe(true);
    expect(parsed({ notify: false }).notify).toBe(false);
  });

  it('keeps a customer message and rejects one that would overflow the template body', () => {
    expect(
      parsed({ customerMessage: '  We were down for 3 hours.  ' })
        .customerMessage
    ).toBe('We were down for 3 hours.');
    expect(parsed({ customerMessage: '   ' }).customerMessage).toBeNull();
    expect(
      parseExtensionRequest(body({ customerMessage: 'x'.repeat(601) })).ok
    ).toBe(false);
  });

  it("dedupes and sorts account ids so one account can't be double-credited", () => {
    const value = parsed({
      accountIds: [ACCOUNT_B, ACCOUNT_A, ACCOUNT_B],
      incidentRef: 'INC-2026-08-06',
    });
    expect(value.accountIds).toEqual([ACCOUNT_A, ACCOUNT_B]);
  });

  it.each([
    ['a missing body', null],
    ['an empty account list', body({ accountIds: [] })],
    ['a non-uuid account id', body({ accountIds: ['not-a-uuid'] })],
    ['zero days', body({ days: 0 })],
    ['negative days', body({ days: -5 })],
    ['fractional days', body({ days: 1.5 })],
    ['days past the cap', body({ days: MAX_EXTENSION_DAYS + 1 })],
    ['an unknown reason', body({ reason: 'because' })],
    ['a bad incident ref', body({ incidentRef: 'inc 2026/08' })],
  ])('rejects %s', (_label, input) => {
    expect(parseExtensionRequest(input).ok).toBe(false);
  });

  it('rejects a bulk grant beyond the account cap', () => {
    const accountIds = Array.from(
      { length: MAX_BULK_ACCOUNTS + 1 },
      (_, i) => `${String(i).padStart(8, '0')}-1111-4111-8111-111111111111`
    );
    const result = parseExtensionRequest(
      body({ accountIds, incidentRef: 'INC-1' })
    );
    expect(result).toMatchObject({ ok: false });
  });

  it('requires an incident ref once more than one account is involved', () => {
    expect(
      parseExtensionRequest(body({ accountIds: [ACCOUNT_A, ACCOUNT_B] }))
    ).toMatchObject({
      ok: false,
    });
    expect(
      parseExtensionRequest(
        body({ accountIds: [ACCOUNT_A, ACCOUNT_B], incidentRef: 'INC-1' })
      ).ok
    ).toBe(true);
  });

  it('normalizes blank note and incidentRef to null', () => {
    expect(parsed({ note: '   ', incidentRef: '' })).toMatchObject({
      note: null,
      incidentRef: null,
    });
  });

  it('accepts every documented reason', () => {
    for (const reason of [
      'outage',
      'degraded_service',
      'billing_error',
      'onboarding_delay',
      'support_goodwill',
    ]) {
      expect(isValidExtensionReason(reason)).toBe(true);
      expect(parseExtensionRequest(body({ reason })).ok).toBe(true);
    }
  });
});

describe('hashExtensionPayload', () => {
  it('is stable across client-side ordering of the same logical request', () => {
    const a = parsed({
      accountIds: [ACCOUNT_A, ACCOUNT_B],
      incidentRef: 'INC-1',
    });
    const b = parsed({
      accountIds: [ACCOUNT_B, ACCOUNT_A],
      incidentRef: 'INC-1',
    });
    expect(hashExtensionPayload(a)).toBe(hashExtensionPayload(b));
  });

  it.each([
    ['days', { days: 8 }],
    ['reason', { reason: 'billing_error' }],
    ['note', { note: 'different' }],
    ['incidentRef', { incidentRef: 'INC-2' }],
    ['the account set', { accountIds: [ACCOUNT_B] }],
    [
      'the customer-facing message',
      { customerMessage: 'Different words entirely.' },
    ],
    ['the notify flag', { notify: false }],
  ])('changes when %s changes', (_label, over) => {
    expect(hashExtensionPayload(parsed(over))).not.toBe(
      hashExtensionPayload(parsed())
    );
  });

  it('never collides with a revoke payload', () => {
    const revoke = parseRevokeRequest({ incidentRef: 'INC-1' });
    if (!revoke.ok) throw new Error('expected a valid revoke request');
    expect(hashRevokePayload(revoke.value)).not.toBe(
      hashExtensionPayload(parsed())
    );
  });
});

describe('parseRevokeRequest', () => {
  it('accepts an incident-wide revoke', () => {
    expect(
      parseRevokeRequest({ incidentRef: 'INC-1', reason: 'granted in error' })
    ).toMatchObject({
      ok: true,
      value: {
        extensionIds: [],
        incidentRef: 'INC-1',
        reason: 'granted in error',
      },
    });
  });

  it('accepts a targeted revoke by extension id', () => {
    expect(parseRevokeRequest({ extensionIds: [ACCOUNT_A] })).toMatchObject({
      ok: true,
      value: { extensionIds: [ACCOUNT_A], incidentRef: null },
    });
  });

  it.each([
    ['neither selector', {}],
    ['both selectors', { extensionIds: [ACCOUNT_A], incidentRef: 'INC-1' }],
    ['a non-uuid extension id', { extensionIds: ['nope'] }],
  ])('rejects %s', (_label, input) => {
    expect(parseRevokeRequest(input).ok).toBe(false);
  });
});

describe('evaluateExtensionChallenge', () => {
  const payloadHash = hashExtensionPayload(parsed());

  function challenge(
    over: Partial<ExtensionChallengeRow> = {}
  ): ExtensionChallengeRow {
    return {
      id: 'challenge-1',
      admin_user_id: 'admin-1',
      code_hash: hashOtpCode('123456'),
      attempts: 0,
      expires_at: FUTURE,
      used_at: null,
      action: 'extension_grant',
      payload_hash: payloadHash,
      ...over,
    };
  }

  const goodInput = {
    code: '123456',
    nowMs: NOW,
    adminUserId: 'admin-1',
    action: 'extension_grant' as const,
    payloadHash,
  };

  it('accepts a correct code within its binding and window', () => {
    expect(evaluateExtensionChallenge(challenge(), goodInput)).toEqual({
      ok: true,
    });
  });

  it.each([
    ['not_found', null, false],
    ['used', challenge({ used_at: PAST }), false],
    ['expired', challenge({ expires_at: PAST }), false],
    ['too_many_attempts', challenge({ attempts: MAX_OTP_ATTEMPTS }), false],
  ] as const)(
    'rejects with %s and does not burn an attempt',
    (reason, row, increments) => {
      expect(evaluateExtensionChallenge(row, goodInput)).toEqual({
        ok: false,
        reason,
        incrementAttempts: increments,
      });
    }
  );

  it('rejects a challenge issued to a different admin', () => {
    expect(
      evaluateExtensionChallenge(challenge(), {
        ...goodInput,
        adminUserId: 'admin-2',
      })
    ).toEqual({
      ok: false,
      reason: 'admin_mismatch',
      incrementAttempts: true,
    });
  });

  it('rejects a grant code spent on a revoke', () => {
    expect(
      evaluateExtensionChallenge(challenge(), {
        ...goodInput,
        action: 'extension_revoke',
      })
    ).toMatchObject({ reason: 'action_mismatch', incrementAttempts: true });
  });

  it('rejects a code replayed against a different payload — the whole point of the binding', () => {
    const escalated = hashExtensionPayload(
      parsed({
        accountIds: [ACCOUNT_A, ACCOUNT_B],
        days: 90,
        incidentRef: 'INC-1',
      })
    );
    expect(
      evaluateExtensionChallenge(challenge(), {
        ...goodInput,
        payloadHash: escalated,
      })
    ).toMatchObject({ reason: 'payload_mismatch', incrementAttempts: true });
  });

  it('rejects a challenge row carrying no payload hash at all', () => {
    expect(
      evaluateExtensionChallenge(challenge({ payload_hash: null }), goodInput)
    ).toMatchObject({
      reason: 'payload_mismatch',
    });
    expect(
      evaluateExtensionChallenge(challenge({ payload_hash: '' }), goodInput)
    ).toMatchObject({
      reason: 'payload_mismatch',
    });
  });

  it('rejects a wrong code', () => {
    expect(
      evaluateExtensionChallenge(challenge(), { ...goodInput, code: '000000' })
    ).toEqual({
      ok: false,
      reason: 'wrong_code',
      incrementAttempts: true,
    });
  });

  it('checks the payload binding before the code, so a wrong code AND wrong payload reports payload_mismatch', () => {
    expect(
      evaluateExtensionChallenge(challenge(), {
        ...goodInput,
        code: '000000',
        payloadHash: hashExtensionPayload(parsed({ days: 90 })),
      })
    ).toMatchObject({ reason: 'payload_mismatch' });
  });
});

describe('computeExtendedUntil', () => {
  const DAY = 24 * 60 * 60 * 1000;

  it('adds the days to a future period end', () => {
    const periodEnd = new Date(NOW + 10 * DAY).toISOString();
    expect(computeExtendedUntil(periodEnd, 7, NOW)).toBe(
      new Date(NOW + 17 * DAY).toISOString()
    );
  });

  it('anchors on now when the period has already lapsed, so the credit is actually usable', () => {
    const lapsed = new Date(NOW - 30 * DAY).toISOString();
    expect(computeExtendedUntil(lapsed, 7, NOW)).toBe(
      new Date(NOW + 7 * DAY).toISOString()
    );
  });

  it.each([[null], [undefined], ['not-a-date']])(
    'anchors on now when the period end is %s',
    (periodEnd) => {
      expect(computeExtendedUntil(periodEnd as string | null, 3, NOW)).toBe(
        new Date(NOW + 3 * DAY).toISOString()
      );
    }
  );
});

describe('effectivePeriodEnd', () => {
  it('takes the later of the gateway period and the credit deadline', () => {
    const earlier = new Date(NOW).toISOString();
    const later = new Date(NOW + 60_000).toISOString();
    expect(effectivePeriodEnd(earlier, later)).toBe(later);
    expect(effectivePeriodEnd(later, earlier)).toBe(later);
  });

  it('lets a renewal naturally overtake a spent credit, so days are never granted twice', () => {
    const renewed = new Date(NOW + 30 * 24 * 60 * 60 * 1000).toISOString();
    const oldCredit = new Date(NOW - 24 * 60 * 60 * 1000).toISOString();
    expect(effectivePeriodEnd(renewed, oldCredit)).toBe(renewed);
  });

  it('falls back to whichever side is present, and null when neither is', () => {
    const only = new Date(NOW).toISOString();
    expect(effectivePeriodEnd(null, only)).toBe(only);
    expect(effectivePeriodEnd(only, null)).toBe(only);
    expect(effectivePeriodEnd(null, null)).toBeNull();
  });
});
