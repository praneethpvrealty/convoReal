import { describe, expect, it } from 'vitest';

import { CUSTOMER_WINDOW_MS, customerSessionInfo } from './customer-session';

const NOW = Date.parse('2026-07-27T12:00:00.000Z');

describe('[UIX-006] customerSessionInfo', () => {
  const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();
  const HOUR = 60 * 60 * 1000;

  it('[UIX-006] is closed for a thread with no customer message', () => {
    expect(customerSessionInfo([], NOW)).toEqual({
      expired: true,
      remaining: 'No customer messages',
    });
    expect(
      customerSessionInfo(
        [{ sender_type: 'agent', created_at: at(60_000) }],
        NOW
      )
    ).toEqual({ expired: true, remaining: 'No customer messages' });
  });

  it('[UIX-006] reads the newest customer message in either order', () => {
    const messages = [
      { sender_type: 'customer', created_at: at(30 * HOUR) },
      { sender_type: 'agent', created_at: at(HOUR) },
      { sender_type: 'customer', created_at: at(3 * HOUR + 60_000) },
    ];
    const expected = { expired: false, remaining: '21h remaining' };
    expect(customerSessionInfo(messages, NOW)).toEqual(expected);
    expect(customerSessionInfo([...messages].reverse(), NOW)).toEqual(expected);
  });

  it('[UIX-006] closes exactly at 24 hours', () => {
    expect(
      customerSessionInfo(
        [{ sender_type: 'customer', created_at: at(CUSTOMER_WINDOW_MS) }],
        NOW
      )
    ).toEqual({ expired: true, remaining: 'Expired' });
    expect(
      customerSessionInfo(
        [{ sender_type: 'customer', created_at: at(CUSTOMER_WINDOW_MS - 1) }],
        NOW
      )
    ).toEqual({ expired: false, remaining: '1h remaining' });
  });
});
