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
  buildCandidateReply,
  buildClientCandidateButtons,
  buildPropertyCandidateButtons,
  buildPropertyCandidateReply,
  candidateButtonTitle,
  parseClientCandidateReplyId,
  parsePropertyCandidateReplyId,
  parsePropertyCandidateCancelId,
  buildPropertyCandidateCancelReply,
  buildRequirementLine,
  buildUnmatchedReply,
  followupDueDate,
  isJourneyCheckinText,
  parseClientFollowupReplyId,
  propertyLabel,
  resolveClientProperty,
} from './client-response';
import { buildCheckInMessage } from './checkin-message';
import { CLIENT_QUESTION_PROMPT } from './client-answer';
import {
  PROPERTY_QUESTION_FINGERPRINT,
  PROPERTY_QUESTION_PROMPT,
} from './property-answer';

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
      mentioned_terms: [],
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
      mentioned_terms: [],
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

describe('offering the contacts a forward points at', () => {
  const parsed = {
    client_name: null,
    client_phone: null,
    property_code: null,
    property_title: null,
    response_summary:
      'Cancelled the Lodha booking, wants 1 acre near the airport',
    next_action: null,
    timeline_hint: null,
    requirement: 'Residential land 1 acre, North Bangalore, 8-10cr',
    mentioned_terms: ['Lodha Sadhahalli'],
  };
  const candidates = [
    {
      contact: { id: 'c1', name: 'Natarajan', phone: null },
      score: 40,
      reason: 'mentions sadhahalli',
    },
    {
      contact: { id: 'c2', name: 'Suresh Kumar', phone: null },
      score: 20,
      reason: 'mentions domlur',
    },
  ];

  it('names each candidate with the reason it is offered', () => {
    const text = buildCandidateReply(parsed, candidates);
    expect(text).toContain('*Natarajan*');
    expect(text).toContain('mentions sadhahalli');
    expect(text).toContain('reply with a different name');
  });

  it('round-trips each button id back to its contact', () => {
    const buttons = buildClientCandidateButtons(candidates);
    expect(buttons).toEqual([
      { id: 'jcc_c1', title: 'Natarajan' },
      { id: 'jcc_c2', title: 'Suresh Kumar' },
    ]);
    for (const b of buttons) {
      expect(parseClientCandidateReplyId(b.id)).toBe(b.id.slice(4));
      expect(b.title.length).toBeLessThanOrEqual(20);
    }
  });

  it('never sends more than the three buttons WhatsApp allows', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({
      contact: {
        id: `c${i}`,
        name: `Contact number ${i}`,
        phone: null,
        haystack: '',
      },
      score: 10,
      reason: 'mentions domlur',
    }));
    expect(buildClientCandidateButtons(many)).toHaveLength(3);
  });

  it('keeps a long name inside the button limit', () => {
    const title = candidateButtonTitle('Venkataramana Subramanian Iyer');
    expect(title.length).toBeLessThanOrEqual(20);
    expect(title.startsWith('Venkataramana')).toBe(true);
  });

  it('ignores a button id that is not ours', () => {
    expect(parseClientCandidateReplyId('jfu_today:item-1')).toBeNull();
  });
});

describe('confirming the property before side effects', () => {
  const candidates = [
    {
      property: {
        id: 'p1',
        title: 'JP Nagar 100 Feet Road Commercial Building',
        property_code: 'PROP-101',
      },
      score: 220,
      reason: 'location jp, nagar · title 100',
    },
    {
      property: {
        id: 'p2',
        title: 'JP Nagar Commercial Land',
        property_code: 'PROP-102',
      },
      score: 120,
      reason: 'location jp, nagar',
    },
  ];

  it('offers ranked properties and round-trips the selected IDs', () => {
    const buttons = buildPropertyCandidateButtons('c1', candidates);
    expect(buttons).toEqual([
      { id: 'jpc_p1:c1', title: 'PROP-101' },
      { id: 'jpc_p2:c1', title: 'PROP-102' },
      { id: 'jpx_c1', title: 'Cancel' },
    ]);
    expect(parsePropertyCandidateReplyId(buttons[0].id)).toEqual({
      propertyId: 'p1',
      contactId: 'c1',
    });
    expect(parsePropertyCandidateReplyId('jfa_today:item')).toBeNull();
  });

  it('states that confirmation happens before events and owner messages', () => {
    const reply = buildPropertyCandidateReply('Yogendranath', candidates);
    expect(reply).toContain('JP Nagar 100 Feet Road');
    expect(reply).toContain(
      "I'll create the event, reminders or owner message only after you choose"
    );
  });

  it('[JRN-017] always leaves room for Cancel within the three WhatsApp buttons', () => {
    const three = [
      ...candidates,
      {
        property: {
          id: 'p3',
          title: 'Third listing',
          property_code: 'PROP-103',
        },
        score: 60,
        reason: 'title third',
      },
    ];
    const buttons = buildPropertyCandidateButtons('c1', three);
    expect(buttons).toHaveLength(3);
    expect(buttons[2]).toEqual({ id: 'jpx_c1', title: 'Cancel' });
    expect(parsePropertyCandidateCancelId(buttons[2].id)).toBe('c1');
    expect(parsePropertyCandidateCancelId('jpc_p1:c1')).toBeNull();
    expect(parsePropertyCandidateReplyId(buttons[2].id)).toBeNull();
    const reply = buildPropertyCandidateReply('Yogendranath', three);
    expect(reply).toContain('PROP-103');
  });

  it('[JRN-017] lets the agent type a property code that has no button', () => {
    const reply = buildPropertyCandidateReply('Yogendranath', candidates);
    expect(PROPERTY_QUESTION_FINGERPRINT.test(reply)).toBe(true);
    expect(reply).toMatch(/reply with its code \(e\.g\. PROP-1138\)/);
  });

  it('[JRN-017] says a cancel links nothing and keeps the note', () => {
    expect(buildPropertyCandidateCancelReply('Yogendranath')).toBe(
      "👍 Cancelled. Nothing was linked, and no event, reminder or owner message was created. Yogendranath's update stays in their contact notes."
    );
  });
});

describe('resolving the property a forwarded reply is about', () => {
  type Row = Record<string, unknown>;
  const inventory: Row[] = [
    {
      id: 'p-1403',
      title: '#19, 2400 Sqft Commercial Plot on 100 feet JP Nagar 4th Phase.',
      property_code: 'PROP-1403',
      owner_contact_id: 'c-yogi',
      sublocality: 'JP Nagar 4th Phase',
    },
    {
      id: 'p-1108',
      title:
        'Residential House in Koramangala 7th phase, opposite to the park is for sale.',
      property_code: 'PROP-1108',
      owner_contact_id: 'c-other',
      sublocality: 'Koramangala',
    },
    {
      id: 'p-1878',
      title:
        '300 Acres Residential Land with the plan approval on Harohalli to Bidadi Road',
      property_code: 'PROP-1878',
      owner_contact_id: null,
    },
  ];

  function fakeDb(rows: Row[]) {
    return {
      from() {
        const filters: [string, unknown][] = [];
        let cap = Infinity;
        const b: Record<string, unknown> = {
          select: () => b,
          eq: (col: string, val: unknown) => {
            filters.push([col, val]);
            return b;
          },
          ilike: () => b,
          limit: (n: number) => {
            cap = n;
            return b;
          },
          maybeSingle: async () => ({ data: null, error: null }),
          then: (resolve: (v: { data: Row[]; error: null }) => unknown) =>
            Promise.resolve({
              data: rows
                .filter((row) =>
                  filters.every(
                    ([col, val]) => col === 'account_id' || row[col] === val
                  )
                )
                .slice(0, cap),
              error: null,
            }).then(resolve),
        };
        return b;
      },
    };
  }

  const parsed = {
    response_summary:
      'Yogendranath to share the family tree application number by today evening.',
  } as Parameters<typeof resolveClientProperty>[2];

  it('[JRN-016] picks the one property the contact owns when the message names no other', async () => {
    const result = await resolveClientProperty(
      fakeDb(inventory) as never,
      'acc',
      parsed,
      {
        id: 'c-yogi',
        name: 'Yogendranath',
      }
    );
    expect(result.property?.id).toBe('p-1403');
    expect(result.candidates).toEqual([]);
  });

  it('[JRN-016] puts the owned property first when the message also points elsewhere', async () => {
    const result = await resolveClientProperty(
      fakeDb(inventory) as never,
      'acc',
      {
        response_summary: 'Yogendranath asked about the Koramangala house too',
      } as typeof parsed,
      { id: 'c-yogi', name: 'Yogendranath' }
    );
    expect(result.property).toBeNull();
    expect(result.candidates.map((c) => c.property.id)).toEqual([
      'p-1403',
      'p-1108',
    ]);
    expect(result.candidates[0].reason).toBe('owned by Yogendranath');
  });

  it('[JRN-016] offers rather than picks the owned property when the inventory scan was capped', async () => {
    const large: Row[] = [
      inventory[0],
      ...Array.from({ length: 600 }, (_, i) => ({
        id: `bulk-${i}`,
        title: `Bulk listing ${i}`,
        property_code: `PROP-${5000 + i}`,
        owner_contact_id: null,
      })),
    ];
    const result = await resolveClientProperty(
      fakeDb(large) as never,
      'acc',
      parsed,
      {
        id: 'c-yogi',
        name: 'Yogendranath',
      }
    );
    expect(result.property).toBeNull();
    expect(result.candidates.map((c) => c.property.id)).toEqual(['p-1403']);
  });

  it('[JRN-016] offers nothing for a contact who owns nothing and a message that names nothing', async () => {
    const result = await resolveClientProperty(
      fakeDb(inventory) as never,
      'acc',
      parsed,
      {
        id: 'c-nobody',
        name: 'Ravi',
      }
    );
    expect(result).toEqual({ property: null, candidates: [] });
  });
});
