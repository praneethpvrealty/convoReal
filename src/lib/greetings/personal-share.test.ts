import { describe, expect, it } from 'vitest';
import { buildPersonalGreetingMessage } from './personal-share';

describe('buildPersonalGreetingMessage', () => {
  it('creates a personalized and signed message', () => {
    expect(
      buildPersonalGreetingMessage({
        messageText: 'Happy Ganesh Chaturthi!',
        contactName: 'Asha',
        senderName: 'Praneeth',
      })
    ).toBe('Dear Asha,\n\nHappy Ganesh Chaturthi!\n\nWarm regards,\nPraneeth');
  });

  it('includes the public greeting card link', () => {
    expect(
      buildPersonalGreetingMessage({
        messageText: 'Best wishes',
        contactName: 'Ravi',
        senderName: 'Praneeth',
        cardUrl: 'https://example.com/card.png',
      })
    ).toContain('View your greeting card: https://example.com/card.png');
  });

  it('uses safe fallbacks for placeholder contacts and missing sender names', () => {
    expect(
      buildPersonalGreetingMessage({
        messageText: 'Best wishes',
        contactName: 'Housing Lead',
      })
    ).toContain('Dear there,');
    expect(
      buildPersonalGreetingMessage({
        messageText: 'Best wishes',
        contactName: 'Housing Lead',
      })
    ).toContain('Your property consultant');
  });
});
