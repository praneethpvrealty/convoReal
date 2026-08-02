import { describe, it, expect } from 'vitest';
import {
  isOwnerHelpCommand,
  buildOwnerHelpMessage,
  buildOwnerFallbackMessage,
} from '@/lib/whatsapp/owner-help-template';

describe('isOwnerHelpCommand', () => {
  it('matches help words and greetings, case- and punctuation-insensitively', () => {
    for (const t of ['help', 'HELP', 'Help!', 'menu', 'commands', 'start', 'hi', 'Hello.', 'hey', 'namaste']) {
      expect(isOwnerHelpCommand(t)).toBe(true);
    }
  });

  it('ignores whitespace around the word', () => {
    expect(isOwnerHelpCommand('  help  ')).toBe(true);
  });

  it('does not match a message that merely contains a help word', () => {
    for (const t of [
      'help me price this plot',
      'hi Gaurav is looking for a 3BHK',
      'start the paperwork',
      '',
      null,
      undefined,
    ]) {
      expect(isOwnerHelpCommand(t)).toBe(false);
    }
  });
});

describe('buildOwnerHelpMessage', () => {
  const msg = buildOwnerHelpMessage();

  it('covers every capability the inbound handler actually has', () => {
    expect(msg).toContain('Add a listing');
    expect(msg).toContain('Add a contact or lead');
    expect(msg).toContain('Calendar & to-dos');
    expect(msg).toContain('Answer a lead');
    expect(msg).toContain('While a draft is open');
  });

  it('names the concrete commands, not just the categories', () => {
    expect(msg).toContain('*today*');
    expect(msg).toContain('Site visit with Varun tomorrow 4pm');
    expect(msg).toContain('Remind me to call Deepak on Friday');
    expect(msg).toContain('price is 1.8 Cr');
    expect(msg).toContain('15 minutes');
  });

  it('uses WhatsApp bold, never Markdown double asterisks', () => {
    expect(msg).not.toContain('**');
    expect(msg).toContain('*Confirm*');
    expect(msg).toContain('*Cancel*');
  });

  it('fits comfortably inside a single WhatsApp text message', () => {
    expect(msg.length).toBeLessThan(4096);
  });
});

describe('buildOwnerFallbackMessage', () => {
  const msg = buildOwnerFallbackMessage();

  it('says it did not understand and points at the three likely intents', () => {
    expect(msg).toContain("couldn't tell what that was");
    expect(msg).toContain('A property?');
    expect(msg).toContain('A lead?');
    expect(msg).toContain('Something to schedule?');
  });

  it('stays short and offers the full guide', () => {
    expect(msg).toContain('Send *help*');
    expect(msg.length).toBeLessThan(buildOwnerHelpMessage().length / 2);
  });

  it('uses WhatsApp bold, never Markdown double asterisks', () => {
    expect(msg).not.toContain('**');
  });
});
