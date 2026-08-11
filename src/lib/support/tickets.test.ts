import { describe, expect, it } from 'vitest';
import {
  buildTicketReplyEmail,
  buildTicketReplyText,
  generateTicketReference,
  isTicketChannel,
  isTicketStatus,
} from './tickets';

describe('support ticket helpers', () => {
  it('generates speakable HELP- references', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateTicketReference()).toMatch(
        /^HELP-[23456789BCDFGHJKMNPQRSTVWXYZ]{4}$/
      );
    }
  });

  it('validates statuses and channels', () => {
    expect(isTicketStatus('open')).toBe(true);
    expect(isTicketStatus('answered')).toBe(true);
    expect(isTicketStatus('resolved')).toBe(false);
    expect(isTicketChannel('whatsapp')).toBe(true);
    expect(isTicketChannel('email')).toBe(true);
    expect(isTicketChannel('sms')).toBe(false);
  });

  it('carries reference, question and answer into both reply bodies', () => {
    const text = buildTicketReplyText('HELP-2345', 'Use the desktop app.');
    expect(text).toContain('HELP-2345');
    expect(text).toContain('Use the desktop app.');

    const email = buildTicketReplyEmail({
      reference: 'HELP-2345',
      question: 'How do I add <b>agents</b>?',
      answer: 'Go to Team > Invite.',
    });
    expect(email.subject).toContain('HELP-2345');
    expect(email.html).toContain('&lt;b&gt;agents&lt;/b&gt;');
    expect(email.text).toContain('Go to Team > Invite.');
  });
});
