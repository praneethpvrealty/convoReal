import { describe, expect, it } from 'vitest';
import type { ErrorEvent } from '@sentry/nextjs';
import { sanitizeSentryEvent } from './sanitize';

describe('sanitizeSentryEvent', () => {
  it('removes request, identity, and message secrets', () => {
    const event = sanitizeSentryEvent({
      type: undefined,
      message: 'Failed for person@example.com at +91 98765 43210',
      request: {
        url: 'https://www.convoreal.com/inbox?contact=private#message',
        headers: { authorization: 'Bearer secret' },
        data: { message: 'private' },
        query_string: 'contact=private',
        cookies: { session: 'secret' },
      },
      user: {
        id: 'opaque-user-id',
        email: 'person@example.com',
        ip_address: '127.0.0.1',
      },
      extra: {
        operation: 'webhook',
        payload: { message: 'hello' },
        nested: { authorization: 'secret', safeCount: 3 },
      },
    } as ErrorEvent);

    expect(event.request).toEqual({
      url: 'https://www.convoreal.com/inbox',
    });
    expect(event.user).toEqual({ id: 'opaque-user-id' });
    expect(event.message).toBe('Failed for [email] at [phone]');
    expect(event.extra).toEqual({
      operation: 'webhook',
      nested: { safeCount: 3 },
    });
  });
});
