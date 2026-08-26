import { describe, expect, it } from 'vitest';

import {
  buildTodoParticipantCheckIn,
  inferTodoCheckInKind,
} from '@/lib/todo-check-in';

describe('todo participant check-in', () => {
  it('recognises a visit from the task description and drafts a property-specific check-in', () => {
    expect(
      inferTodoCheckInKind(
        'Ramanathan — South East Corner Site',
        'Yet to visit'
      )
    ).toBe('site_visit');

    const draft = buildTodoParticipantCheckIn({
      title: 'Ramanathan — South East Corner Site',
      description: 'Yet to visit',
      contactName: 'Ramanathan',
      propertyTitle: '3115 sqft South East Corner Site in Vijayabank Layout',
    });

    expect(draft.label).toBe('visit');
    expect(draft.message).toContain('Hi Ramanathan');
    expect(draft.message).toContain('complete the site visit');
    expect(draft.message).toContain('3115 sqft South East Corner Site');
  });

  it.each([
    ['Call owner about pricing', null, 'call'],
    ['Meeting with buyer', null, 'meeting'],
    ['Check advocate', 'Status of legal documents', 'document'],
    ['Follow up with prospect', null, 'follow_up'],
  ] as const)('uses the relevant copy for %s', (title, description, expected) => {
    expect(inferTodoCheckInKind(title, description)).toBe(expected);
  });

  it('falls back to a neutral greeting when a contact name is unavailable', () => {
    const draft = buildTodoParticipantCheckIn({
      title: 'Follow up on requirement',
    });

    expect(draft.message).toContain('Hi there');
    expect(draft.message).toContain('planned follow-up');
  });
});
