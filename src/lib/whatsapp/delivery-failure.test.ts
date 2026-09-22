import { describe, expect, it } from 'vitest';

import {
  canRetryDeliveryFailure,
  deliveryFailurePresentation,
  deliveryFailureUpdate,
  DELIVERY_FAILURE_MARKER,
  META_MARKETING_EXPERIMENT_ERROR,
  META_MARKETING_FREQUENCY_ERROR,
  isMarketingBlockError,
  isMarketingTemplateSuppressed,
  laterSuppression,
  MarketingPausedError,
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

describe('the WhatsApp experiment block (130472)', () => {
  const failed = (created: string) => ({
    status: 'failed',
    error_code: META_MARKETING_EXPERIMENT_ERROR,
    error_info:
      "User's number is part of an experiment: Failed to send message because this user's phone number is part of an experiment",
    created_at: created,
    retry_after: null,
  });

  it('[INB-008] is recognised as a marketing block, like the frequency cap', () => {
    expect(
      isMarketingBlockError(
        new Error("[Error 130472] User's number is part of an experiment")
      )
    ).toBe(true);
    expect(
      isMarketingBlockError(
        new Error(`[Error ${META_MARKETING_FREQUENCY_ERROR}] capped`)
      )
    ).toBe(true);
    expect(
      isMarketingBlockError(new Error('[Error 131026] undeliverable'))
    ).toBe(false);
  });

  it("[INB-008] records the pause with Meta's own code and a long horizon", () => {
    const at = new Date('2026-09-22T06:00:00.000Z');
    const update = deliveryFailureUpdate(
      [
        {
          code: META_MARKETING_EXPERIMENT_ERROR,
          title: "User's number is part of an experiment",
        },
      ],
      at
    );

    expect(update.error_code).toBe(META_MARKETING_EXPERIMENT_ERROR);
    expect(update.error_info).toContain('experiment');
    expect(update.error_info).toContain('Utility template');
    expect(new Date(update.retry_after as string).getTime()).toBe(
      at.getTime() + 30 * 24 * 60 * 60 * 1000
    );
  });

  it('[INB-008] offers no immediate resend and names the experiment', () => {
    const now = new Date('2026-09-22T07:00:00.000Z');
    const message = failed('2026-09-22T06:00:00.000Z');

    expect(canRetryDeliveryFailure(message, now)).toBe(false);
    const presentation = deliveryFailurePresentation(message, now);
    expect(presentation?.title).toBe(
      'Not delivered — WhatsApp experiment on this number'
    );
    expect(presentation?.detail).toContain('message you');
    expect(presentation?.canRetry).toBe(false);
  });

  it('[INB-008] allows a retry once the horizon has passed', () => {
    const message = failed('2026-08-01T06:00:00.000Z');
    const now = new Date('2026-09-22T07:00:00.000Z');

    expect(canRetryDeliveryFailure(message, now)).toBe(true);
    expect(deliveryFailurePresentation(message, now)?.canRetry).toBe(true);
  });

  it('[INB-008] pauses only Marketing templates for that contact', () => {
    const until = '2026-10-22T06:00:00.000Z';
    const now = new Date('2026-09-22T07:00:00.000Z');

    expect(isMarketingTemplateSuppressed('Marketing', until, now)).toBe(true);
    expect(isMarketingTemplateSuppressed('Utility', until, now)).toBe(false);
  });
});

describe('keeping the longer pause', () => {
  it('[INB-008] a 24-hour cap never shortens a 30-day experiment block', () => {
    const experiment = '2026-10-22T06:00:00.000Z';
    const cap = '2026-09-23T06:00:00.000Z';

    expect(laterSuppression(experiment, cap)).toBe(experiment);
    expect(laterSuppression(cap, experiment)).toBe(experiment);
    expect(laterSuppression(null, cap)).toBe(cap);
    expect(laterSuppression(undefined, cap)).toBe(cap);
  });
});

describe('MarketingPausedError', () => {
  it('[INB-008] carries the code and the standing pause, not a new one', () => {
    const err = new MarketingPausedError(
      META_MARKETING_EXPERIMENT_ERROR,
      '2026-10-22T06:00:00.000Z'
    );

    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe(META_MARKETING_EXPERIMENT_ERROR);
    expect(err.pausedUntil).toBe('2026-10-22T06:00:00.000Z');
    // Still readable as a block by the code that parses error strings.
    expect(isMarketingBlockError(err)).toBe(true);
    expect(err.message).toContain('experiment');
  });
});
