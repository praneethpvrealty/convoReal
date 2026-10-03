import { describe, expect, it } from 'vitest';
import { sanitizePerformanceEvent } from './performance-insights';

describe('sanitizePerformanceEvent', () => {
  it('keeps a useful static page measurement without query data', () => {
    const event = {
      type: 'vital' as const,
      route: '/contacts',
      url: 'https://www.convoreal.com/contacts?phone=919999999999#private',
    };
    expect(sanitizePerformanceEvent(event)).toEqual({
      type: 'vital',
      route: '/contacts',
      url: 'https://www.convoreal.com/contacts',
    });
    expect(event.url).toContain('phone=');
  });

  it('replaces document tokens with the dynamic route pattern', () => {
    expect(
      sanitizePerformanceEvent({
        type: 'vital',
        route: '/docs/[token]',
        url: 'https://www.convoreal.com/docs/private-document-token?key=secret',
      })
    ).toEqual({
      type: 'vital',
      route: '/docs/[token]',
      url: 'https://www.convoreal.com/docs/[token]',
    });
  });

  it('drops events without a normalized route rather than sending a raw URL', () => {
    expect(
      sanitizePerformanceEvent({
        type: 'vital',
        url: 'https://www.convoreal.com/docs/private-document-token',
      })
    ).toBeNull();
  });

  it('drops malformed events without throwing into the application', () => {
    expect(
      sanitizePerformanceEvent({
        type: 'vital',
        route: '/contacts',
        url: 'not-a-url',
      })
    ).toBeNull();
    expect(
      sanitizePerformanceEvent({
        type: 'vital',
        route: '//other.example',
        url: 'https://www.convoreal.com/',
      })
    ).toBeNull();
  });
});
