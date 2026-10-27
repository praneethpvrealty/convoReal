import { describe, expect, it } from 'vitest';
import {
  BROADCAST_DELETE_CONFIRM,
  broadcastStatusConfig,
  getBroadcastStatus,
  getRecipientStatus,
  hasRetryableRecipients,
  RECIPIENT_STATUS_FILTERS,
  recipientStatusConfig,
  retryFailedSummary,
} from './broadcast-status';

describe('getBroadcastStatus', () => {
  it('returns the matching config for known statuses', () => {
    expect(getBroadcastStatus('sending')).toBe(broadcastStatusConfig.sending);
    expect(getBroadcastStatus('sent')).toBe(broadcastStatusConfig.sent);
    expect(getBroadcastStatus('failed')).toBe(broadcastStatusConfig.failed);
  });

  it('flags `sending` as a live/pulsing state', () => {
    expect(getBroadcastStatus('sending').pulse).toBe(true);
    expect(getBroadcastStatus('sent').pulse).toBeFalsy();
  });

  it('falls back to draft on an unknown status string', () => {
    expect(getBroadcastStatus('not-a-real-status')).toBe(
      broadcastStatusConfig.draft
    );
    expect(getBroadcastStatus('')).toBe(broadcastStatusConfig.draft);
  });

  it('each variant has the dark-theme class triple', () => {
    // Accept both fixed-shade Tailwind names (bg-red-500/10) and
    // token-backed names without a shade number (bg-primary/10) since
    // the brand-accent statuses now ride the active color theme.
    for (const v of Object.values(broadcastStatusConfig)) {
      expect(v.classes).toMatch(/bg-[a-z]+(-\d+)?\/10/);
      expect(v.classes).toMatch(/text-[a-z]+(-\d+)?/);
      expect(v.classes).toMatch(/border-[a-z]+(-\d+)?\/20/);
    }
  });
});

describe('getRecipientStatus', () => {
  it('returns the matching config for known statuses', () => {
    expect(getRecipientStatus('delivered')).toBe(
      recipientStatusConfig.delivered
    );
    expect(getRecipientStatus('read')).toBe(recipientStatusConfig.read);
  });

  it('falls back to pending on an unknown status string', () => {
    expect(getRecipientStatus('???')).toBe(recipientStatusConfig.pending);
  });
});

describe('[UIX-007] broadcast detail actions and filters', () => {
  it('lists every recipient status in the order both surfaces show', () => {
    expect(
      RECIPIENT_STATUS_FILTERS.map((s) => getRecipientStatus(s).label)
    ).toEqual([
      'Pending',
      'Sent',
      'Delivered',
      'Read',
      'Replied',
      'Failed',
      'Rate Limited',
    ]);
    expect([...RECIPIENT_STATUS_FILTERS].sort()).toEqual(
      Object.keys(recipientStatusConfig).sort()
    );
  });

  it('offers retry only while a recipient failed or was rate-limited', () => {
    expect(hasRetryableRecipients([{ status: 'read' }])).toBe(false);
    expect(hasRetryableRecipients([])).toBe(false);
    expect(
      hasRetryableRecipients([{ status: 'sent' }, { status: 'failed' }])
    ).toBe(true);
    expect(hasRetryableRecipients([{ status: 'rate_limited' }])).toBe(true);
  });

  it('summarises a retry in one sentence', () => {
    expect(
      retryFailedSummary({
        retried: 3,
        succeeded: 2,
        failed: 1,
        rateLimited: 0,
      })
    ).toBe('Retried 3 recipients: 2 sent, 1 failed');
    expect(
      retryFailedSummary({
        retried: 1,
        succeeded: 0,
        failed: 0,
        rateLimited: 1,
      })
    ).toBe(
      'Retried 1 recipient: 0 sent, 0 failed, 1 rate-limited (will retry again)'
    );
    expect(retryFailedSummary({ retried: 0 })).toBe(
      'No retryable recipients found'
    );
  });

  it('asks the same delete question', () => {
    expect(BROADCAST_DELETE_CONFIRM).toBe('Delete this broadcast?');
  });
});
