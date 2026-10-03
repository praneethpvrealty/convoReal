import { describe, expect, it } from 'vitest';

import {
  gapConversationHref,
  gapPrimaryAction,
  type GapActionInput,
} from './gap-actions';

function gap(over: Partial<GapActionInput> = {}): GapActionInput {
  return {
    kind: 'unmatched_requirement',
    suggested_action: 'Run matching on this contact and share the shortlist.',
    contact_id: 'c1',
    conversation_id: 'conv1',
    contacts: { id: 'c1' },
    ...over,
  };
}

describe('gapConversationHref', () => {
  it('uses the inbox deep-link parameter', () => {
    expect(gapConversationHref('conv 1')).toBe('/inbox?c=conv%201');
  });
});

describe('gapPrimaryAction', () => {
  it('sends a nothing-sent gap to its conversation, labelled by the suggestion', () => {
    expect(gapPrimaryAction(gap())).toEqual({
      href: '/inbox?c=conv1',
      label: 'Run matching on this contact and share the shortlist.',
    });
  });

  it('sends a nothing-next gap to its conversation', () => {
    expect(
      gapPrimaryAction(
        gap({
          kind: 'untracked_conversation',
          suggested_action: 'Book a call or a site visit.',
        })
      )?.href
    ).toBe('/inbox?c=conv1');
  });

  it('falls back to the contact when there is no conversation', () => {
    expect(
      gapPrimaryAction(gap({ conversation_id: null, contact_id: null }))?.href
    ).toBe('/contacts?contactId=c1');
  });

  it('has no destination without a conversation or contact', () => {
    expect(
      gapPrimaryAction(
        gap({ conversation_id: null, contact_id: null, contacts: null })
      )
    ).toBeNull();
  });

  it('has no destination for a bot override or a missing suggestion', () => {
    expect(gapPrimaryAction(gap({ kind: 'bot_handoff' }))).toBeNull();
    expect(gapPrimaryAction(gap({ suggested_action: null }))).toBeNull();
    expect(gapPrimaryAction(gap({ suggested_action: '  ' }))).toBeNull();
  });
});
