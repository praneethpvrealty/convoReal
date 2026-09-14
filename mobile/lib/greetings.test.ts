import { describe, expect, it } from 'vitest';

import {
  buildGreetingAudience,
  buildPersonalGreetingMessage,
  canSendGreeting,
  occasionCountdown,
  templateBlockReason,
} from './greetings';

describe('buildPersonalGreetingMessage', () => {
  it('creates a personalized message with a public greeting card link', () => {
    expect(
      buildPersonalGreetingMessage({
        messageText: 'Happy Ganesh Chaturthi!',
        contactName: 'Asha',
        senderName: 'Praneeth',
        cardUrl: 'https://example.com/card.png',
      })
    ).toBe(
      'Dear Asha,\n\nHappy Ganesh Chaturthi!\n\nWarm regards,\nPraneeth\n\nView your greeting card: https://example.com/card.png'
    );
  });

  it('uses safe fallbacks for missing and placeholder names', () => {
    for (const contactName of [undefined, 'Housing Lead']) {
      const message = buildPersonalGreetingMessage({
        messageText: 'Best wishes',
        contactName,
      });
      expect(message).toContain('Dear there,');
      expect(message).toContain('Your property consultant');
    }
  });
});

describe('buildGreetingAudience', () => {
  it('drops the tag list for an all-contacts send', () => {
    expect(buildGreetingAudience('all', ['t1'])).toEqual({ type: 'all' });
  });

  it('carries the tags for a tag send', () => {
    expect(buildGreetingAudience('tags', ['t1', 't2'])).toEqual({
      type: 'tags',
      tagIds: ['t1', 't2'],
    });
  });

  it('carries explicit contact ids for a selected send', () => {
    expect(buildGreetingAudience('contacts', [], ['c1', 'c2'])).toEqual({
      type: 'contacts',
      contactIds: ['c1', 'c2'],
    });
  });
});

describe('canSendGreeting', () => {
  it('refuses until the template is approved', () => {
    expect(canSendGreeting('all', [], null)).toBe(false);
    expect(canSendGreeting('all', [], 'PENDING')).toBe(false);
    expect(canSendGreeting('all', [], 'REJECTED')).toBe(false);
  });

  it('allows an all-contacts send once approved', () => {
    expect(canSendGreeting('all', [], 'APPROVED')).toBe(true);
  });

  it('needs at least one tag for a tag send', () => {
    expect(canSendGreeting('tags', [], 'APPROVED')).toBe(false);
    expect(canSendGreeting('tags', ['t1'], 'APPROVED')).toBe(true);
  });

  it('needs at least one contact for a selected send', () => {
    expect(canSendGreeting('contacts', [], 'APPROVED')).toBe(false);
    expect(canSendGreeting('contacts', [], 'APPROVED', ['c1'])).toBe(true);
  });
});

describe('occasionCountdown', () => {
  it('reads naturally for near dates', () => {
    expect(occasionCountdown(0)).toBe('today');
    expect(occasionCountdown(-1)).toBe('today');
    expect(occasionCountdown(1)).toBe('tomorrow');
    expect(occasionCountdown(30)).toBe('in 30 days');
  });
});

describe('templateBlockReason', () => {
  it('is silent when the template is approved', () => {
    expect(templateBlockReason('APPROVED')).toBeNull();
  });

  it('explains each unusable state', () => {
    expect(templateBlockReason(null)).toContain('does not have the greeting');
    expect(templateBlockReason('PENDING')).toContain('awaiting Meta approval');
    expect(templateBlockReason('REJECTED', 'no reason given')).toContain(
      'no reason given'
    );
    expect(templateBlockReason('PAUSED')).toContain('PAUSED');
  });
});
