import { describe, expect, it } from 'vitest';

import { hasUnsavedChanges, todoEditDraft } from '@/lib/unsaved-changes';

const todo = {
  title: 'Call the owner',
  description: null,
  priority: 'medium' as const,
  completed: false,
  due_date: '2026-11-02T09:00:00+05:30',
};

describe('[UIX-010] unsaved changes', () => {
  it('reads an untouched draft as saved', () => {
    expect(hasUnsavedChanges(todoEditDraft(todo), todoEditDraft(todo))).toBe(
      false
    );
  });

  it('ignores whitespace-only edits', () => {
    expect(
      hasUnsavedChanges(todoEditDraft(todo), {
        ...todoEditDraft(todo),
        title: '  Call the owner ',
      })
    ).toBe(false);
  });

  it('reads a changed field as unsaved', () => {
    expect(
      hasUnsavedChanges(todoEditDraft(todo), {
        ...todoEditDraft(todo),
        completed: true,
      })
    ).toBe(true);
    expect(
      hasUnsavedChanges(todoEditDraft(todo), {
        ...todoEditDraft(todo),
        due: null,
      })
    ).toBe(true);
  });

  it('compares lists by their members and order', () => {
    expect(hasUnsavedChanges({ ids: ['a', 'b'] }, { ids: ['a', 'b'] })).toBe(
      false
    );
    expect(hasUnsavedChanges({ ids: ['a'] }, { ids: ['a', 'b'] })).toBe(true);
  });

  it('copies the current to-do into the edit draft', () => {
    expect(todoEditDraft({ ...todo, completed: true })).toMatchObject({
      completed: true,
      description: '',
      due: new Date('2026-11-02T09:00:00+05:30').toISOString(),
    });
  });
});
