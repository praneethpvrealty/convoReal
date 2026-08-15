import { describe, expect, it } from 'vitest';

import {
  buildGreetingAudience,
  canSendGreeting,
  occasionCountdown,
  templateBlockReason,
} from './greetings';

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
