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
  AGENT_FOLLOWUP_PREFIX,
  CLIENT_FOLLOWUP_PREFIX,
  buildAgentFollowupButtons,
  buildAgentReply,
  parseAgentFollowupReplyId,
  buildClientAskBody,
  buildClientFollowupButtons,
  buildRequirementLine,
  buildUnmatchedReply,
  followupDueDate,
  isJourneyCheckinText,
  parseClientFollowupReplyId,
  propertyLabel,
} from './client-response';
import { buildCheckInMessage } from './checkin-message';
import { CLIENT_QUESTION_PROMPT } from './client-answer';
import { PROPERTY_QUESTION_PROMPT } from './property-answer';

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

describe('agent follow-up buttons', () => {
  it('offers the same three choices under their own prefix', () => {
    expect(buildAgentFollowupButtons('item-1')).toEqual([
      { id: 'jfa_today:item-1', title: 'Today itself' },
      { id: 'jfa_2d:item-1', title: 'In 2 days' },
      { id: 'jfa_unsure:item-1', title: "Can't say yet" },
    ]);
  });

  // The two prefixes must not cross: an agent tap applies to someone
  // else's branch and skips the ownership check a client tap requires.
  it('never parses as a client tap, and vice versa', () => {
    for (const b of buildAgentFollowupButtons('item-2')) {
      expect(parseClientFollowupReplyId(b.id)).toBeNull();
      expect(parseAgentFollowupReplyId(b.id)?.itemId).toBe('item-2');
    }
    for (const b of buildClientFollowupButtons('item-3')) {
      expect(parseAgentFollowupReplyId(b.id)).toBeNull();
      expect(parseClientFollowupReplyId(b.id)?.itemId).toBe('item-3');
    }
    expect(AGENT_FOLLOWUP_PREFIX).not.toBe(CLIENT_FOLLOWUP_PREFIX);
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

  it('counts a template send as having asked them', () => {
    expect(buildAgentReply({ ...base, askOutcome: 'sent_template' })).toContain(
      'Asked Surya when to expect their update'
    );
  });

  // The agent's own reminder buttons ride on every outcome, so a
  // follow-up gets scheduled whether or not the client was reachable.
  it('always ends by offering the agent their own reminder', () => {
    for (const askOutcome of [
      'sent',
      'sent_template',
      'window_closed',
      'no_phone',
      'failed',
    ] as const) {
      expect(buildAgentReply({ ...base, askOutcome })).toContain(
        'When should I remind you to follow up?'
      );
    }
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
      requirement: null,
    });
    expect(reply).toContain("*Surya Bajaj* isn't in your book");
    expect(reply).toContain('"Will speak to the chairman"');
    expect(reply).toContain(CLIENT_QUESTION_PROMPT);
  });

  it('asks who the client is when the chat named nobody', () => {
    const reply = buildUnmatchedReply({
      client_name: null,
      client_phone: null,
      property_code: null,
      property_title: null,
      response_summary: 'Wants 1 acre near the airport, 8-10cr, direct only',
      next_action: null,
      timeline_hint: null,
      requirement: null,
    });
    expect(reply).toContain("couldn't work out who this client is");
    expect(reply).not.toContain('forward the chat again');
    expect(reply).toContain(CLIENT_QUESTION_PROMPT);
  });
});

describe('buildRequirementLine', () => {
  it('says where a stated requirement went', () => {
    const line = buildRequirementLine(
      'Natarajan',
      '1 acre residential land in North Bangalore near the airport, 8-10cr, direct purchase only'
    );
    expect(line).toContain("Natarajan's requirements");
    expect(line).toContain('direct purchase only');
    expect(line).toContain('Radar');
  });

  it('is silent when the reply stated no requirement', () => {
    expect(buildRequirementLine('Natarajan', null)).toBe('');
  });
});

describe('buildAgentReply with a captured requirement', () => {
  it('reports the requirement alongside what was logged', () => {
    const reply = buildAgentReply({
      contactName: 'Natarajan',
      propertyLabel: 'Sarjapur 3 acres (PROP-1138)',
      responseSummary: 'Cancelled the Lodha booking',
      stageName: 'Shared',
      dealsUpdated: 0,
      askOutcome: 'sent',
      capturedRequirement: 'Residential land 1 acre, North Bangalore, 8-10cr',
    });
    expect(reply).toContain('Residential land 1 acre');
  });

  it('omits the line when nothing was captured', () => {
    const reply = buildAgentReply({
      contactName: 'Natarajan',
      propertyLabel: 'Sarjapur 3 acres (PROP-1138)',
      responseSummary: 'Still thinking about it',
      stageName: 'Shared',
      dealsUpdated: 0,
      askOutcome: 'sent',
    });
    expect(reply).not.toContain('requirements');
  });
});

describe('a forwarded brief with no listing', () => {
  it('confirms the requirement instead of asking which property it is about', () => {
    const line = buildRequirementLine(
      'Natarajan',
      'Residential land 1 acre, North Bangalore near airport, 8-10cr, direct purchase only'
    );
    const text =
      "✅ *Logged Natarajan's requirement*" +
      line +
      '\n\n🔎 Open their contact to see what in your inventory fits.';
    expect(text).not.toContain(PROPERTY_QUESTION_PROMPT);
    expect(text).toContain('direct purchase only');
  });
});
