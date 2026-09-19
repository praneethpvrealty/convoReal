import { describe, expect, it } from 'vitest';

import {
  canRetryDeliveryFailure,
  deliveryFailurePresentation,
  deliveryFailureUpdate,
  DELIVERY_FAILURE_MARKER,
  META_MARKETING_FREQUENCY_ERROR,
  isMarketingTemplateSuppressed,
  stripDeliveryFailure,
} from './delivery-failure';

describe('stripDeliveryFailure', () => {
  it('takes the appended failure note back off', () => {
    const stored = [
      '🏠 *New Property Match*',
      '',
      '₹14.70 Cr · 4,200 Sq.Ft.',
      '',
      `${DELIVERY_FAILURE_MARKER}`,
      '[Error 131049] This message was not delivered to maintain healthy ecosystem engagement.',
    ].join('\n');

    expect(stripDeliveryFailure(stored)).toBe(
      '🏠 *New Property Match*\n\n₹14.70 Cr · 4,200 Sq.Ft.'
    );
  });

  it('leaves a message that never failed alone', () => {
    expect(stripDeliveryFailure('Sharing the layout now')).toBe(
      'Sharing the layout now'
    );
  });

  it('is empty when the note is all there is', () => {
    expect(
      stripDeliveryFailure(`${DELIVERY_FAILURE_MARKER}\n[Error 131049] nope`)
    ).toBe('');
    expect(stripDeliveryFailure(null)).toBe('');
  });
});

describe('[INB-008] structured delivery failures', () => {
  const failed = {
    status: 'failed',
    content_text: 'One new listing matches your search',
    error_code: META_MARKETING_FREQUENCY_ERROR,
    error_info: 'Meta error',
    retry_after: '2026-09-20T10:00:00.000Z',
    created_at: '2026-09-19T10:00:00.000Z',
  };

  it('stores 131049 as metadata and schedules one retry after 24 hours', () => {
    expect(
      deliveryFailureUpdate(
        [
          {
            code: 131049,
            message:
              'This message was not delivered to maintain healthy ecosystem engagement.',
          },
        ],
        new Date('2026-09-19T10:00:00.000Z')
      )
    ).toEqual({
      error_code: 131049,
      error_info:
        'WhatsApp temporarily limited marketing messages to this contact. Wait until the cooldown ends or until the contact replies.',
      retry_after: '2026-09-20T10:00:00.000Z',
    });
  });

  it('blocks an immediate retry and permits one after the cooldown', () => {
    expect(
      canRetryDeliveryFailure(failed, new Date('2026-09-19T12:00:00.000Z'))
    ).toBe(false);
    expect(
      canRetryDeliveryFailure(failed, new Date('2026-09-20T10:00:00.000Z'))
    ).toBe(true);
  });

  it('suppresses only Marketing templates while the cooldown is active', () => {
    const now = new Date('2026-09-19T12:00:00.000Z');
    const until = '2026-09-20T10:00:00.000Z';
    expect(isMarketingTemplateSuppressed('Marketing', until, now)).toBe(true);
    expect(isMarketingTemplateSuppressed('MARKETING', until, now)).toBe(true);
    expect(isMarketingTemplateSuppressed('Utility', until, now)).toBe(false);
    expect(
      isMarketingTemplateSuppressed(
        'Marketing',
        until,
        new Date('2026-09-21T10:00:00.000Z')
      )
    ).toBe(false);
  });

  it('presents a friendly explanation without changing the message body', () => {
    const presentation = deliveryFailurePresentation(
      failed,
      new Date('2026-09-19T12:00:00.000Z')
    );
    expect(presentation?.title).toBe(
      'Not delivered — WhatsApp marketing limit'
    );
    expect(presentation?.detail).not.toContain('healthy ecosystem');
    expect(stripDeliveryFailure(failed.content_text)).toBe(
      'One new listing matches your search'
    );
  });
});
