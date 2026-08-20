import { describe, expect, it } from 'vitest';
import {
  detectBotHandoff,
  detectGaps,
  detectUntrackedConversation,
  detectUnansweredQuestion,
  detectUnmatchedRequirement,
  looksLikeQuestion,
} from './detectors';
import type { SweepMessage, SweepThread, ThreadContext } from './types';

const WINDOW_END = new Date('2026-08-20T00:30:00.000Z');

const QUIET: ThreadContext = {
  hasOpenDeal: false,
  hasFutureAppointment: false,
  hasOpenTodo: false,
  repliedAfterWindow: false,
  hasStatedRequirement: false,
  hasSharedAnyProperty: false,
};

/** Hours before the window closes. */
function at(hoursBefore: number): string {
  return new Date(WINDOW_END.getTime() - hoursBefore * 3_600_000).toISOString();
}

function msg(
  speaker: SweepMessage['speaker'],
  text: string,
  hoursBefore: number
): SweepMessage {
  return {
    id: `m-${speaker}-${hoursBefore}`,
    speaker,
    text,
    contentType: 'text',
    createdAt: at(hoursBefore),
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
    assignedAgentId: 'agent-1',
    propertyId: null,
    messages,
    ...over,
  };
}

describe('looksLikeQuestion', () => {
  it('takes a question mark as sufficient', () => {
    expect(looksLikeQuestion('is it still available?')).toBe(true);
  });

  it('catches the mark-less phrasing this market actually types', () => {
    // The reason this is not a `?`-only test: WhatsApp Hindi-English
    // drops the mark constantly, and a missed question costs the answer.
    expect(looksLikeQuestion('price kitna hai')).toBe(true);
    expect(looksLikeQuestion('possession when')).toBe(true);
    expect(looksLikeQuestion('please send the floor plan')).toBe(true);
  });

  it('does not treat a statement as a question', () => {
    expect(looksLikeQuestion('ok thanks')).toBe(false);
    expect(looksLikeQuestion('')).toBe(false);
  });
});

describe('detectUnansweredQuestion', () => {
  it('raises a client question with no outbound message after it', () => {
    const gap = detectUnansweredQuestion(
      thread([
        msg('agent', 'Sharing the listing now', 10),
        msg('customer', 'what is the final price?', 9),
      ]),
      QUIET,
      WINDOW_END
    );
    expect(gap?.kind).toBe('unanswered_question');
    expect(gap?.evidence).toBe('what is the final price?');
  });

  it('escalates a question that sat overnight', () => {
    const overnight = detectUnansweredQuestion(
      thread([msg('customer', 'possession when?', 14)]),
      QUIET,
      WINDOW_END
    );
    const afternoon = detectUnansweredQuestion(
      thread([msg('customer', 'possession when?', 5)]),
      QUIET,
      WINDOW_END
    );
    expect(overnight?.severity).toBe('high');
    expect(afternoon?.severity).toBe('medium');
  });

  it('stays quiet while a thread is still in flight', () => {
    expect(
      detectUnansweredQuestion(
        thread([msg('customer', 'is it available?', 1)]),
        QUIET,
        WINDOW_END
      )
    ).toBeNull();
  });

  it('stays quiet when someone answered after the window closed', () => {
    expect(
      detectUnansweredQuestion(
        thread([msg('customer', 'what is the price?', 9)]),
        { ...QUIET, repliedAfterWindow: true },
        WINDOW_END
      )
    ).toBeNull();
  });

  it('looks past a trailing pleasantry to the real question', () => {
    // A last-message-only test would call this thread closed.
    const gap = detectUnansweredQuestion(
      thread([
        msg('agent', 'Here are the photos', 12),
        msg('customer', 'what is the final price?', 11),
        msg('customer', 'thanks', 10),
      ]),
      QUIET,
      WINDOW_END
    );
    expect(gap?.evidence).toBe('what is the final price?');
  });

  it('never raises against personal WhatsApp, which is outbound-only', () => {
    expect(
      detectUnansweredQuestion(
        thread([msg('customer', 'what is the price?', 9)], {
          channel: 'personal_whatsapp',
        }),
        QUIET,
        WINDOW_END
      )
    ).toBeNull();
  });
});

describe('detectUntrackedConversation', () => {
  const worked = [
    msg('customer', 'looking for a 3bhk', 8),
    msg('agent', 'sure, which area?', 7),
    msg('customer', 'hebbal', 6),
    msg('agent', 'noted', 5),
  ];

  it('raises one gap for a live thread nothing is carrying forward', () => {
    const gap = detectUntrackedConversation(thread(worked), QUIET);
    expect(gap?.kind).toBe('untracked_conversation');
  });

  it('stays quiet when something already holds the next action', () => {
    expect(
      detectUntrackedConversation(thread(worked), {
        ...QUIET,
        hasFutureAppointment: true,
      })
    ).toBeNull();
    expect(
      detectUntrackedConversation(thread(worked), {
        ...QUIET,
        hasOpenTodo: true,
      })
    ).toBeNull();
  });

  it('calls out the exposed case: stated requirement, no pipeline, nothing booked', () => {
    const gap = detectUntrackedConversation(thread(worked), {
      ...QUIET,
      hasStatedRequirement: true,
    });
    expect(gap?.severity).toBe('medium');
    expect(gap?.summary).toContain('on no pipeline');
    expect(gap?.suggestedAction).toContain('pipeline');
  });

  it('says something different when a deal is already open', () => {
    const gap = detectUntrackedConversation(thread(worked), {
      ...QUIET,
      hasOpenDeal: true,
    });
    expect(gap?.severity).toBe('medium');
    expect(gap?.summary).toContain('open deal');
    expect(gap?.summary).not.toContain('no pipeline');
  });

  it('is only low when there is nothing much at stake', () => {
    const gap = detectUntrackedConversation(thread(worked), QUIET);
    expect(gap?.severity).toBe('low');
  });

  it('does not treat a run of outbound blasts as a conversation', () => {
    expect(
      detectUntrackedConversation(
        thread([
          msg('agent', 'new listing 1', 8),
          msg('agent', 'new listing 2', 7),
          msg('agent', 'new listing 3', 6),
          msg('agent', 'new listing 4', 5),
        ]),
        QUIET
      )
    ).toBeNull();
  });

  it('leaves alone a contact with no deal but a visit booked', () => {
    // The deliberate behaviour change: the old no_deal flagged this,
    // because it only looked at pipelines. A booked visit is somebody
    // carrying the thread forward.
    expect(
      detectUntrackedConversation(thread(worked), {
        ...QUIET,
        hasStatedRequirement: true,
        hasFutureAppointment: true,
      })
    ).toBeNull();
  });
});

describe('detectBotHandoff', () => {
  it('reads an agent overriding the bot within the window as a takeover', () => {
    const gap = detectBotHandoff(
      thread([
        msg('customer', 'price?', 6),
        msg('bot', 'I can help you with that', 5.9),
        msg('agent', 'It is 4.4 Cr, negotiable', 5.8),
      ])
    );
    expect(gap?.kind).toBe('bot_handoff');
  });

  it('does not read a much later agent message as a takeover', () => {
    expect(
      detectBotHandoff(
        thread([
          msg('bot', 'I can help you with that', 6),
          msg('agent', 'following up', 2),
        ])
      )
    ).toBeNull();
  });
});

describe('detectUnmatchedRequirement', () => {
  const stated: ThreadContext = { ...QUIET, hasStatedRequirement: true };

  it('raises a stated requirement that has never been matched', () => {
    const gap = detectUnmatchedRequirement(
      thread([msg('customer', 'need a 3bhk in hebbal', 6)]),
      stated
    );
    expect(gap?.kind).toBe('unmatched_requirement');
    expect(gap?.severity).toBe('high');
  });

  it('stays quiet once anything has been shared', () => {
    expect(
      detectUnmatchedRequirement(thread([msg('customer', 'need a 3bhk', 6)]), {
        ...stated,
        hasSharedAnyProperty: true,
      })
    ).toBeNull();
  });
});

describe('detectGaps', () => {
  it('sorts worst first and caps a neglected thread at three', () => {
    // This thread trips every free detector at once; five lines about
    // one contact is how a digest stops being read.
    const gaps = detectGaps(
      thread([
        msg('customer', 'need a 3bhk in hebbal', 20),
        msg('bot', 'let me check', 19.9),
        msg('agent', 'checking now', 19.8),
        msg('customer', 'what is the price?', 18),
      ]),
      { ...QUIET, hasStatedRequirement: true },
      WINDOW_END
    );

    expect(gaps.length).toBe(3);
    expect(gaps[0].severity).toBe('high');
    expect(gaps.map((g) => g.severity)).toEqual(['high', 'high', 'medium']);
  });

  it('reports nothing about a healthy thread', () => {
    const gaps = detectGaps(
      thread([
        msg('customer', 'is it available?', 8),
        msg('agent', 'yes, sending details', 7.9),
        msg('customer', 'thanks', 7.8),
      ]),
      { ...QUIET, hasOpenDeal: true, hasFutureAppointment: true },
      WINDOW_END
    );
    expect(gaps).toEqual([]);
  });
});

describe('evidence provenance', () => {
  // The first production run evidenced "X has been sent nothing" with
  // our OWN property-update digest — a quote that says nothing about the
  // client and argues against the gap.
  const outboundLast = [
    msg('customer', 'looking for a 3bhk in hebbal', 8),
    msg(
      'agent',
      '📊 Your Property Update — here is the latest buyer activity',
      2
    ),
  ];

  it('quotes the client, not our own outbound blast', () => {
    const gap = detectUnmatchedRequirement(thread(outboundLast), {
      ...QUIET,
      hasStatedRequirement: true,
    });
    expect(gap?.evidence).toBe('looking for a 3bhk in hebbal');
  });

  it('quotes the client for the untracked gap too', () => {
    const gap = detectUntrackedConversation(
      thread([
        msg('customer', 'budget is around 2 cr', 8),
        msg('agent', 'sure', 7),
        msg('customer', 'send me options in hebbal', 6),
        msg('agent', '📊 Your Property Update — latest buyer activity', 2),
      ]),
      { ...QUIET, hasStatedRequirement: true }
    );
    expect(gap?.evidence).toBe('send me options in hebbal');
  });

  it('falls back to our own line when the client has said nothing', () => {
    // Outbound-only threads still deserve evidence rather than silence.
    const gap = detectUntrackedConversation(
      thread(
        [
          msg('agent', 'sending the plan over', 8),
          msg('agent', 'call you at 4', 7),
          msg('agent', 'following up on this', 6),
          msg('agent', 'let me know your thoughts', 5),
        ],
        { channel: 'personal_whatsapp' }
      ),
      QUIET
    );
    expect(gap?.evidence).toBe('let me know your thoughts');
  });
});
