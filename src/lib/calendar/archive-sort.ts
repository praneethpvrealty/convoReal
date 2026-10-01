/**
 * The archive, sort and archived-view rules for calendar events
 * (CAL-011, CAL-012), shared at runtime by web and mobile. The mobile
 * app bundles this file through `@shared/`, so it must stay free of
 * imports — mobile/metro.config.js refuses any that are not relative,
 * and src/lib/mobile-parity.test.ts checks the same from the web side.
 */

export type AppointmentStatus = 'scheduled' | 'completed' | 'cancelled';

export interface ArchivableAppointmentLike {
  id: string;
  status: AppointmentStatus;
  archived_at?: string | null;
}

export const ARCHIVE_BATCH_LIMIT = 500;

export function canArchiveAppointment(status: AppointmentStatus): boolean {
  return status !== 'scheduled';
}

export function isArchivedAppointment(
  appointment: ArchivableAppointmentLike
): boolean {
  return !!appointment.archived_at && canArchiveAppointment(appointment.status);
}

export function archivableAppointmentIds(
  appointments: readonly ArchivableAppointmentLike[]
): string[] {
  return appointments
    .filter((a) => canArchiveAppointment(a.status) && !isArchivedAppointment(a))
    .map((a) => a.id);
}

export function chunkIds(
  ids: readonly string[],
  size: number = ARCHIVE_BATCH_LIMIT
): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += size)
    chunks.push(ids.slice(i, i + size));
  return chunks;
}

export function withoutArchivedAppointments<
  A extends ArchivableAppointmentLike,
>(
  appointments: readonly A[],
  showArchived: boolean
): { visible: A[]; archivedCount: number } {
  const archivedCount = appointments.filter(isArchivedAppointment).length;
  return {
    visible: showArchived
      ? [...appointments]
      : appointments.filter((a) => !isArchivedAppointment(a)),
    archivedCount,
  };
}

export type TaskSortMode = 'upcoming' | 'earliest' | 'latest';

export const TASK_SORT_MODES: TaskSortMode[] = [
  'upcoming',
  'earliest',
  'latest',
];

export const TASK_SORT_LABELS: Record<TaskSortMode, string> = {
  upcoming: 'Upcoming first',
  earliest: 'Earliest first',
  latest: 'Latest first',
};

function localDayStamp(at: number): number {
  const d = new Date(at);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function sortTasksByTime<T>(
  items: readonly T[],
  at: (item: T) => number,
  mode: TaskSortMode,
  now: Date,
  leads: (item: T) => boolean = () => false
): T[] {
  const today = localDayStamp(now.getTime());
  const rank = (t: number) => {
    const day = localDayStamp(t);
    return day === today ? 0 : day > today ? 1 : 2;
  };
  const inOrder = (a: T, b: T) =>
    at(a) - at(b) || (leads(a) === leads(b) ? 0 : leads(a) ? -1 : 1);
  return [...items].sort((a, b) => {
    if (mode === 'earliest') return inOrder(a, b);
    if (mode === 'latest') return inOrder(b, a);
    const ra = rank(at(a));
    const rb = rank(at(b));
    if (ra !== rb) return ra - rb;
    if (ra === 2) {
      const da = localDayStamp(at(a));
      const db = localDayStamp(at(b));
      if (da !== db) return db - da;
    }
    return inOrder(a, b);
  });
}

export type ArchivedView = 'greyed' | 'hidden' | 'listed';

export const ARCHIVED_VIEWS: ArchivedView[] = ['greyed', 'hidden', 'listed'];

export const ARCHIVED_VIEW_LABELS: Record<ArchivedView, string> = {
  greyed: 'Grey out archived',
  hidden: 'Hide archived',
  listed: 'List archived',
};

export function archivedOnCalendar(view: ArchivedView): boolean {
  return view !== 'hidden';
}

export function archivedInLists(view: ArchivedView): boolean {
  return view === 'listed';
}
