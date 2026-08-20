import { describe, expect, it } from 'vitest';
import { renderTranscript, stampFor, worthAnalyzing } from './transcript';
import type { SweepMessage, SweepThread } from './types';

function msg(
  speaker: SweepMessage['speaker'],
  text: string,
  minute: number,
  contentType = 'text'
): SweepMessage {
  return {
    id: `m${minute}`,
    speaker,
    text,
    contentType,
    createdAt: new Date(Date.UTC(2026, 7, 19, 10, minute)).toISOString(),
  };
}

function thread(
  messages: SweepMessage[],
  over: Partial<SweepThread> = {}
): SweepThread {
  return {
    accountId: 'acc-1',
    channel: 'client',
    contactId: 'contact-1',
    contactName: 'Anju',
    conversationId: 'conv-1',
    assignedAgentId: null,
    propertyId: null,
    messages,
    ...over,
  };
}

describe('stampFor', () => {
  it('renders an IST day and time', () => {
    // 10:00 UTC on Wed 19 Aug 2026 is 15:30 IST the same day.
    expect(stampFor('2026-08-19T10:00:00.000Z')).toBe('Wed 15:30');
  });

  it('does not throw on an unparseable stamp', () => {
    expect(stampFor('not-a-date')).toBe('??');
  });
});

describe('renderTranscript', () => {
  it('labels each side and keeps oldest-first order', () => {
    const out = renderTranscript(
      thread([msg('customer', 'is it available?', 0), msg('agent', 'yes', 1)])
    );
    const lines = out.split('\n');
    expect(lines[0]).toContain('CLIENT: is it available?');
    expect(lines[1]).toContain('AGENT: yes');
  });

  it('keeps captionless media as a marker rather than dropping it', () => {
    // "Sent the floor plan" is answered by an image at 4:02pm — the
    // presence is the evidence even though there is no language in it.
    const out = renderTranscript(
      thread([
        msg('agent', 'sending the floor plan', 0),
        msg('agent', '', 1, 'document'),
      ])
    );
    expect(out).toContain('[sent document]');
  });

  it('spends its budget from the end, keeping the newest exchange', () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      msg(i % 2 ? 'agent' : 'customer', `line ${i} ${'x'.repeat(50)}`, i)
    );
    const out = renderTranscript(thread(many), 400);
    expect(out).toContain('line 39');
    expect(out).not.toContain('line 0 ');
  });
});

describe('worthAnalyzing', () => {
  it('refuses a thread with nothing said in it', () => {
    expect(
      worthAnalyzing(
        thread([msg('agent', '', 0, 'image'), msg('agent', '', 1, 'image')])
      )
    ).toBe(false);
  });

  it('refuses a single outbound template nobody answered', () => {
    expect(
      worthAnalyzing(thread([msg('agent', 'New listing in Hebbal', 0)]))
    ).toBe(false);
  });

  it('accepts a real back-and-forth', () => {
    expect(
      worthAnalyzing(
        thread([
          msg('customer', 'looking for a 3bhk', 0),
          msg('agent', 'which area?', 1),
          msg('customer', 'hebbal', 2),
        ])
      )
    ).toBe(true);
  });

  it('does not hold personal WhatsApp to a both-sides-spoke test', () => {
    // It reaches us outbound-only, so that is a test it could never pass.
    expect(
      worthAnalyzing(
        thread(
          [
            msg('agent', 'sending the plan', 0),
            msg('agent', 'call you at 4', 1),
          ],
          {
            channel: 'personal_whatsapp',
          }
        )
      )
    ).toBe(true);
  });
});

describe('outbound listing labelling', () => {
  it('marks a listing we sent so it cannot read as the buyer asking for it', () => {
    // The exact shape that gave a contact a 65 Cr budget, a 9 BHK
    // minimum and an 8,000 sq.ft floor on the first production run.
    const out = renderTranscript(
      thread([
        msg('customer', 'looking for something in south bangalore', 0),
        msg(
          'agent',
          'Property: 9 BHK Residential House | 80x100 Plot Details: ₹65 Cr · 8,000 Sq.Ft',
          1
        ),
      ])
    );
    expect(out).toContain("listing we sent — NOT the client's requirement");
    // The client's own line stays a plain CLIENT line.
    expect(out).toContain('CLIENT: looking for something in south bangalore');
    expect(out.split('\n')[0]).not.toContain('listing we sent');
  });

  it('leaves an ordinary agent reply unmarked', () => {
    const out = renderTranscript(
      thread([
        msg('customer', 'is it available?', 0),
        msg('agent', 'yes, when would you like to visit?', 1),
      ])
    );
    expect(out).not.toContain('listing we sent');
  });

  it('never marks a client line, however it reads', () => {
    // A buyer quoting specs back at us is still the buyer talking.
    const out = renderTranscript(
      thread([
        msg(
          'customer',
          'I need a 4 BHK around ₹3 Cr with 2,400 Sq.Ft carpet area please',
          0
        ),
        msg('customer', 'anything in that range?', 1),
      ])
    );
    expect(out).not.toContain('listing we sent');
  });
});
