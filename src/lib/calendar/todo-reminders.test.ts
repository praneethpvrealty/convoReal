import { describe, expect, it } from 'vitest';

import { buildTodoReminderContent } from './todo-reminders';

describe('buildTodoReminderContent', () => {
  it('builds a practical reminder without pretending to send the task to the contact', () => {
    const content = buildTodoReminderContent({
      id: 'todo-1',
      account_id: 'account-1',
      user_id: 'user-1',
      assigned_to: null,
      title: 'Share Suryanagar site schedule copy with Kishan Mittal',
      description: null,
      due_date: '2026-08-17T15:00:00.000Z',
      priority: 'medium',
      contact: { name: 'Kishan Mittal', phone: '+919900001111' },
      property: null,
    });

    expect(content.title).toBe('Task due at Mon, 8:30 pm');
    expect(content.whatsappText).toContain('Task due now');
    expect(content.whatsappText).toContain('Kishan Mittal');
    expect(content.whatsappText).toContain('Open ConvoReal');
    expect(content.whatsappText).not.toContain('message sent');
  });

  it('includes linked property, notes and high priority context', () => {
    const content = buildTodoReminderContent({
      id: 'todo-2',
      account_id: 'account-1',
      user_id: 'user-1',
      assigned_to: 'user-2',
      title: 'Review schedule copy',
      description: 'Confirm survey number before sharing',
      due_date: '2026-08-17T15:00:00.000Z',
      priority: 'high',
      contact: null,
      property: { title: 'Suryanagar Site' },
    });

    expect(content.body).toContain('Suryanagar Site');
    expect(content.body).toContain('Confirm survey number');
    expect(content.body).toContain('High priority');
  });
});
