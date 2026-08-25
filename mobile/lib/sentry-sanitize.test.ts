import { describe, expect, it } from 'vitest';
import type { ErrorEvent } from '@sentry/react-native';
import { sanitizeSentryEvent } from './sentry-sanitize';

describe('sanitizeSentryEvent', () => {
  it('removes mobile request and contact data', () => {
    const event = sanitizeSentryEvent({
      type: undefined,
      message: 'Crash for person@example.com +91 98765 43210',
      request: { url: 'convoreal://contact/private' },
      user: { id: 'opaque-id', email: 'person@example.com' },
      extra: { route: '/inbox', payload: { message: 'private' } },
    } as ErrorEvent);

    expect(event.request).toBeUndefined();
    expect(event.user).toEqual({ id: 'opaque-id' });
    expect(event.message).toBe('Crash for [email] [phone]');
    expect(event.extra).toEqual({ route: '/inbox' });
  });
});
