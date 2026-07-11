import { describe, expect, it } from 'vitest';
import { matchTourIntent } from './intent';

describe('matchTourIntent', () => {
  it.each([
    // English
    ['How do I add a contact?', 'add-contact'],
    ['add new lead', 'add-contact'],
    ['how to add property', 'add-property'],
    ['I want to list a new property', 'add-property'],
    ['connect whatsapp', 'connect-whatsapp'],
    ['how do I set up WhatsApp?', 'connect-whatsapp'],
    ['send a broadcast', 'send-broadcast'],
    ['send message to many people', 'send-broadcast'],
    ['who viewed my properties?', 'check-property-views'],
    ['show me pulse', 'check-property-views'],
    // Hindi / Hinglish
    ['contact kaise add karu', 'add-contact'],
    ['naya lead add karna hai', 'add-contact'],
    ['property kaise dalu', 'add-property'],
    ['whatsapp kaise connect kare', 'connect-whatsapp'],
    ['sabko message bhejna hai', 'send-broadcast'],
    ['kitne log property dekh rahe hai', 'check-property-views'],
  ])('"%s" → %s', (message, tourId) => {
    expect(matchTourIntent(message)).toBe(tourId);
  });

  it.each([
    'what is the pipelines page?',
    'why is my credit balance low',
    'hello',
    'tell me a joke',
    '',
  ])('ambiguous or unrelated "%s" → null', (message) => {
    expect(matchTourIntent(message)).toBeNull();
  });

  it('ignores oversized messages', () => {
    expect(matchTourIntent('add contact '.repeat(60))).toBeNull();
  });
});
