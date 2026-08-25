import { supabase } from '@/lib/supabase';

/**
 * Web parity: the calendar's To-Do task list. Todos are plain
 * RLS-scoped rows with no server-side side effects (unlike
 * appointments, whose reminders live behind the API), so reads and
 * writes go straight to the table like the web calendar's do.
 */

export type TodoPriority = 'low' | 'medium' | 'high';

export interface Todo {
  id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  priority: TodoPriority;
  completed: boolean;
  contact_id: string | null;
  property_id: string | null;
  contact: { id: string; name: string | null; phone: string | null } | null;
  property: { id: string; title: string } | null;
}

function one<T>(v: T | T[] | null | undefined): T | null {
  if (v === null || v === undefined) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

export async function fetchTodos(): Promise<Todo[]> {
  const { data, error } = await supabase
    .from('todos')
    .select(
      '*, contact:contacts(id, name, phone), property:properties(id, title)'
    )
    .order('created_at', { ascending: true })
    .limit(200);
  if (error) throw error;

  type Row = Omit<Todo, 'contact' | 'property'> & {
    contact: Todo['contact'] | Todo['contact'][] | null;
    property: Todo['property'] | Todo['property'][] | null;
  };

  return ((data ?? []) as unknown as Row[]).map((row) => ({
    ...row,
    contact: one(row.contact),
    property: one(row.property),
  }));
}

/** Same ordering as the web task panel: open tasks first, then by due date. */
export function sortTodos(todos: Todo[]): Todo[] {
  return [...todos].sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    const dateA = a.due_date ? new Date(a.due_date).getTime() : 0;
    const dateB = b.due_date ? new Date(b.due_date).getTime() : 0;
    return dateA - dateB;
  });
}

export async function addTodo(opts: {
  accountId: string;
  title: string;
  priority: TodoPriority;
  dueDate: Date | null;
}): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase.from('todos').insert({
    account_id: opts.accountId,
    user_id: user?.id,
    title: opts.title,
    priority: opts.priority,
    due_date: opts.dueDate ? opts.dueDate.toISOString() : null,
    completed: false,
  });
  if (error) throw error;
}

export async function setTodoCompleted(
  id: string,
  completed: boolean
): Promise<void> {
  const { data, error } = await supabase
    .from('todos')
    .update({ completed })
    .eq('id', id)
    .select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('Todo not found');
}

export async function updateTodo(
  id: string,
  updates: {
    title: string;
    description: string | null;
    dueDate: Date | null;
    priority: TodoPriority;
    completed: boolean;
  }
): Promise<void> {
  const { data, error } = await supabase
    .from('todos')
    .update({
      title: updates.title,
      description: updates.description,
      due_date: updates.dueDate ? updates.dueDate.toISOString() : null,
      priority: updates.priority,
      completed: updates.completed,
    })
    .eq('id', id)
    .select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('Todo not found');
}

export async function deleteTodo(id: string): Promise<void> {
  // Same guard as setTodoCompleted: a delete RLS refuses removes zero
  // rows and reports no error, so without reading the row back this
  // resolves as success and the caller re-renders the task it just told
  // the user was gone.
  const { data, error } = await supabase
    .from('todos')
    .delete()
    .eq('id', id)
    .select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('Todo not found');
}
