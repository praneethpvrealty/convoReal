import { describe, it, expect } from 'vitest';
import {
  extractRelayText,
  isBridgeFresh,
  buildSentAck,
  buildWindowClosedAck,
  buildUnsupportedAck,
  buildFailureAck,
  buildLeadRelayText,
  BRIDGE_REPLY_HINT,
  BRIDGE_RELAY_WINDOW_MS,
} from '@/lib/whatsapp/reply-bridge';

describe('extractRelayText', () => {
  it('takes the body of a text message', () => {
    expect(
      extractRelayText({ type: 'text', text: { body: 'On my way' } }, 'On my way'),
    ).toEqual({ ok: true, text: 'On my way' });
  });

  it('trims surrounding whitespace', () => {
    expect(extractRelayText({ type: 'text', text: { body: '  hi  ' } }, null)).toEqual({
      ok: true,
      text: 'hi',
    });
  });

  it('falls back to the parsed content text', () => {
    expect(extractRelayText({ type: 'text' }, 'parsed body')).toEqual({
      ok: true,
      text: 'parsed body',
    });
  });

  it('rejects a text message with nothing in it', () => {
    expect(extractRelayText({ type: 'text', text: { body: '   ' } }, null)).toEqual({
      ok: false,
      reason: 'empty',
    });
  });

  it('rejects media, location and interactive replies', () => {
    for (const type of ['image', 'audio', 'video', 'document', 'location', 'interactive', 'button']) {
      expect(extractRelayText({ type }, 'caption')).toEqual({
        ok: false,
        reason: 'unsupported_type',
      });
    }
  });
});

describe('isBridgeFresh', () => {
  const now = new Date('2026-07-27T12:00:00Z').getTime();

  it('is false until the agent has answered from WhatsApp', () => {
    expect(isBridgeFresh(null, now)).toBe(false);
    expect(isBridgeFresh(undefined, now)).toBe(false);
  });

  it('is true just inside the relay window', () => {
    const at = new Date(now - BRIDGE_RELAY_WINDOW_MS + 60_000).toISOString();
    expect(isBridgeFresh(at, now)).toBe(true);
  });

  it('is false once the window has passed', () => {
    const at = new Date(now - BRIDGE_RELAY_WINDOW_MS - 1).toISOString();
    expect(isBridgeFresh(at, now)).toBe(false);
  });

  it('is false for an unparseable timestamp', () => {
    expect(isBridgeFresh('not-a-date', now)).toBe(false);
  });
});

describe('ack + relay copy', () => {
  it('confirms the send and invites another reply', () => {
    const ack = buildSentAck('Gaurav');
    expect(ack).toContain('Sent to Gaurav');
    expect(ack).toContain(BRIDGE_REPLY_HINT);
  });

  it('points a closed window at the inbox instead of inviting a reply', () => {
    const ack = buildWindowClosedAck('Gaurav', 'https://app.test/inbox?conversation=c1');
    expect(ack).toContain('24 hours');
    expect(ack).toContain('https://app.test/inbox?conversation=c1');
    expect(ack).not.toContain(BRIDGE_REPLY_HINT);
  });

  it('explains an unsupported reply without inviting another', () => {
    const media = buildUnsupportedAck('Gaurav', 'unsupported_type', 'https://app.test/inbox');
    expect(media).toContain('Only text replies');
    expect(media).not.toContain(BRIDGE_REPLY_HINT);
    expect(buildUnsupportedAck('Gaurav', 'empty', 'https://app.test/inbox')).toContain(
      'no text to send',
    );
  });

  it('surfaces the delivery error verbatim', () => {
    expect(buildFailureAck('Gaurav', 'Recipient not in allowed list')).toContain(
      'Recipient not in allowed list',
    );
  });

  it('names the lead and truncates a long relayed body', () => {
    const relay = buildLeadRelayText('Gaurav', 'x'.repeat(2000));
    expect(relay).toContain('*Gaurav* replied');
    expect(relay).toContain(BRIDGE_REPLY_HINT);
    expect(relay.length).toBeLessThan(1100);
  });
});
