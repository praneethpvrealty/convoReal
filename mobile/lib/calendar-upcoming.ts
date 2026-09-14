export interface UpcomingAppointmentLike {
  id: string;
  start_time: string;
  status: 'scheduled' | 'completed' | 'cancelled';
}

export interface UpcomingTodoLike {
  id: string;
  due_date: string | null;
  completed: boolean;
}

export type UpcomingCalendarItem<
  A extends UpcomingAppointmentLike,
  T extends UpcomingTodoLike,
> =
  | { kind: 'appointment'; dueAt: number; appointment: A }
  | { kind: 'todo'; dueAt: number; todo: T };

export async function loadEveryPage<T>(
  loadPage: (from: number, to: number) => Promise<T[]>,
  pageSize = 500
): Promise<T[]> {
  const rows: T[] = [];

  for (let from = 0; ; from += pageSize) {
    const page = await loadPage(from, from + pageSize - 1);
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function buildUpcomingCalendarItems<
  A extends UpcomingAppointmentLike,
  T extends UpcomingTodoLike,
>(
  appointments: A[],
  todos: T[],
  now: Date,
  selected: Date
): UpcomingCalendarItem<A, T>[] {
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  const threshold = tomorrow.getTime();
  const selectedKey = localDayKey(selected);

  const appointmentItems: UpcomingCalendarItem<A, T>[] = appointments
    .filter((appointment) => appointment.status === 'scheduled')
    .map((appointment) => ({
      kind: 'appointment' as const,
      dueAt: new Date(appointment.start_time).getTime(),
      appointment,
    }))
    .filter(
      (item) =>
        Number.isFinite(item.dueAt) &&
        item.dueAt >= threshold &&
        localDayKey(new Date(item.dueAt)) !== selectedKey
    );

  const todoItems: UpcomingCalendarItem<A, T>[] = todos
    .filter((todo) => !todo.completed && todo.due_date)
    .map((todo) => ({
      kind: 'todo' as const,
      dueAt: new Date(todo.due_date!).getTime(),
      todo,
    }))
    .filter(
      (item) =>
        Number.isFinite(item.dueAt) &&
        item.dueAt >= threshold &&
        localDayKey(new Date(item.dueAt)) !== selectedKey
    );

  return [...appointmentItems, ...todoItems].sort((a, b) => a.dueAt - b.dueAt);
}
