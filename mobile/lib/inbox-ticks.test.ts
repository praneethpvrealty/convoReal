import { describe, expect, it } from 'vitest';

import {
  lastMsgStatusInvalidationKey,
  lastMsgStatusKey,
  outgoingTickStatus,
} from './inbox-ticks';

/** How React Query decides an invalidation hits a cached query. */
function matchesByPrefix(
  invalidation: readonly unknown[],
  queryKey: readonly unknown[]
): boolean {
  return invalidation.every((part, i) => part === queryKey[i]);
}

describe('lastMsgStatusInvalidationKey', () => {
  // The regression: ticks stayed on a single grey tick in the inbox while
  // the thread showed the same message as read. A status webhook moves
  // messages.status and leaves conversations.last_message_at alone, so an
  // invalidation carrying the timestamp never matched the row holding the
  // stale status.
  it('matches a row whose cached key still holds the old timestamp', () => {
    const cached = lastMsgStatusKey('conv-1', '2026-08-07T09:07:00Z');
    expect(matchesByPrefix(lastMsgStatusInvalidationKey('conv-1'), cached)).toBe(
      true
    );
  });

  it('still matches after the row refreshes and the timestamp moves on', () => {
    const cached = lastMsgStatusKey('conv-1', '2026-08-07T11:30:00Z');
    expect(matchesByPrefix(lastMsgStatusInvalidationKey('conv-1'), cached)).toBe(
      true
    );
  });

  it('leaves other conversations alone', () => {
    const cached = lastMsgStatusKey('conv-2', '2026-08-07T09:07:00Z');
    expect(matchesByPrefix(lastMsgStatusInvalidationKey('conv-1'), cached)).toBe(
      false
    );
  });

  it('falls back to every row when the payload carries no conversation', () => {
    const cached = lastMsgStatusKey('conv-9', null);
    expect(matchesByPrefix(lastMsgStatusInvalidationKey(undefined), cached)).toBe(
      true
    );
  });
});

describe('outgoingTickStatus', () => {
  it('reports the status of a message we sent', () => {
    expect(outgoingTickStatus({ sender_type: 'agent', status: 'read' })).toBe(
      'read'
    );
    expect(outgoingTickStatus({ sender_type: 'bot', status: 'delivered' })).toBe(
      'delivered'
    );
  });

  it('shows nothing for an inbound message or an empty thread', () => {
    expect(
      outgoingTickStatus({ sender_type: 'customer', status: 'read' })
    ).toBeNull();
    expect(outgoingTickStatus(null)).toBeNull();
    expect(outgoingTickStatus(undefined)).toBeNull();
  });
});
