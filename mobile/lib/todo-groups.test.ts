import { describe, expect, it } from 'vitest';

import {
  CLEAR_COMPLETED_LABEL,
  clearCompletedPrompt,
  completedTodoIds,
  DONE_TODOS_LABEL,
  splitTodosByCompletion,
} from '@shared/lib/calendar/todo-groups';

const todos = [
  { id: 'a', completed: false },
  { id: 'b', completed: true },
  { id: 'c', completed: false },
  { id: 'd', completed: true },
  { id: 'e', completed: false },
];

describe('[CAL-009] done to-dos group on mobile', () => {
  it('splits open from done and keeps the given order within each group', () => {
    const { open, done } = splitTodosByCompletion(todos);
    expect(open.map((t) => t.id)).toEqual(['a', 'c', 'e']);
    expect(done.map((t) => t.id)).toEqual(['b', 'd']);
  });

  it('returns empty groups for an empty list', () => {
    expect(splitTodosByCompletion([])).toEqual({ open: [], done: [] });
  });

  it('clears only the done ids', () => {
    expect(completedTodoIds(todos)).toEqual(['b', 'd']);
    expect(completedTodoIds(todos.filter((t) => !t.completed))).toEqual([]);
  });

  it('uses the web labels and confirmation copy', () => {
    expect(DONE_TODOS_LABEL).toBe('Done');
    expect(CLEAR_COMPLETED_LABEL).toBe('Clear completed');
    expect(clearCompletedPrompt(1)).toContain('one done to-do');
    expect(clearCompletedPrompt(3)).toContain('all 3 done to-dos');
  });
});
