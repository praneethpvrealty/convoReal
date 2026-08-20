import { describe, expect, it } from 'vitest';
import { gapDedupeKey } from './gaps';

describe('gapDedupeKey', () => {
  it('keys on the conversation when there is one', () => {
    expect(
      gapDedupeKey('unanswered_question', {
        conversationId: 'conv-1',
        contactId: 'contact-1',
      })
    ).toBe('unanswered_question:conv-1');
  });

  it('falls back to the contact, so personal WhatsApp still dedupes', () => {
    // Personal-WhatsApp threads have no conversation row; without this
    // they would dedupe per run instead of per person.
    expect(
      gapDedupeKey('unkept_promise', {
        conversationId: null,
        contactId: 'contact-1',
      })
    ).toBe('unkept_promise:contact-1');
  });

  it('is stable across runs for the same situation', () => {
    // The key is what stops an unanswered question being re-raised as a
    // new row every morning until someone deals with it.
    const monday = gapDedupeKey('unanswered_question', {
      conversationId: 'conv-1',
    });
    const tuesday = gapDedupeKey('unanswered_question', {
      conversationId: 'conv-1',
    });
    expect(monday).toBe(tuesday);
  });

  it('separates different kinds on the same thread', () => {
    expect(
      gapDedupeKey('unanswered_question', { conversationId: 'conv-1' })
    ).not.toBe(gapDedupeKey('unkept_promise', { conversationId: 'conv-1' }));
  });

  it('refuses a gap with no stable subject', () => {
    // A random key could never match again, so the caller drops it
    // rather than raising the same thing every morning forever.
    expect(
      gapDedupeKey('untracked_conversation', {
        conversationId: null,
        contactId: null,
      })
    ).toBeNull();
  });
});
