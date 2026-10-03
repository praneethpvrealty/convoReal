export type CalendarViewMode = 'month' | 'week' | 'team' | 'agenda';

export const CALENDAR_VIEW_MODES: CalendarViewMode[] = [
  'month',
  'week',
  'team',
  'agenda',
];

export const CALENDAR_VIEW_STORAGE_KEY = 'convoreal.calendar.view';

/** Below this many items in the month shown, a first visit opens the
 *  Agenda: a near-empty grid shows less per pixel than the list. */
export const SPARSE_MONTH_THRESHOLD = 5;

export function toCalendarView(value: unknown): CalendarViewMode | null {
  return CALENDAR_VIEW_MODES.find((mode) => mode === value) ?? null;
}

/** The view the calendar opens in: the one the user last chose on this
 *  browser, else Agenda for a sparse month and Month otherwise. */
export function resolveInitialView(
  stored: unknown,
  itemsThisMonth: number
): CalendarViewMode {
  return (
    toCalendarView(stored) ??
    (itemsThisMonth < SPARSE_MONTH_THRESHOLD ? 'agenda' : 'month')
  );
}
