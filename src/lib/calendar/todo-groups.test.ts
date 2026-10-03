import { describe, expect, it } from 'vitest';

import {
  CLEAR_COMPLETED_LABEL,
  DONE_TODOS_LABEL,
  clearCompletedPrompt,
  completedTodoIds,
  splitTodosByCompletion,
} from './todo-groups';

const todo = (id: string, completed: boolean) => ({ id, completed });

describe('[CAL-009] the to-do list keeps finished work in its own group', () => {
  it('splits open and done to-dos without reordering either', () => {
    const { open, done } = splitTodosByCompletion([
      todo('a', false),
      todo('b', true),
      todo('c', false),
      todo('d', true),
    ]);
    expect(open.map((t) => t.id)).toEqual(['a', 'c']);
    expect(done.map((t) => t.id)).toEqual(['b', 'd']);
  });

  it('returns empty groups for an empty list', () => {
    expect(splitTodosByCompletion([])).toEqual({ open: [], done: [] });
  });

  it('clears only the done to-dos', () => {
    expect(
      completedTodoIds([todo('a', false), todo('b', true), todo('c', true)])
    ).toEqual(['b', 'c']);
    expect(completedTodoIds([todo('a', false)])).toEqual([]);
  });

  it('names the group and the action the same way on both surfaces', () => {
    expect(DONE_TODOS_LABEL).toBe('Done');
    expect(CLEAR_COMPLETED_LABEL).toBe('Clear completed');
    expect(clearCompletedPrompt(1)).toBe(
      'Delete the one done to-do? This cannot be undone.'
    );
    expect(clearCompletedPrompt(3)).toBe(
      'Delete all 3 done to-dos? This cannot be undone.'
    );
  });
});
