import { describe, expect, it } from 'vitest';
import type { ErrorEvent } from '@sentry/nextjs';
import { sanitizeSentryEvent, sentryDataCollection } from './sanitize';

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

describe('sentryDataCollection', () => {
  it('opts out of every customer-data category Sentry 11 collects by default', () => {
    expect(sentryDataCollection).toMatchObject({
      userInfo: false,
      cookies: false,
      httpBodies: [],
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      graphQL: { document: false, variables: false },
    });
  });

  it('drops network identity headers and query params', () => {
    const deny = ['forwarded', '-ip', 'remote-', 'via', '-user'];
    expect(sentryDataCollection.httpHeaders).toEqual({
      request: { deny },
      response: { deny },
    });
    expect(sentryDataCollection.urlQueryParams).toEqual({ deny });
  });
});
