import { describe, expect, it } from 'vitest';

import {
  DELIVERY_FAILURE_MARKER,
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
