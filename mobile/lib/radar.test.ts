import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiFetch = vi.fn();

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {
    constructor(
      readonly status: number,
      message: string,
      readonly retryAfterSeconds?: number,
      readonly code?: string
    ) {
      super(message);
    }
  },
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));
vi.mock('@/lib/supabase', () => ({ supabase: {} }));

const { ApiError } = await import('@/lib/api');
const {
  MATCH_ALERT_LOCK_MS,
  matchAlertRefusal,
  matchAlertTimeoutMs,
  sendMatchAlert,
} = await import('./radar');

describe('matchAlertTimeoutMs', () => {
  it('outlasts the default 20-second budget for a nine-target send', () => {
    expect(matchAlertTimeoutMs(9)).toBeGreaterThanOrEqual(150_000);
  });

  it('grows with the batch and stays under the 300-second route limit', () => {
    expect(matchAlertTimeoutMs(1)).toBeLessThan(matchAlertTimeoutMs(5));
    expect(matchAlertTimeoutMs(500)).toBeLessThan(MATCH_ALERT_LOCK_MS);
  });
});

describe('sendMatchAlert', () => {
  beforeEach(() => apiFetch.mockReset().mockResolvedValue({}));

  it('passes a timeout scaled to the number of targets', async () => {
    const targets = Array.from({ length: 9 }, (_, i) => `c${i}`);
    await sendMatchAlert('evt-1', targets, ['c0']);
    expect(apiFetch).toHaveBeenCalledWith(
      '/api/radar/send',
      expect.objectContaining({
        method: 'POST',
        timeoutMs: matchAlertTimeoutMs(9),
      })
    );
    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toEqual({
      eventId: 'evt-1',
      targetIds: targets,
      manualContactIds: ['c0'],
    });
  });
});

describe('matchAlertRefusal', () => {
  it('[RDR-001] names a server refusal so the card refreshes instead of resending', () => {
    expect(
      matchAlertRefusal(
        new ApiError(409, 'busy', undefined, 'SEND_IN_PROGRESS')
      )
    ).toBe('This alert is already being sent.');
    expect(
      matchAlertRefusal(new ApiError(409, 'done', undefined, 'ALREADY_SENT'))
    ).toBe('This alert was already sent.');
  });

  it('leaves every other failure to the generic error', () => {
    expect(
      matchAlertRefusal(new ApiError(500, 'boom', undefined, 'ALREADY_SENT'))
    ).toBeNull();
    expect(matchAlertRefusal(new ApiError(409, 'other'))).toBeNull();
    expect(matchAlertRefusal(new Error('network'))).toBeNull();
  });
});
