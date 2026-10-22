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
    ['help me set up my agency showcase', 'set-up-showcase'],
    ['how do I add services to my public page?', 'set-up-showcase'],
    ['how do I set bot reply rules?', 'set-bot-rules'],
    ['show me missed WhatsApp conversations', 'review-conversation-gaps'],
    ['how do I use the inbox?', 'use-inbox'],
    ['where do I reply to a customer?', 'use-inbox'],
    ['How to track the deals?', 'track-deals'],
    ['add a deal to the pipeline', 'track-deals'],
    ['how do I schedule a site visit?', 'schedule-visit'],
    ['book an appointment', 'schedule-visit'],
    ['how do I invite a teammate?', 'invite-team'],
    ['add an agent to my team', 'invite-team'],
    // Hindi / Hinglish
    ['contact kaise add karu', 'add-contact'],
    ['naya lead add karna hai', 'add-contact'],
    ['property kaise dalu', 'add-property'],
    ['whatsapp kaise connect kare', 'connect-whatsapp'],
    ['sabko message bhejna hai', 'send-broadcast'],
    ['kitne log property dekh rahe hai', 'check-property-views'],
    ['inbox kaise use karu', 'use-inbox'],
    ['naya deal banao', 'track-deals'],
    ['site visit kaise lagao', 'schedule-visit'],
    ['team member add kaise karu', 'invite-team'],
  ])('"%s" → %s', (message, tourId) => {
    expect(matchTourIntent(message)).toBe(tourId);
  });

  it.each([
    'what is the pipelines page?',
    'why is my credit balance low',
    'hello',
    'tell me a joke',
    'How do I share a freshly added property?',
    'Send a new property to the audience of an existing property',
    'How do I edit a new property?',
    'How do I share a property listing?',
    'I need to send Property details of a freshly added property to audience of an existing property. How can I do it?',
    '',
  ])('ambiguous or unrelated "%s" → null', (message) => {
    expect(matchTourIntent(message)).toBeNull();
  });

  it('[CPL-006] starts the daily-work tours without a model call', () => {
    expect(matchTourIntent('How do I use the inbox?')).toBe('use-inbox');
    expect(matchTourIntent('How to track the deals?')).toBe('track-deals');
    expect(matchTourIntent('schedule a site visit')).toBe('schedule-visit');
    expect(matchTourIntent('how do I invite a teammate?')).toBe('invite-team');
    expect(matchTourIntent('what is the pipelines page?')).toBeNull();
  });

  it('ignores oversized messages', () => {
    expect(matchTourIntent('add contact '.repeat(60))).toBeNull();
  });
});
