import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiFetch = vi.fn();

vi.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));
vi.mock('@/lib/supabase', () => ({ supabase: {} }));

const { matchAlertTimeoutMs, sendMatchAlert } = await import('./radar');

describe('matchAlertTimeoutMs', () => {
  it('outlasts the default 20-second budget for a nine-target send', () => {
    expect(matchAlertTimeoutMs(9)).toBeGreaterThanOrEqual(150_000);
  });

  it('grows with the batch and stays under the 300-second route limit', () => {
    expect(matchAlertTimeoutMs(1)).toBeLessThan(matchAlertTimeoutMs(5));
    expect(matchAlertTimeoutMs(500)).toBeLessThan(300_000);
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
