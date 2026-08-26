export interface SortableTodo {
  id: string;
  completed: boolean;
  due_date: string | null;
}

/** Open tasks first; within each status, newest due date first. */
export function sortTodos<T extends SortableTodo>(todos: T[]): T[] {
  return [...todos].sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;

    if (a.due_date && !b.due_date) return -1;
    if (!a.due_date && b.due_date) return 1;
    if (!a.due_date && !b.due_date) return 0;

    const dateA = new Date(a.due_date!).getTime();
    const dateB = new Date(b.due_date!).getTime();
    return dateB - dateA;
  });
}
