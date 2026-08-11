import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendInteractiveButtons: vi.fn(async () => ({ messageId: 'wamid.1' })),
}));
vi.mock('@/lib/whatsapp/meta-api-dispatcher', () => ({
  sendWhatsAppMessageAndPersist: vi.fn(async () => ({ success: true })),
}));
vi.mock('@/lib/notifications/create', () => ({
  createNotification: vi.fn(async () => ({
    inAppId: null,
    whatsapp: null,
    pushCount: 0,
  })),
}));

import {
  CLIENT_FOLLOWUP_PREFIX,
  buildAgentReply,
  buildClientAskBody,
  buildClientFollowupButtons,
  buildUnmatchedReply,
  followupDueDate,
  isJourneyCheckinText,
  parseClientFollowupReplyId,
  propertyLabel,
} from './client-response';
import { buildCheckInMessage } from './checkin-message';

describe('client follow-up buttons', () => {
  it('builds the three timeline choices against the journey item', () => {
    const buttons = buildClientFollowupButtons('item-1');
    expect(buttons).toEqual([
      { id: 'jfu_today:item-1', title: 'Today itself' },
      { id: 'jfu_2d:item-1', title: 'In 2 days' },
      { id: 'jfu_unsure:item-1', title: "Can't say yet" },
    ]);
  });

  it('keeps every title within the 20-character WhatsApp limit', () => {
    for (const b of buildClientFollowupButtons('x')) {
      expect(b.title.length).toBeLessThanOrEqual(20);
    }
  });

  it('round-trips each id back to its choice and item', () => {
    for (const b of buildClientFollowupButtons('item-9')) {
      const parsed = parseClientFollowupReplyId(b.id);
      expect(parsed?.itemId).toBe('item-9');
    }
    expect(parseClientFollowupReplyId('jfu_2d:abc')).toEqual({
      choice: '2d',
      itemId: 'abc',
    });
  });

  it('rejects foreign, malformed and truncated ids', () => {
    expect(parseClientFollowupReplyId('share_property_yes:p1')).toBeNull();
    expect(parseClientFollowupReplyId('jfu_today')).toBeNull();
    expect(parseClientFollowupReplyId('jfu_never:item-1')).toBeNull();
    expect(
      parseClientFollowupReplyId(`${CLIENT_FOLLOWUP_PREFIX}:item-1`)
    ).toBeNull();
  });
});

describe('followupDueDate', () => {
  const now = new Date('2026-08-11T09:00:00.000Z');

  it('is today for "Today itself" and +2 days for "In 2 days"', () => {
    expect(followupDueDate('today', now)?.toISOString()).toBe(
      '2026-08-11T09:00:00.000Z'
    );
    expect(followupDueDate('2d', now)?.toISOString()).toBe(
      '2026-08-13T09:00:00.000Z'
    );
  });

  it('has no date when the client cannot say', () => {
    expect(followupDueDate('unsure', now)).toBeNull();
  });
});

describe('propertyLabel', () => {
  it('combines title and code, falling back through each', () => {
    expect(
      propertyLabel({
        title: 'About 3 acres for an outright sale in Sarjapur',
        property_code: 'PROP-1138',
      })
    ).toBe('About 3 acres for an outright sale in Sarjapur (PROP-1138)');
    expect(propertyLabel({ title: 'Sunrise Villa', property_code: null })).toBe(
      'Sunrise Villa'
    );
    expect(propertyLabel({ title: null, property_code: 'PROP-7' })).toBe(
      'PROP-7'
    );
    expect(propertyLabel({ title: '  ', property_code: '' })).toBe(
      'the property'
    );
  });
});

describe('buildClientAskBody', () => {
  it('greets by first name, echoes the update and asks for a timeline', () => {
    const body = buildClientAskBody({
      contactName: 'Surya Bajaj',
      propertyLabel:
        'About 3 acres for an outright sale in Sarjapur (PROP-1138)',
      responseSummary: 'Will speak to the chairman in person and get back',
    });
    expect(body).toBe(
      'Hi Surya, noted your update on About 3 acres for an outright sale in Sarjapur (PROP-1138): ' +
        '"Will speak to the chairman in person and get back"\n\nWhen should we check back with you?'
    );
  });

  it('still reads well with no name and no summary', () => {
    const body = buildClientAskBody({
      contactName: null,
      propertyLabel: 'Sunrise Villa',
    });
    expect(body).toBe(
      'Hi, thanks for your update on Sunrise Villa.\n\nWhen should we check back with you?'
    );
  });
});

describe('buildAgentReply', () => {
  const base = {
    contactName: 'Surya Bajaj',
    propertyLabel: 'About 3 acres for an outright sale in Sarjapur (PROP-1138)',
    responseSummary: 'Will speak to the chairman in person and get back',
    stageName: 'Shared',
    dealsUpdated: 0,
    askOutcome: 'sent' as const,
  };

  it('states what was logged, where, and that the client was asked', () => {
    const reply = buildAgentReply(base);
    expect(reply).toContain(
      "✅ *Logged Surya Bajaj's response* on About 3 acres"
    );
    expect(reply).toContain('at *Shared*');
    expect(reply).toContain(
      '"Will speak to the chairman in person and get back"'
    );
    expect(reply).toContain('journey timeline and contact notes');
    expect(reply).toContain('Asked Surya when to expect their update');
  });

  it('mentions the pipeline deal only when one was updated', () => {
    expect(buildAgentReply(base)).not.toContain('pipeline deal');
    expect(buildAgentReply({ ...base, dealsUpdated: 1 })).toContain(
      'and the pipeline deal'
    );
  });

  it('explains a closed 24-hour window instead of claiming the ask went out', () => {
    const reply = buildAgentReply({ ...base, askOutcome: 'window_closed' });
    expect(reply).toContain('24-hour window is closed');
    expect(reply).not.toContain('Asked Surya when to expect');
  });
});

describe('isJourneyCheckinText', () => {
  it('recognizes the actual check-in builder output', () => {
    const msg = buildCheckInMessage({
      contactName: 'Surya Bajaj',
      propertyTitle: 'About 3 acres for an outright sale in Sarjapur',
      propertyCode: 'PROP-1138',
      stageName: 'Shared',
    });
    expect(isJourneyCheckinText(msg)).toBe(true);
  });

  it('ignores ordinary outbound messages', () => {
    expect(isJourneyCheckinText('Lawyer - Jayant pattanshet')).toBe(false);
    expect(isJourneyCheckinText('When should we check back with you?')).toBe(
      false
    );
    expect(isJourneyCheckinText(null)).toBe(false);
  });
});

describe('buildUnmatchedReply', () => {
  it('names who it could not match and quotes what was read', () => {
    const reply = buildUnmatchedReply({
      client_name: 'Surya Bajaj',
      client_phone: null,
      property_code: 'PROP-1138',
      property_title: null,
      response_summary: 'Will speak to the chairman',
      next_action: null,
      timeline_hint: null,
    });
    expect(reply).toContain("couldn't match *Surya Bajaj*");
    expect(reply).toContain('"Will speak to the chairman"');
    expect(reply).toContain('Save them as a contact first');
  });
});
