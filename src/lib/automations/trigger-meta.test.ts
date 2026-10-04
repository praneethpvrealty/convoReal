import { describe, expect, it } from 'vitest';

import {
  isTriggerAvailable,
  triggerActivationSentence,
  triggerLabel,
} from './trigger-meta';

describe('trigger availability', () => {
  it('marks the triggers with no dispatcher as not yet available', () => {
    for (const t of ['conversation_assigned', 'tag_added', 'time_based']) {
      expect(isTriggerAvailable(t)).toBe(false);
      expect(triggerLabel(t)).toMatch(/\(not yet available\)$/);
    }
  });

  it('keeps the dispatched triggers available with their plain label', () => {
    expect(isTriggerAvailable('new_message_received')).toBe(true);
    expect(triggerLabel('keyword_match')).toBe('Keyword Match');
  });
});

describe('triggerActivationSentence', () => {
  it('names the reach of each trigger in plain words', () => {
    expect(triggerActivationSentence('new_message_received')).toBe(
      'This will run for every incoming message from every contact.'
    );
    expect(triggerActivationSentence('new_contact_created')).toContain(
      'portal email lead or voice call'
    );
    expect(
      triggerActivationSentence('keyword_match', {
        keywords: ['price', ' ', 'visit'],
      })
    ).toBe(
      'This will run for every incoming message that matches "price", "visit", from every contact.'
    );
    expect(triggerActivationSentence('time_based')).toContain(
      'not yet available'
    );
  });
});
