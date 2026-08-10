import { describe, expect, it } from 'vitest';

import {
  needsReply,
  needsReplyLabel,
  unanswered,
  unansweredLabel,
  waitingShort,
} from './reply-state';

const NOW = Date.parse('2026-08-08T12:00:00Z');
const HOUR = 60 * 60 * 1000;

function conv(overrides: Partial<Parameters<typeof needsReply>[0]> = {}) {
  return {
    status: 'open',
    awaiting_reply: true,
    last_customer_message_at: new Date(NOW - 3 * HOUR).toISOString(),
    is_archived: false,
    ...overrides,
  };
}

describe('needsReply', () => {
  it('flags an unanswered customer message with waiting time and window left', () => {
    const state = needsReply(conv(), NOW);
    expect(state).not.toBeNull();
    expect(state!.waitingMs).toBe(3 * HOUR);
    expect(state!.windowRemainingMs).toBe(21 * HOUR);
    expect(state!.windowExpired).toBe(false);
  });

  it('treats a chatbot hand-off (status pending) as needing a reply even after a bot answered', () => {
    const state = needsReply(
      conv({ awaiting_reply: false, status: 'pending' }),
      NOW
    );
    expect(state).not.toBeNull();
  });

  it('is null once the thread was answered', () => {
    expect(needsReply(conv({ awaiting_reply: false }), NOW)).toBeNull();
  });

  it('is null for closed and archived threads regardless of the flag', () => {
    expect(needsReply(conv({ status: 'closed' }), NOW)).toBeNull();
    expect(needsReply(conv({ is_archived: true }), NOW)).toBeNull();
  });

  it('marks the window expired past 24 hours', () => {
    const state = needsReply(
      conv({
        last_customer_message_at: new Date(NOW - 30 * HOUR).toISOString(),
      }),
      NOW
    );
    expect(state!.windowExpired).toBe(true);
    expect(state!.windowRemainingMs).toBe(0);
  });

  it('treats a lead with no customer timestamp as outside the window', () => {
    const state = needsReply(conv({ last_customer_message_at: null }), NOW);
    expect(state).toEqual({
      waitingMs: 0,
      windowRemainingMs: 0,
      windowExpired: true,
    });
  });
});

describe('waitingShort', () => {
  it('formats across the range', () => {
    expect(waitingShort(30 * 1000)).toBe('now');
    expect(waitingShort(5 * 60 * 1000)).toBe('5m');
    expect(waitingShort(3 * HOUR)).toBe('3h');
    expect(waitingShort(49 * HOUR)).toBe('2d');
  });
});

describe('needsReplyLabel', () => {
  it('shows waiting time inside the window and template-only outside it', () => {
    expect(needsReplyLabel(needsReply(conv(), NOW)!)).toBe('Needs reply · 3h');
    expect(
      needsReplyLabel(
        needsReply(
          conv({
            last_customer_message_at: new Date(NOW - 30 * HOUR).toISOString(),
          }),
          NOW
        )!
      )
    ).toBe('Needs reply · template only');
  });
});

/** A portal lead the bot answered: we spoke, they never did. */
function silent(overrides: Partial<Parameters<typeof unanswered>[0]> = {}) {
  return conv({
    awaiting_reply: false,
    last_customer_message_at: null,
    last_message_at: new Date(NOW - 6 * HOUR).toISOString(),
    ...overrides,
  });
}

describe('unanswered', () => {
  it('flags a lead the bot answered and who never wrote back', () => {
    expect(unanswered(silent(), NOW)).toEqual({ silentMs: 6 * HOUR });
  });

  it('never overlaps needsReply — the two states are exclusive', () => {
    const waiting = conv();
    expect(needsReply(waiting, NOW)).not.toBeNull();
    expect(unanswered(waiting, NOW)).toBeNull();

    const ignored = silent();
    expect(needsReply(ignored, NOW)).toBeNull();
    expect(unanswered(ignored, NOW)).not.toBeNull();
  });

  it('is null once the contact has written even once', () => {
    expect(
      unanswered(
        silent({
          last_customer_message_at: new Date(NOW - 40 * HOUR).toISOString(),
        }),
        NOW
      )
    ).toBeNull();
  });

  it('holds off during the grace period so a fresh send is not called ignored', () => {
    expect(
      unanswered(
        silent({
          last_message_at: new Date(NOW - 5 * 60 * 1000).toISOString(),
        }),
        NOW
      )
    ).toBeNull();
  });

  it('is null for closed, archived, and never-messaged threads', () => {
    expect(unanswered(silent({ status: 'closed' }), NOW)).toBeNull();
    expect(unanswered(silent({ is_archived: true }), NOW)).toBeNull();
    expect(unanswered(silent({ last_message_at: null }), NOW)).toBeNull();
  });
});

describe('unansweredLabel', () => {
  it('reads as silence on their side, not a task on ours', () => {
    expect(unansweredLabel(unanswered(silent(), NOW)!)).toBe('Unanswered · 6h');
    expect(
      unansweredLabel(
        unanswered(
          silent({ last_message_at: new Date(NOW - 50 * HOUR).toISOString() }),
          NOW
        )!
      )
    ).toBe('Unanswered · 2d');
  });
});
