import { describe, expect, it } from 'vitest';
import {
  greetingDeliveryFromBroadcast,
  greetingInFlightWarning,
  greetingStatusDisplay,
  isGreetingDeliveryInFlight,
} from './delivery';

const sending = { status: 'sending', total: 18, sent: 2, failed: 1 };

describe('greeting delivery status', () => {
  it('[BRC-003] shows progress while the broadcast is still going out, not Sent', () => {
    expect(greetingStatusDisplay('sent', sending)).toEqual({
      label: 'Sending 3 of 18',
      tone: 'sending',
    });
    expect(isGreetingDeliveryInFlight(sending)).toBe(true);
  });

  it('[BRC-003] reads Sent once the broadcast finishes, naming any failures', () => {
    expect(
      greetingStatusDisplay('sent', {
        status: 'sent',
        total: 18,
        sent: 18,
        failed: 0,
      })
    ).toEqual({ label: 'Sent', tone: 'sent' });
    expect(
      greetingStatusDisplay('sent', {
        status: 'sent',
        total: 18,
        sent: 15,
        failed: 3,
      })
    ).toEqual({ label: 'Sent to 15 · 3 failed', tone: 'sent' });
    expect(
      greetingStatusDisplay('sent', {
        status: 'failed',
        total: 2,
        sent: 0,
        failed: 2,
      })
    ).toEqual({ label: 'Failed', tone: 'failed' });
  });

  it('[BRC-003] keeps drafts and greetings without a broadcast as they were', () => {
    expect(greetingStatusDisplay('draft', null)).toEqual({
      label: 'Draft',
      tone: 'draft',
    });
    expect(greetingStatusDisplay('sent', null)).toEqual({
      label: 'Sent',
      tone: 'sent',
    });
  });

  it('[BRC-003] warns against sending again only while the first send is in flight', () => {
    expect(greetingInFlightWarning(sending)).toContain('3 of 18');
    expect(greetingInFlightWarning({ ...sending, status: 'sent' })).toBeNull();
    expect(greetingInFlightWarning(null)).toBeNull();
  });

  it('maps the embedded broadcast row and tolerates a missing one', () => {
    expect(
      greetingDeliveryFromBroadcast({
        status: 'sending',
        total_recipients: 18,
        sent_count: 2,
        failed_count: null,
      })
    ).toEqual({ status: 'sending', total: 18, sent: 2, failed: 0 });
    expect(greetingDeliveryFromBroadcast(null)).toBeNull();
  });
});
