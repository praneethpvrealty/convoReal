import { describe, expect, it } from 'vitest';
import {
  detectBotHandoff,
  detectGaps,
  detectMissingNextStep,
  detectNoDeal,
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

describe('detectMissingNextStep', () => {
  const worked = [
    msg('customer', 'looking for a 3bhk', 8),
    msg('agent', 'sure, which area?', 7),
    msg('customer', 'hebbal', 6),
    msg('agent', 'noted', 5),
  ];

  it('raises a worked thread with nothing scheduled', () => {
    expect(detectMissingNextStep(thread(worked), QUIET)?.kind).toBe(
      'missing_next_step'
    );
  });

  it('stays quiet when something is already on the calendar', () => {
    expect(
      detectMissingNextStep(thread(worked), {
        ...QUIET,
        hasFutureAppointment: true,
      })
    ).toBeNull();
    expect(
      detectMissingNextStep(thread(worked), { ...QUIET, hasOpenTodo: true })
    ).toBeNull();
  });

  it('does not treat a run of outbound blasts as a conversation', () => {
    expect(
      detectMissingNextStep(
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
});

describe('detectNoDeal', () => {
  const worked = [
    msg('customer', 'looking for a plot', 8),
    msg('agent', 'budget?', 7),
    msg('customer', '2 cr', 6),
    msg('agent', 'noted', 5),
  ];

  it('raises someone being worked with a stated requirement and no deal', () => {
    expect(
      detectNoDeal(thread(worked), { ...QUIET, hasStatedRequirement: true })
        ?.kind
    ).toBe('no_deal');
  });

  it('stays quiet once they are on a pipeline', () => {
    expect(
      detectNoDeal(thread(worked), {
        ...QUIET,
        hasStatedRequirement: true,
        hasOpenDeal: true,
      })
    ).toBeNull();
  });

  it('stays quiet when they have not said what they want', () => {
    expect(detectNoDeal(thread(worked), QUIET)).toBeNull();
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
