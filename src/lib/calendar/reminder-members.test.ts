import { describe, expect, it } from 'vitest';

import { reminderMemberIds } from './reminder-members';

describe('[CAL-019] reminderMemberIds', () => {
  it('reminds the creator of an unassigned event by default', () => {
    expect(
      reminderMemberIds({ user_id: 'creator', assigned_to: null })
    ).toEqual(['creator']);
  });

  it('reminds both the assignee and the creator', () => {
    expect(
      reminderMemberIds({
        user_id: 'creator',
        assigned_to: 'agent',
        remind_creator: true,
      })
    ).toEqual(['agent', 'creator']);
  });

  it('drops only the creator when they turned their reminders off', () => {
    expect(
      reminderMemberIds({
        user_id: 'creator',
        assigned_to: 'agent',
        remind_creator: false,
      })
    ).toEqual(['agent']);
    expect(
      reminderMemberIds({
        user_id: 'creator',
        assigned_to: null,
        remind_creator: false,
      })
    ).toEqual([]);
  });

  it('counts a creator assigned to their own event once', () => {
    expect(
      reminderMemberIds({ user_id: 'creator', assigned_to: 'creator' })
    ).toEqual(['creator']);
    expect(
      reminderMemberIds({
        user_id: 'creator',
        assigned_to: 'creator',
        remind_creator: false,
      })
    ).toEqual([]);
  });
});
