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

export interface UpcomingDealDateLike {
  dealId: string;
  milestoneId: string | null;
  kind: 'milestone' | 'payment' | 'expected_close';
  dueDate: string;
}

export type UpcomingCalendarItem<
  A extends UpcomingAppointmentLike,
  T extends UpcomingTodoLike,
  D extends UpcomingDealDateLike = UpcomingDealDateLike,
> =
  | { kind: 'appointment'; dueAt: number; appointment: A }
  | { kind: 'todo'; dueAt: number; todo: T }
  | { kind: 'deal'; dueAt: number; dealDate: D };

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

function dateOnlyLocalTime(dueDate: string): number {
  return new Date(
    Number(dueDate.slice(0, 4)),
    Number(dueDate.slice(5, 7)) - 1,
    Number(dueDate.slice(8, 10))
  ).getTime();
}

export function buildUpcomingCalendarItems<
  A extends UpcomingAppointmentLike,
  T extends UpcomingTodoLike,
  D extends UpcomingDealDateLike = UpcomingDealDateLike,
>(
  appointments: A[],
  todos: T[],
  now: Date,
  selected: Date,
  dealDates: D[] = []
): UpcomingCalendarItem<A, T, D>[] {
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  const threshold = tomorrow.getTime();
  const selectedKey = localDayKey(selected);

  const appointmentItems: UpcomingCalendarItem<A, T, D>[] = appointments
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

  const todoItems: UpcomingCalendarItem<A, T, D>[] = todos
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

  const dealItems: UpcomingCalendarItem<A, T, D>[] = dealDates
    .map((dealDate) => ({
      kind: 'deal' as const,
      dueAt: dateOnlyLocalTime(dealDate.dueDate),
      dealDate,
    }))
    .filter(
      (item) =>
        Number.isFinite(item.dueAt) &&
        item.dueAt >= threshold &&
        localDayKey(new Date(item.dueAt)) !== selectedKey
    );

  return [...appointmentItems, ...todoItems, ...dealItems].sort(
    (a, b) => a.dueAt - b.dueAt
  );
}
