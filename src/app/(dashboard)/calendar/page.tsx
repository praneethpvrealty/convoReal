'use client';

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  CheckCircle,
  Circle,
  X,
  CalendarDays,
  ListTodo,
  MessageSquare,
  Pencil,
  Briefcase,
  User,
  Home,
  ChevronDown,
  Users,
  LayoutGrid,
  Columns3,
  List,
  AudioLines,
  RefreshCcw,
  Archive,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { CalendarLoader } from '@/components/ui/calendar-loader';
import { ConvoRealLoader } from '@/components/ui/convoreal-loader';
import { DateTimePicker } from '@/components/ui/date-time-picker';
import { SearchableContactMultiSelect } from '@/components/ui/searchable-contact-multi-select';
import { SearchablePropertySelect } from '@/components/ui/searchable-property-select';
import {
  linkedContactForProperty,
  linkedPropertyForContacts,
} from '@/lib/calendar/auto-link';
import { InfoHint } from '@/components/ui/info-hint';
import { FavoriteButton } from '@/components/layout/favorite-button';
import {
  SmartAddBar,
  ConfirmedEventDraft,
} from '@/components/calendar/smart-add-bar';
import { TeamView } from '@/components/calendar/team-view';
import { WeekView } from '@/components/calendar/week-view';
import { AgendaView } from '@/components/calendar/agenda-view';
import { TasksList } from '@/components/calendar/tasks-list';
import {
  CalendarEvent,
  TeamMember,
  ARCHIVED_EVENT_CHIP,
  DEAL_DATE_META,
  EVENT_TYPES,
  EVENT_TYPE_KEYS,
  EventTypeKey,
  EventFieldKey,
  eventTypeFields,
  eventTypeMeta,
  memberInitials,
} from '@/components/calendar/event-types';
import { COPILOT_APPOINTMENT_COMPLETED_EVENT } from '@/lib/copilot/actions';
import {
  deadlineLabel,
  loadDealDeadlines,
  todayDateKey,
  type DealDeadline,
} from '@/lib/deals/deadlines';
import {
  DEAL_DATE_HORIZON_DAYS,
  DEAL_DATE_KIND_LABELS,
  dealDateHref,
  dealDatesForMember,
  dealDateKey,
  dealDateLocalDay,
  dealDatesInRange,
  localDateKey,
} from '@/lib/calendar/deal-dates';
import {
  ARCHIVED_VIEW_LABELS,
  ARCHIVED_VIEWS,
  archivableAppointmentIds,
  archivedInLists,
  archivedOnCalendar,
  buildCalendarTaskRows,
  chunkIds,
  isArchivedAppointment,
  sortTasksByTime,
  TASK_SORT_LABELS,
  TASK_SORT_MODES,
  withoutArchivedAppointments,
  type AppointmentStatus,
  toArchivedView,
  type ArchivedView,
  type TaskSortMode,
} from '@/lib/calendar/tasks-view';

const EMPTY_EXTRAS: Record<EventFieldKey, string> = {
  agenda: '',
  minutes: '',
  outcome: '',
};

function formatDateTimeLocal(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A lightweight to-do (CAL-009): title, notes, due, priority. The
 *  contact/property/deal links are read-only here — a deal task carries
 *  its deal from the workspace; the calendar never tags one. */
interface Todo {
  id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  priority: 'low' | 'medium' | 'high';
  completed: boolean;
  contact_id?: string | null;
  property_id?: string | null;
  deal_id?: string | null;
  contact?: {
    id: string;
    name: string;
    phone: string;
  } | null;
  property?: {
    id: string;
    title: string;
    location: string | null;
    sublocality: string | null;
  } | null;
}

interface SimpleContact {
  id: string;
  name: string;
  phone: string;
  last_inquired_property_id?: string | null;
  name_tag?: string | null;
}

interface SimpleProperty {
  id: string;
  title: string;
  property_code?: string | null;
  location: string | null;
  sublocality: string | null;
  tags?: string[] | null;
  price?: number | null;
  type?: string | null;
  bedrooms?: number | null;
  area_sqft?: number | null;
  area_unit?: string | null;
  images?: string[] | null;
}

type ViewMode = 'month' | 'week' | 'team' | 'agenda';

/** The event types plus the deal dates pinned alongside them (CAL-008). */
type CalendarTypeFilter = EventTypeKey | 'all' | 'deal';

export default function CalendarPage() {
  const router = useRouter();
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { accountId, user, isViewer, isReadOnly } = useAuth();
  const canEdit = !isViewer && !isReadOnly;

  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<ViewMode>('month');
  const [appointments, setAppointments] = useState<CalendarEvent[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [contacts, setContacts] = useState<SimpleContact[]>([]);
  const [properties, setProperties] = useState<SimpleProperty[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [typeFilter, setTypeFilter] = useState<CalendarTypeFilter>('all');
  const [memberFilter, setMemberFilter] = useState<string>('all');

  const searchParams = useSearchParams();
  const requestedEventId = searchParams.get('eventId');
  const openedEventIdRef = useRef<string | null>(null);
  const [todoFilter, setTodoFilter] = useState<'all' | 'priority'>('all');

  useEffect(() => {
    if (searchParams.get('filter') === 'priority') {
      setTodoFilter('priority');
    } else {
      setTodoFilter('all');
    }
  }, [searchParams]);

  // Modals state
  const [isApptModalOpen, setIsApptModalOpen] = useState(false);
  const [selectedAppt, setSelectedAppt] = useState<CalendarEvent | null>(null);

  // Appointment Form state
  const [apptTitle, setApptTitle] = useState('');
  const [apptDesc, setApptDesc] = useState('');
  const [apptContactIds, setApptContactIds] = useState<string[]>([]);
  const [apptPropertyId, setApptPropertyId] = useState('');
  const [apptStartTime, setApptStartTime] = useState('');
  const [apptEndTime, setApptEndTime] = useState('');
  const [apptLocation, setApptLocation] = useState('');
  const [apptStatus, setApptStatus] = useState<
    'scheduled' | 'completed' | 'cancelled'
  >('scheduled');
  const [apptEventType, setApptEventType] = useState<EventTypeKey>('meeting');
  const [apptAssignedTo, setApptAssignedTo] = useState('');
  const [apptNotificationScope, setApptNotificationScope] = useState<
    'none' | 'new' | 'all'
  >('new');
  // Type-specific structured notes (agenda / minutes / outcome).
  const [apptExtras, setApptExtras] = useState<Record<EventFieldKey, string>>({
    ...EMPTY_EXTRAS,
  });

  // Todo Form state
  const [todoTitle, setTodoTitle] = useState('');
  const [todoDesc, setTodoDesc] = useState('');
  const [todoDueDate, setTodoDueDate] = useState('');
  const [todoPriority, setTodoPriority] = useState<'low' | 'medium' | 'high'>(
    'medium'
  );

  // Tasks list under the calendar (CAL-010)
  const [tasksOpen, setTasksOpen] = useState(true);
  const archivedViewWrites = useRef<Promise<void>>(Promise.resolve());
  const archivedViewLatest = useRef(0);
  const archivedViewQuery = useQuery({
    queryKey: ['calendar-archived-view', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('calendar_archived_view')
        .eq('user_id', user!.id)
        .maybeSingle();
      if (error) throw error;
      return toArchivedView(data?.calendar_archived_view);
    },
  });
  const archivedView = archivedViewQuery.data ?? 'greyed';
  const [taskSort, setTaskSort] = useState<TaskSortMode>('upcoming');
  const [taskBusyKey, setTaskBusyKey] = useState<string | null>(null);

  // Todo Modal/Edit state
  const [isTodoModalOpen, setIsTodoModalOpen] = useState(false);
  const [selectedTodo, setSelectedTodo] = useState<Todo | null>(null);
  const [editTodoTitle, setEditTodoTitle] = useState('');
  const [editTodoDesc, setEditTodoDesc] = useState('');
  const [editTodoDueDate, setEditTodoDueDate] = useState('');
  const [editTodoPriority, setEditTodoPriority] = useState<
    'low' | 'medium' | 'high'
  >('medium');
  const [editTodoCompleted, setEditTodoCompleted] = useState(false);

  // Fetch appointments and todos
  const loadData = useCallback(async () => {
    try {
      setLoading(true);

      const { data: appts, error: apptError } = await supabase
        .from('appointments')
        .select(
          '*, contact:contacts(id, name, phone, name_tag), property:properties(id, title, location, sublocality)'
        )
        .eq('account_id', accountId)
        .order('start_time', { ascending: true });

      if (apptError) throw apptError;
      setAppointments((appts || []) as CalendarEvent[]);

      const { data: todoList, error: todoError } = await supabase
        .from('todos')
        .select(
          '*, contact:contacts(id, name, phone, name_tag), property:properties(id, title, location, sublocality)'
        )
        .eq('account_id', accountId)
        .order('created_at', { ascending: true });

      if (todoError) throw todoError;
      setTodos(todoList || []);

      const { data: contactsList } = await supabase
        .from('contacts')
        .select('id, name, phone, last_inquired_property_id, name_tag')
        .eq('account_id', accountId)
        .order('name');
      setContacts(contactsList || []);

      const { data: propsList } = await supabase
        .from('properties')
        .select(
          'id, title, property_code, location, sublocality, tags, price, type, bedrooms, area_sqft, area_unit, images'
        )
        .eq('account_id', accountId)
        .order('title');
      setProperties(propsList || []);
    } catch (err) {
      console.error('[CALENDAR PAGE] loadData caught error:', err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      toast.error(errorMessage || 'Failed to load calendar data');
    } finally {
      setLoading(false);
    }
  }, [accountId, supabase]);

  useEffect(() => {
    if (accountId) {
      loadData();
    }
  }, [accountId, loadData]);

  useEffect(() => {
    const syncCompletedAppointment = (event: Event) => {
      const appointmentId = (event as CustomEvent<{ appointmentId?: string }>)
        .detail?.appointmentId;
      if (!appointmentId) return;
      setAppointments((current) =>
        current.map((appointment) =>
          appointment.id === appointmentId
            ? { ...appointment, status: 'completed' }
            : appointment
        )
      );
      setSelectedAppt((current) =>
        current?.id === appointmentId
          ? { ...current, status: 'completed' }
          : current
      );
      setApptStatus((current) =>
        selectedAppt?.id === appointmentId ? 'completed' : current
      );
    };
    window.addEventListener(
      COPILOT_APPOINTMENT_COMPLETED_EVENT,
      syncCompletedAppointment
    );
    return () =>
      window.removeEventListener(
        COPILOT_APPOINTMENT_COMPLETED_EVENT,
        syncCompletedAppointment
      );
  }, [selectedAppt?.id]);

  // Team roster for lanes, assignee select, and initials badges.
  useEffect(() => {
    if (!accountId) return;
    fetch('/api/account/members')
      .then((res) => (res.ok ? res.json() : { members: [] }))
      .then((json) => {
        const rows = (json.members || []) as Array<{
          user_id: string;
          profile_id?: string;
          full_name: string;
          avatar_url: string | null;
          org_role?: string;
          team_id: string | null;
        }>;
        setMembers(
          rows.map((r) => ({ ...r, full_name: r.full_name || 'Member' }))
        );
      })
      .catch(() => setMembers([]));
  }, [accountId]);

  // Calendar math
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const monthNames = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];

  const firstDayIndex = new Date(year, month, 1).getDay(); // 0 = Sunday
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevDaysInMonth = new Date(year, month, 0).getDate();

  const calendarCells = useMemo(() => {
    const cells = [];

    for (let i = firstDayIndex - 1; i >= 0; i--) {
      cells.push({
        day: prevDaysInMonth - i,
        isCurrentMonth: false,
        date: new Date(year, month - 1, prevDaysInMonth - i),
      });
    }

    for (let i = 1; i <= daysInMonth; i++) {
      cells.push({
        day: i,
        isCurrentMonth: true,
        date: new Date(year, month, i),
      });
    }

    const remaining = 42 - cells.length; // 6 rows of 7 days = 42
    for (let i = 1; i <= remaining; i++) {
      cells.push({
        day: i,
        isCurrentMonth: false,
        date: new Date(year, month + 1, i),
      });
    }

    return cells;
  }, [year, month, firstDayIndex, daysInMonth, prevDaysInMonth]);

  // View-level filters applied to every calendar surface. The Team view
  // has no lane for a deal date, so the Deal dates filter does not apply
  // there and its chip is hidden rather than emptying every lane.
  const effectiveTypeFilter: CalendarTypeFilter =
    view === 'team' && typeFilter === 'deal' ? 'all' : typeFilter;
  const filteredAppointments = useMemo(() => {
    return appointments.filter((appt) => {
      if (effectiveTypeFilter === 'deal') return false;
      if (
        effectiveTypeFilter !== 'all' &&
        (appt.event_type || 'other') !== effectiveTypeFilter
      )
        return false;
      if (
        memberFilter !== 'all' &&
        (appt.assigned_to || appt.user_id) !== memberFilter
      )
        return false;
      return true;
    });
  }, [appointments, effectiveTypeFilter, memberFilter]);

  // The To-Do list holds to-dos alone (CAL-009); appointments and deal
  // dates are pinned on the calendar and listed in Tasks beneath it.
  const visibleTodos = useMemo(() => {
    const filtered =
      todoFilter === 'priority'
        ? todos.filter((t) => t.priority === 'high' || t.priority === 'medium')
        : todos;

    return [...filtered].sort((a, b) => {
      if (a.completed !== b.completed) {
        return a.completed ? 1 : -1;
      }
      const dateA = a.due_date ? new Date(a.due_date).getTime() : 0;
      const dateB = b.due_date ? new Date(b.due_date).getTime() : 0;
      return dateA - dateB;
    });
  }, [todos, todoFilter]);

  const calendarAppointments = useMemo(
    () =>
      withoutArchivedAppointments(
        filteredAppointments,
        archivedOnCalendar(archivedView)
      ),
    [filteredAppointments, archivedView]
  );
  const listedAppointments = useMemo(
    () =>
      withoutArchivedAppointments(
        filteredAppointments,
        archivedInLists(archivedView)
      ),
    [filteredAppointments, archivedView]
  );

  // Group appointments by date string
  const appointmentsByDate = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {};
    calendarAppointments.visible.forEach((appt) => {
      const dateStr = new Date(appt.start_time).toDateString();
      if (!map[dateStr]) map[dateStr] = [];
      map[dateStr].push(appt);
    });
    return map;
  }, [calendarAppointments]);

  // Deal dates (CAL-008): the milestone target dates, unpaid payment
  // tranches and expected close dates the deal_deadlines rule decides
  // are live (TXW-020), read once a year ahead and pinned on their day.
  // The calendar never writes one; each chip opens the deal record.
  const [todayKey, setTodayKey] = useState(() => todayDateKey());
  useEffect(() => {
    const rollDay = () => {
      const next = todayDateKey();
      if (next === todayKey) return;
      setTodayKey(next);
      if (localDateKey(currentDate) === todayKey) setCurrentDate(new Date());
    };
    const timer = setInterval(rollDay, 60_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') rollDay();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [todayKey, currentDate]);
  const visibleRange = useMemo(() => {
    if (view === 'week') {
      const start = new Date(currentDate);
      start.setDate(start.getDate() - start.getDay());
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      return { from: localDateKey(start), to: localDateKey(end) };
    }
    if (view === 'agenda') {
      return { from: '1900-01-01', to: '9999-12-31' };
    }
    return {
      from: localDateKey(calendarCells[0].date),
      to: localDateKey(calendarCells[calendarCells.length - 1].date),
    };
  }, [view, currentDate, calendarCells]);
  const dealDatesQuery = useQuery({
    queryKey: ['calendar-deal-dates', accountId, todayKey],
    queryFn: () =>
      loadDealDeadlines(supabase, accountId!, todayKey, DEAL_DATE_HORIZON_DAYS),
    enabled: !!accountId,
  });
  const showDealDates =
    view !== 'team' && (typeFilter === 'all' || typeFilter === 'deal');
  const visibleDealDates = useMemo(() => {
    if (!showDealDates) return [];
    const inRange = dealDatesInRange(
      dealDatesQuery.data ?? [],
      visibleRange.from,
      visibleRange.to
    );
    if (memberFilter === 'all') return inRange;
    const member = members.find((m) => m.user_id === memberFilter);
    return dealDatesForMember(inRange, {
      profileId: member?.profile_id ?? null,
      userId: memberFilter,
    });
  }, [showDealDates, dealDatesQuery.data, visibleRange, memberFilter, members]);
  const dealDatesByDate = useMemo(() => {
    const map: Record<string, DealDeadline[]> = {};
    for (const d of visibleDealDates) {
      const dateStr = dealDateLocalDay(d.dueDate).toDateString();
      if (!map[dateStr]) map[dateStr] = [];
      map[dateStr].push(d);
    }
    return map;
  }, [visibleDealDates]);

  // Tasks (CAL-010): every row pinned on the visible days, in date order.
  // The Agenda view's rows are the Tasks rows themselves, so it carries
  // no second list beneath it.
  const allTaskRows = useMemo(
    () =>
      view === 'month' || view === 'week'
        ? buildCalendarTaskRows(
            filteredAppointments,
            visibleDealDates,
            visibleRange.from,
            visibleRange.to
          )
        : [],
    [view, filteredAppointments, visibleDealDates, visibleRange]
  );
  const taskAppointmentsInView = useMemo(
    () =>
      allTaskRows.flatMap((row) =>
        row.kind === 'appointment' ? [row.appointment] : []
      ),
    [allTaskRows]
  );
  const archivableTaskIds = useMemo(
    () => archivableAppointmentIds(taskAppointmentsInView),
    [taskAppointmentsInView]
  );
  const taskRows = useMemo(
    () =>
      sortTasksByTime(
        archivedInLists(archivedView)
          ? allTaskRows
          : allTaskRows.filter(
              (row) =>
                row.kind !== 'appointment' ||
                !isArchivedAppointment(row.appointment)
            ),
        (row) => row.at,
        taskSort,
        new Date(),
        (row) => row.kind === 'deal'
      ),
    [allTaskRows, archivedView, taskSort]
  );

  const archiveAppointments = async (
    ids: string[],
    archived: boolean,
    busyKey: string
  ) => {
    if (ids.length === 0) return;
    setTaskBusyKey(busyKey);
    const changed = new Map<string, string | null>();
    try {
      for (const chunk of chunkIds(ids)) {
        const response = await fetch('/api/appointments/archive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: chunk, archived }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok)
          throw new Error(result.error || 'Failed to update the events');
        for (const id of (result.data?.ids ?? []) as string[])
          changed.set(id, result.data?.archived_at ?? null);
      }
      toast.success(
        archived
          ? changed.size === 1
            ? 'Archived'
            : `${changed.size} archived`
          : 'Unarchived — back in Tasks'
      );
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      toast.error(errorMessage || 'Failed to update the events');
    } finally {
      if (changed.size > 0) {
        setAppointments((current) =>
          current.map((item) =>
            changed.has(item.id)
              ? { ...item, archived_at: changed.get(item.id) ?? null }
              : item
          )
        );
      }
      setTaskBusyKey(null);
    }
  };
  const changeArchivedView = (view: ArchivedView) => {
    if (!user?.id) return;
    const key = ['calendar-archived-view', user.id];
    void queryClient.cancelQueries({ queryKey: key });
    queryClient.setQueryData(key, view);
    const write = ++archivedViewLatest.current;
    archivedViewWrites.current = archivedViewWrites.current.then(async () => {
      const { data, error } = await supabase
        .from('profiles')
        .update({ calendar_archived_view: view })
        .eq('user_id', key[1])
        .select('id');
      if (error || !data?.length)
        toast.error('Could not save the archived setting');
      if (write === archivedViewLatest.current)
        await queryClient.invalidateQueries({ queryKey: key });
    });
  };
  const archiveAppointment = (appt: CalendarEvent, archived: boolean) =>
    archiveAppointments([appt.id], archived, appt.id);

  const setAppointmentStatus = async (
    appt: CalendarEvent,
    status: AppointmentStatus
  ) => {
    setTaskBusyKey(appt.id);
    try {
      const response = await fetch(`/api/appointments/${appt.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(result.error || 'Failed to update the event');
      setAppointments((current) =>
        current.map((item) =>
          item.id === appt.id
            ? {
                ...item,
                status,
                ...(status === 'scheduled' ? { archived_at: null } : {}),
              }
            : item
        )
      );
      toast.success(
        status === 'completed'
          ? 'Marked done'
          : status === 'cancelled'
            ? 'Cancelled — it stays on its day, struck through'
            : 'Reopened'
      );
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      toast.error(errorMessage || 'Failed to update the event');
    } finally {
      setTaskBusyKey(null);
    }
  };

  const completeMilestone = async (d: DealDeadline) => {
    if (!d.milestoneId) return;
    const key = dealDateKey(d);
    setTaskBusyKey(key);
    try {
      const response = await fetch(
        `/api/deals/${d.dealId}/milestones/${d.milestoneId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'completed', source: 'web' }),
        }
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(result.error || 'Failed to update the milestone');
      await queryClient.invalidateQueries({
        queryKey: ['calendar-deal-dates'],
      });
      toast.success(`${d.title} marked done on the deal`);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      toast.error(errorMessage || 'Failed to update the milestone');
    } finally {
      setTaskBusyKey(null);
    }
  };

  // Date Nav handlers
  const handlePrev = () => {
    if (view === 'month') {
      setCurrentDate(new Date(year, month - 1, 1));
    } else {
      const d = new Date(currentDate);
      d.setDate(d.getDate() - 7);
      setCurrentDate(d);
    }
  };

  const handleNext = () => {
    if (view === 'month') {
      setCurrentDate(new Date(year, month + 1, 1));
    } else {
      const d = new Date(currentDate);
      d.setDate(d.getDate() + 7);
      setCurrentDate(d);
    }
  };

  const handleToday = () => {
    setCurrentDate(new Date());
  };

  // Appointment modal edit/create
  const openNewApptModal = (date?: Date, assignedTo?: string) => {
    setSelectedAppt(null);
    setApptTitle('');
    setApptDesc('');
    setApptContactIds([]);
    setApptPropertyId('');
    setApptLocation('');
    setApptStatus('scheduled');
    setApptEventType('meeting');
    setApptAssignedTo(assignedTo || user?.id || '');
    setApptNotificationScope('none');
    setApptExtras({ ...EMPTY_EXTRAS });

    const start = date ? new Date(date) : new Date();
    start.setHours(10, 0, 0, 0); // Default to 10:00 AM
    const end = new Date(start);
    end.setHours(11, 0, 0, 0); // Default 1 hour duration

    setApptStartTime(formatDateTimeLocal(start));
    setApptEndTime(formatDateTimeLocal(end));
    setIsApptModalOpen(true);
  };

  const openEditApptModal = useCallback((appt: CalendarEvent) => {
    setSelectedAppt(appt);
    setApptTitle(appt.title);
    setApptDesc(appt.description || '');
    setApptContactIds(
      appt.contact_ids && appt.contact_ids.length > 0
        ? appt.contact_ids
        : appt.contact_id
          ? [appt.contact_id]
          : []
    );
    setApptPropertyId(appt.property_id || '');
    setApptLocation(appt.location || '');
    setApptStatus(appt.status);
    setApptEventType(appt.event_type || 'meeting');
    setApptAssignedTo(appt.assigned_to || appt.user_id || '');
    setApptNotificationScope('new');
    setApptExtras({
      agenda: appt.agenda || '',
      minutes: appt.minutes || '',
      outcome: appt.outcome || '',
    });
    setApptStartTime(formatDateTimeLocal(new Date(appt.start_time)));
    setApptEndTime(formatDateTimeLocal(new Date(appt.end_time)));
    setIsApptModalOpen(true);
  }, []);

  useEffect(() => {
    if (!requestedEventId || openedEventIdRef.current === requestedEventId)
      return;
    const appointment = appointments.find(
      (item) => item.id === requestedEventId
    );
    if (!appointment) return;
    openedEventIdRef.current = requestedEventId;
    setCurrentDate(new Date(appointment.start_time));
    openEditApptModal(appointment);
  }, [appointments, openEditApptModal, requestedEventId]);

  const saveAppointment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apptTitle.trim()) {
      toast.error('Please enter a title');
      return;
    }

    try {
      const parseDateTimeString = (str: string): Date => {
        const parsed = new Date(str);
        if (!isNaN(parsed.getTime())) return parsed;
        try {
          const [datePart, timePart] = str.split('T');
          const [y, m, d] = datePart.split('-').map(Number);
          const [hours, minutes] = timePart.split(':').map(Number);
          return new Date(y, m - 1, d, hours, minutes);
        } catch {
          return new Date(str);
        }
      };

      const startDate = parseDateTimeString(apptStartTime);
      const endDate = parseDateTimeString(apptEndTime);

      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        throw new Error('Invalid start or end date selection.');
      }

      // Only persist the note fields that apply to the chosen event
      // type — switching e.g. a meeting to a site visit clears the
      // agenda/minutes that no longer belong on it.
      const applicableFields = eventTypeFields(apptEventType).map((f) => f.key);
      const extraOrNull = (key: EventFieldKey) =>
        applicableFields.includes(key) ? apptExtras[key].trim() || null : null;

      const payload = {
        title: apptTitle,
        description: apptDesc || null,
        agenda: extraOrNull('agenda'),
        minutes: extraOrNull('minutes'),
        outcome: extraOrNull('outcome'),
        start_time: startDate.toISOString(),
        end_time: endDate.toISOString(),
        location: apptLocation || null,
        status: apptStatus,
        // First pick stays the primary contact for everything that
        // still reads the single column; the array carries them all.
        contact_id: apptContactIds[0] || null,
        contact_ids: apptContactIds,
        property_id: apptPropertyId || null,
        event_type: apptEventType,
        assigned_to: apptAssignedTo || user?.id || null,
      };

      if (selectedAppt) {
        // Moving an appointment to a new time must re-arm its
        // reminders — otherwise one whose 1h/morning reminder already
        // fired for its OLD time silently never reminds again after
        // being rescheduled, since reminder_morning_sent/
        // reminder_1h_sent (src/lib/appointments/reminder.ts) only
        // ever get set to true and nothing else resets them.
        const rescheduled =
          new Date(payload.start_time).getTime() !==
          new Date(selectedAppt.start_time).getTime();
        // A reschedule also resolves any pending "Requesting reschedule"
        // flag (src/lib/whatsapp/webhook-handler.ts) — the client's ask
        // is addressed by definition once the time actually changes.
        const updatePayload = rescheduled
          ? {
              ...payload,
              reminder_morning_sent: false,
              reminder_1h_sent: false,
              reschedule_requested_at: null,
              client_confirmed_at: null,
            }
          : payload;

        const response = await fetch(`/api/appointments/${selectedAppt.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...updatePayload,
            notify_participants: apptNotificationScope !== 'none',
            notification_scope: apptNotificationScope === 'all' ? 'all' : 'new',
          }),
        });
        const result = await response.json();
        if (!response.ok)
          throw new Error(result.error || 'Failed to update appointment');
        const delivery = result.notifications as {
          sent: number;
          failed: number;
          recipients: number;
        } | null;
        if (delivery?.failed) {
          toast.warning(
            `Appointment updated. ${delivery.sent} message${delivery.sent === 1 ? '' : 's'} sent; ${delivery.failed} could not be delivered.`
          );
        } else if (delivery?.sent) {
          toast.success(
            `Appointment updated and ${delivery.sent} participant${delivery.sent === 1 ? '' : 's'} notified.`
          );
        } else {
          toast.success('Appointment updated successfully');
        }
      } else {
        const userRes = await supabase.auth.getUser();
        const userId = userRes.data.user?.id;

        if (!userId) {
          throw new Error('User session not found. Please re-login.');
        }

        const { error } = await supabase.from('appointments').insert({
          ...payload,
          account_id: accountId,
          user_id: userId,
          source: 'web',
        });

        if (error) throw error;
        toast.success('Appointment scheduled successfully');
      }

      setIsApptModalOpen(false);
      loadData();
    } catch (err) {
      console.error('[CALENDAR SAVE] caught error:', err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      toast.error(errorMessage || 'Failed to save appointment');
    }
  };

  const deleteAppointment = async (apptToDelete?: CalendarEvent) => {
    const target = apptToDelete || selectedAppt;
    if (!target) return;
    if (
      !confirm(`Are you sure you want to cancel and delete "${target.title}"?`)
    )
      return;

    try {
      const { data, error } = await supabase
        .from('appointments')
        .delete()
        .eq('id', target.id)
        .eq('account_id', accountId)
        .select('id');

      if (error) throw error;
      if (!data?.length)
        throw new Error('That appointment is no longer there.');
      toast.success('Appointment deleted successfully');
      setIsApptModalOpen(false);
      loadData();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      toast.error(errorMessage || 'Failed to delete appointment');
    }
  };

  // Smart add bar → one-tap create from parsed natural language / voice.
  const handleSmartConfirm = async (draft: ConfirmedEventDraft) => {
    try {
      const userId = user?.id || (await supabase.auth.getUser()).data.user?.id;
      if (!userId) throw new Error('User session not found. Please re-login.');

      if (draft.kind === 'appointment' && draft.start_time) {
        const { error } = await supabase.from('appointments').insert({
          account_id: accountId,
          user_id: userId,
          assigned_to: draft.assigned_to || userId,
          title: draft.title,
          description: draft.notes,
          event_type: draft.event_type,
          start_time: draft.start_time,
          end_time: draft.end_time || draft.start_time,
          location: draft.location,
          status: 'scheduled',
          contact_id: draft.contact_id,
          contact_ids: draft.contact_id ? [draft.contact_id] : [],
          property_id: draft.property_id,
          source: draft.source,
          transcript: draft.transcript,
        });
        if (error) throw error;
        toast.success('Event added to the calendar');
        setCurrentDate(new Date(draft.start_time));
      } else {
        const { error } = await supabase.from('todos').insert({
          account_id: accountId,
          user_id: userId,
          assigned_to: draft.assigned_to || userId,
          title: draft.title,
          description: draft.notes,
          due_date: draft.start_time,
          priority: draft.priority,
          completed: false,
          contact_id: draft.contact_id,
          property_id: draft.property_id,
          source: draft.source,
        });
        if (error) throw error;
        toast.success('Task added');
      }
      loadData();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      toast.error(errorMessage || 'Failed to save');
      throw err;
    }
  };

  // Appointment modal pickers with the same bidirectional auto-link:
  // picking a contact fills the property they inquired about, picking
  // a property pulls in the contact linked to it.
  const handleApptContactsChange = (ids: string[]) => {
    setApptContactIds(ids);
    if (!apptPropertyId) {
      const hit = linkedPropertyForContacts(ids, contacts, properties);
      if (hit) {
        setApptPropertyId(hit.property.id);
        toast.info(
          `Linked property "${hit.property.title}" from ${hit.contact.name}'s inquiry`
        );
      }
    }
  };

  const handleApptPropertyChange = (val: string | null) => {
    setApptPropertyId(val || '');
    if (val && apptContactIds.length === 0) {
      const linked = linkedContactForProperty(val, contacts);
      if (linked) {
        setApptContactIds([linked.id]);
        toast.info(`Added ${linked.name} — they inquired about this property`);
      }
    }
  };

  // Todo CRUD handlers
  const saveTodo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!todoTitle.trim()) {
      toast.error('Please enter a task name');
      return;
    }

    try {
      const { error } = await supabase.from('todos').insert({
        title: todoTitle,
        description: todoDesc || null,
        due_date: todoDueDate ? new Date(todoDueDate).toISOString() : null,
        priority: todoPriority,
        completed: false,
        account_id: accountId,
        user_id: (await supabase.auth.getUser()).data.user?.id,
      });

      if (error) throw error;
      toast.success('Task added successfully');
      setTodoTitle('');
      setTodoDesc('');
      setTodoDueDate('');
      setTodoPriority('medium');
      loadData();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      toast.error(errorMessage || 'Failed to add task');
    }
  };

  const openEditTodoModal = (todo: Todo) => {
    setSelectedTodo(todo);
    setEditTodoTitle(todo.title);
    setEditTodoDesc(todo.description || '');
    // Slicing the stored ISO string took the UTC date, so a task due late
    // in the evening opened on the wrong day. Read it back in local time,
    // the same way the appointment modal does.
    setEditTodoDueDate(
      todo.due_date ? formatDateTimeLocal(new Date(todo.due_date)) : ''
    );
    setEditTodoPriority(todo.priority);
    setEditTodoCompleted(todo.completed);
    setIsTodoModalOpen(true);
  };

  const updateTodo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTodo) return;
    if (!editTodoTitle.trim()) {
      toast.error('Please enter a task name');
      return;
    }

    try {
      const { data, error } = await supabase
        .from('todos')
        .update({
          title: editTodoTitle,
          description: editTodoDesc || null,
          due_date: editTodoDueDate
            ? new Date(editTodoDueDate).toISOString()
            : null,
          priority: editTodoPriority,
          completed: editTodoCompleted,
        })
        .eq('id', selectedTodo.id)
        .eq('account_id', accountId)
        .select('id');

      if (error) throw error;
      if (!data?.length) throw new Error('That task is no longer there.');
      toast.success('Task updated successfully');
      setIsTodoModalOpen(false);
      setSelectedTodo(null);
      loadData();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      toast.error(errorMessage || 'Failed to update task');
    }
  };

  const openContactChat = async (contactId: string) => {
    try {
      const { data: existing, error } = await supabase
        .from('conversations')
        .select('id')
        .eq('account_id', accountId)
        .eq('contact_id', contactId)
        .maybeSingle();
      if (error) throw error;
      if (existing) {
        router.push(`/inbox?c=${existing.id}`);
        return;
      }
      const { data: created, error: createError } = await supabase
        .from('conversations')
        .insert({
          account_id: accountId,
          user_id: (await supabase.auth.getUser()).data.user?.id,
          contact_id: contactId,
        })
        .select('id')
        .single();
      if (createError) throw createError;
      router.push(`/inbox?c=${created.id}`);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      toast.error(errorMessage || 'Failed to open conversation');
    }
  };

  const toggleTodo = async (todo: Todo) => {
    try {
      const { data, error } = await supabase
        .from('todos')
        .update({ completed: !todo.completed })
        .eq('id', todo.id)
        .eq('account_id', accountId)
        .select('id');

      if (error) throw error;
      if (!data?.length) throw new Error('That task is no longer there.');
      loadData();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      toast.error(errorMessage || 'Failed to toggle task');
    }
  };

  const deleteTodo = async (id: string) => {
    try {
      const { data, error } = await supabase
        .from('todos')
        .delete()
        .eq('id', id)
        .eq('account_id', accountId)
        .select('id');

      if (error) throw error;
      if (!data?.length) throw new Error('That task is no longer there.');
      loadData();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      toast.error(errorMessage || 'Failed to delete task');
    }
  };

  const memberByUserId = useMemo(() => {
    const map: Record<string, TeamMember> = {};
    for (const m of members) map[m.user_id] = m;
    return map;
  }, [members]);

  const headerLabel =
    view === 'agenda'
      ? 'All Scheduled Events'
      : view === 'month'
        ? `${monthNames[month]} ${year}`
        : currentDate.toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          });

  return (
    <div className="relative flex h-full flex-col space-y-6 overflow-hidden">
      {/* Header */}
      <div className="relative z-10 flex items-start justify-between gap-4">
        <div>
          <h1 className="bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-3xl font-extrabold tracking-tight text-transparent text-white">
            Calendar
          </h1>
          <p className="mt-1.5 text-xs leading-relaxed font-medium text-slate-400 sm:text-sm">
            Log site visits, calls, and follow-ups by typing or speaking — and
            see the whole team&apos;s day at a glance.
          </p>
        </div>
        <FavoriteButton label="Calendar" href="/calendar" icon="Calendar" />
      </div>

      {/* Smart quick-add (text + voice) */}
      <div className="relative z-30">
        <SmartAddBar onConfirm={handleSmartConfirm} />
      </div>

      <div className="flex flex-1 flex-col gap-6 overflow-hidden lg:h-full lg:flex-row">
        {/* ── Left Side: Calendar views ────────────────── */}
        {/* `min-w-0`: this is a flex-row item on lg+, and without it the
            pane is only kept from bleeding by the ancestor's
            overflow-hidden — self-cap it so inner truncate engages. */}
        <div className="flex min-h-[560px] min-w-0 flex-1 flex-col rounded-xl border border-slate-800 bg-slate-900/50 p-6 backdrop-blur lg:min-h-0 lg:overflow-y-auto">
          {/* Calendar Header Nav */}
          <div className="mb-4 flex flex-col justify-between gap-4 xl:flex-row xl:items-center">
            <div className="flex items-center gap-3">
              <CalendarIcon className="text-primary h-6 w-6" />
              <h1 className="flex items-center text-xl font-bold text-white sm:text-2xl">
                {headerLabel}
                <InfoHint text="Navigate and schedule site visits, client appointments, or phone calls. Deal dates — registration, payments and expected close — are pinned from the deal record and open it. Use the Team view to see every member's lane for the day." />
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* View switcher */}
              <div className="flex items-center rounded-lg border border-slate-800 bg-slate-950 p-0.5">
                {(
                  [
                    { key: 'month', label: 'Month', icon: LayoutGrid },
                    { key: 'week', label: 'Week', icon: Columns3 },
                    { key: 'team', label: 'Team', icon: Users },
                    { key: 'agenda', label: 'Agenda', icon: List },
                  ] as { key: ViewMode; label: string; icon: typeof Users }[]
                ).map((v) => (
                  <button
                    key={v.key}
                    onClick={() => setView(v.key)}
                    className={cn(
                      'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors',
                      view === v.key
                        ? 'bg-primary/15 text-primary'
                        : 'text-slate-400 hover:text-white'
                    )}
                  >
                    <v.icon className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">{v.label}</span>
                  </button>
                ))}
              </div>

              {view !== 'agenda' && (
                <>
                  <button
                    onClick={handleToday}
                    className="hover:bg-slate-850 rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:text-white"
                  >
                    Today
                  </button>
                  <div className="flex items-center rounded-lg border border-slate-800 bg-slate-950 p-1">
                    <button
                      onClick={handlePrev}
                      aria-label="Previous"
                      className="hover:bg-slate-850 rounded p-1 text-slate-400 hover:text-white"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <button
                      onClick={handleNext}
                      aria-label="Next"
                      className="hover:bg-slate-850 rounded p-1 text-slate-400 hover:text-white"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </>
              )}
              <button
                onClick={() => openNewApptModal()}
                className="bg-primary text-primary-foreground flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold hover:opacity-90"
              >
                <Plus className="h-3.5 w-3.5" />
                Schedule
              </button>
            </div>
          </div>

          {/* Type legend + member filter */}
          <div className="mb-4 flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => setTypeFilter('all')}
              className={cn(
                'rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors',
                effectiveTypeFilter === 'all'
                  ? 'border-primary/50 bg-primary/15 text-primary'
                  : 'border-slate-800 text-slate-400 hover:text-white'
              )}
            >
              All
            </button>
            {EVENT_TYPE_KEYS.map((key) => {
              const meta = EVENT_TYPES[key];
              return (
                <button
                  key={key}
                  onClick={() =>
                    setTypeFilter(typeFilter === key ? 'all' : key)
                  }
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors',
                    typeFilter === key
                      ? meta.chip
                      : 'border-slate-800 text-slate-500 hover:text-white'
                  )}
                >
                  <span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} />
                  {meta.label}
                </button>
              );
            })}
            {view !== 'team' && (
              <button
                onClick={() =>
                  setTypeFilter(typeFilter === 'deal' ? 'all' : 'deal')
                }
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors',
                  typeFilter === 'deal'
                    ? DEAL_DATE_META.chip
                    : 'border-slate-800 text-slate-500 hover:text-white'
                )}
              >
                <span
                  className={cn('h-1.5 w-1.5 rounded-full', DEAL_DATE_META.dot)}
                />
                {DEAL_DATE_META.label}
              </button>
            )}
            {calendarAppointments.archivedCount > 0 && (
              <label className="inline-flex items-center gap-1 rounded-full border border-slate-800 px-2 py-0.5 text-[10px] font-semibold text-slate-400">
                <Archive className="h-2.5 w-2.5" />
                <select
                  value={archivedView}
                  onChange={(e) =>
                    changeArchivedView(toArchivedView(e.target.value))
                  }
                  aria-label={`Archived events (${calendarAppointments.archivedCount})`}
                  title="Grey out keeps archived events on the calendar, dimmed; Hide removes them; List also shows them in Tasks and the Agenda"
                  className="cursor-pointer bg-transparent text-[10px] font-semibold text-slate-300 focus:outline-none"
                >
                  {ARCHIVED_VIEWS.map((mode) => (
                    <option key={mode} value={mode} className="bg-slate-950">
                      {`${ARCHIVED_VIEW_LABELS[mode]} (${calendarAppointments.archivedCount})`}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {members.length > 1 && (
              <select
                value={memberFilter}
                onChange={(e) => setMemberFilter(e.target.value)}
                className="ml-auto cursor-pointer rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-[10px] font-bold text-slate-400 focus:outline-none"
              >
                <option value="all">Everyone</option>
                {members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.full_name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {loading ? (
            <div className="flex flex-1 flex-col items-center justify-center text-slate-400">
              <CalendarLoader
                size={104}
                label="Loading calendar"
                className="mb-3"
              />
              <ConvoRealLoader size={20} className="mb-2" />
              <p className="text-sm">Loading calendar...</p>
            </div>
          ) : view === 'team' ? (
            <TeamView
              events={calendarAppointments.visible}
              members={
                memberFilter === 'all'
                  ? members
                  : members.filter((m) => m.user_id === memberFilter)
              }
              selectedDate={currentDate}
              onSelectDate={setCurrentDate}
              onEventClick={openEditApptModal}
              onSlotClick={(date, assignedTo) =>
                openNewApptModal(date, assignedTo)
              }
            />
          ) : view === 'week' ? (
            <WeekView
              events={calendarAppointments.visible}
              dealDates={visibleDealDates}
              members={members}
              selectedDate={currentDate}
              onEventClick={openEditApptModal}
              onSlotClick={(date) => openNewApptModal(date)}
            />
          ) : view === 'agenda' ? (
            <AgendaView
              events={listedAppointments.visible}
              dealDates={visibleDealDates}
              members={members}
              canEdit={canEdit}
              busyKey={taskBusyKey}
              onEventClick={openEditApptModal}
              onStatusChange={setAppointmentStatus}
              onArchive={archiveAppointment}
              onMilestoneDone={completeMilestone}
            />
          ) : (
            <>
              {/* Days of the Week headings */}
              <div className="grid grid-cols-7 border-b border-slate-800 pb-2 text-center text-xs font-bold tracking-wider text-slate-400 uppercase">
                <div>Sun</div>
                <div>Mon</div>
                <div>Tue</div>
                <div>Wed</div>
                <div>Thu</div>
                <div>Fri</div>
                <div>Sat</div>
              </div>

              {/* Calendar Day Grid */}
              <div className="mt-1 grid min-h-[420px] flex-1 grid-cols-7 grid-rows-6 gap-px bg-slate-800/40">
                {calendarCells.map((cell, idx) => {
                  const dateStr = cell.date.toDateString();
                  const cellAppts = appointmentsByDate[dateStr] || [];
                  const cellDealDates = dealDatesByDate[dateStr] || [];
                  const isToday = new Date().toDateString() === dateStr;

                  return (
                    <div
                      key={idx}
                      onClick={() => openNewApptModal(cell.date)}
                      className={cn(
                        'group relative flex min-h-[70px] cursor-pointer flex-col overflow-hidden bg-slate-950 p-2 transition-colors hover:bg-slate-900/60',
                        !cell.isCurrentMonth && 'opacity-45'
                      )}
                    >
                      {/* Day Number Label */}
                      <span
                        className={cn(
                          'mb-1 inline-flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold',
                          isToday
                            ? 'bg-primary text-primary-foreground font-black'
                            : 'text-slate-400 group-hover:text-white'
                        )}
                      >
                        {cell.day}
                      </span>

                      {/* Appointments indicators inside cell */}
                      <div className="flex max-h-[80px] flex-col gap-1 overflow-y-auto">
                        {cellAppts.map((appt) => {
                          const meta = eventTypeMeta(appt.event_type);
                          const assignee =
                            memberByUserId[appt.assigned_to || appt.user_id];
                          return (
                            <div
                              key={appt.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                openEditApptModal(appt);
                              }}
                              className={cn(
                                'flex cursor-pointer items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] leading-snug transition-colors',
                                meta.chip,
                                appt.status === 'completed' && 'opacity-60',
                                appt.status === 'cancelled' &&
                                  'line-through opacity-50',
                                isArchivedAppointment(appt) &&
                                  ARCHIVED_EVENT_CHIP
                              )}
                            >
                              <meta.icon className="h-2.5 w-2.5 shrink-0" />
                              <span className="flex-1 truncate">
                                {appt.title}
                              </span>
                              {appt.reschedule_requested_at && (
                                <RefreshCcw
                                  className="h-2.5 w-2.5 shrink-0 text-amber-400"
                                  aria-label="Reschedule requested"
                                />
                              )}
                              {!appt.reschedule_requested_at &&
                                appt.client_confirmed_at && (
                                  <CheckCircle
                                    className="h-2.5 w-2.5 shrink-0 text-emerald-400"
                                    aria-label="Client confirmed"
                                  />
                                )}
                              {members.length > 1 && assignee && (
                                <span
                                  className="shrink-0 rounded bg-slate-900/70 px-1 text-[8px] font-bold"
                                  title={assignee.full_name}
                                >
                                  {memberInitials(assignee.full_name)}
                                </span>
                              )}
                            </div>
                          );
                        })}
                        {cellDealDates.map((d) => (
                          <Link
                            key={dealDateKey(d)}
                            href={dealDateHref(d.dealId)}
                            onClick={(e) => e.stopPropagation()}
                            title={`${DEAL_DATE_KIND_LABELS[d.kind]} · ${d.subject} · ${deadlineLabel(d.daysLeft)}`}
                            className={cn(
                              'flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] leading-snug transition-colors',
                              DEAL_DATE_META.chip,
                              d.urgency === 'overdue' && 'border-rose-500/50'
                            )}
                          >
                            <DEAL_DATE_META.icon className="h-2.5 w-2.5 shrink-0" />
                            <span className="flex-1 truncate">{d.title}</span>
                          </Link>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* Tasks pinned on the visible days (CAL-010) */}
          {!loading && (view === 'month' || view === 'week') && (
            <div className="mt-4 shrink-0 border-t border-slate-800 pt-3">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setTasksOpen((open) => !open)}
                  aria-expanded={tasksOpen}
                  className="flex flex-1 items-center gap-2 text-left"
                >
                  <ChevronDown
                    className={cn(
                      'h-3.5 w-3.5 text-slate-500 transition-transform',
                      !tasksOpen && '-rotate-90'
                    )}
                  />
                  <h2 className="flex items-center text-sm font-bold text-white">
                    Tasks
                    <InfoHint text="Everything pinned on the days you are looking at: appointments with their status, and deal dates. Upcoming first puts today at the top, then the days ahead, then past days; Earliest first and Latest first sort strictly by date and time. Mark an event done or cancelled here — a cancelled event stays on its day, struck through. Archive a done or cancelled event to take it off this list; on the calendar it is greyed out, or hidden if you choose Hide archived in the filter row, and List archived brings it back here. A milestone date can be ticked done; it completes the milestone on the deal without moving its stage." />
                  </h2>
                  <span className="text-[10px] font-semibold text-slate-500">
                    {taskRows.length} on{' '}
                    {view === 'week' ? 'this week' : 'this month'}
                  </span>
                </button>
                <select
                  value={taskSort}
                  onChange={(e) => setTaskSort(e.target.value as TaskSortMode)}
                  aria-label="Sort tasks by date and time"
                  className="rounded-md border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[10px] font-semibold text-slate-300"
                >
                  {TASK_SORT_MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {TASK_SORT_LABELS[mode]}
                    </option>
                  ))}
                </select>
                {canEdit && archivableTaskIds.length > 0 && (
                  <button
                    type="button"
                    disabled={taskBusyKey !== null}
                    onClick={() =>
                      archiveAppointments(
                        archivableTaskIds,
                        true,
                        'archive-done'
                      )
                    }
                    title="Archive every done or cancelled event on these days"
                    className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-2 py-0.5 text-[10px] font-semibold text-slate-300 transition-colors hover:bg-slate-800 disabled:opacity-50"
                  >
                    {taskBusyKey === 'archive-done' ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Archive className="h-3 w-3" />
                    )}
                    Archive done ({archivableTaskIds.length})
                  </button>
                )}
              </div>
              {tasksOpen && (
                <div className="mt-3 max-h-80 overflow-y-auto pr-1">
                  <TasksList
                    rows={taskRows}
                    members={members}
                    canEdit={canEdit}
                    busyKey={taskBusyKey}
                    onEventClick={openEditApptModal}
                    onStatusChange={setAppointmentStatus}
                    onArchive={archiveAppointment}
                    onMilestoneDone={completeMilestone}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Right Side: Interactive To-Do Checklist Panel ────────────────── */}
        <div className="flex w-full shrink-0 flex-col gap-6 lg:w-80">
          {/* To-Do panel */}
          <div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-900/50 p-6 backdrop-blur">
            <div className="mb-4 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ListTodo className="text-primary h-5 w-5" />
                <h2 className="flex items-center text-sm font-bold text-white">
                  To-Do Task List
                  <InfoHint text="A lightweight checklist: a title, an optional due date and a priority. Appointments and deal dates live on the calendar and in Tasks beneath it, not here. A task added from a deal's Tasks tab links back to that deal." />
                </h2>
              </div>
              <select
                value={todoFilter}
                onChange={(e) =>
                  setTodoFilter(e.target.value as 'all' | 'priority')
                }
                className="cursor-pointer rounded border border-slate-800 bg-slate-950 px-2 py-0.5 text-[10px] font-bold text-slate-400 focus:outline-none"
              >
                <option value="all">All Tasks</option>
                <option value="priority">Priority Only</option>
              </select>
            </div>

            {/* Quick task add form */}
            <form
              onSubmit={saveTodo}
              className="mb-4 flex flex-col gap-2 border-b border-slate-800 pb-4"
            >
              <input
                type="text"
                placeholder="Add new task..."
                value={todoTitle}
                onChange={(e) => setTodoTitle(e.target.value)}
                className="focus:border-primary w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:outline-none"
              />
              <DateTimePicker
                value={todoDueDate}
                onChange={(val) => setTodoDueDate(val)}
                align="left"
              />
              <div className="flex gap-2">
                <select
                  value={todoPriority}
                  onChange={(e) =>
                    setTodoPriority(e.target.value as 'low' | 'medium' | 'high')
                  }
                  className="focus:border-primary flex-1 rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none"
                >
                  <option value="low">Low Priority</option>
                  <option value="medium">Medium Priority</option>
                  <option value="high">High Priority</option>
                </select>
                <button
                  type="submit"
                  className="bg-primary text-primary-foreground rounded-lg px-3 py-1.5 text-xs font-semibold hover:opacity-90"
                >
                  Add
                </button>
              </div>
            </form>

            {/* Task checklist */}
            <div className="flex-1 space-y-2 overflow-y-auto pr-1">
              {visibleTodos.length === 0 ? (
                <div className="flex h-32 flex-col items-center justify-center text-center text-slate-500">
                  <p className="text-xs">No pending tasks!</p>
                </div>
              ) : (
                visibleTodos.map((todo) => (
                  <div
                    key={todo.id}
                    className={cn(
                      'group flex items-start justify-between gap-3 rounded-lg border bg-slate-950/40 p-2.5 transition-colors hover:bg-slate-950/80',
                      todo.completed
                        ? 'border-slate-800 opacity-60'
                        : 'border-slate-800/80'
                    )}
                  >
                    <button
                      onClick={() => toggleTodo(todo)}
                      className="flex shrink-0 items-start pt-0.5 text-slate-400 hover:text-white"
                    >
                      {todo.completed ? (
                        <CheckCircle className="h-4 w-4 text-emerald-400" />
                      ) : (
                        <Circle className="h-4 w-4" />
                      )}
                    </button>

                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          'text-xs leading-normal font-semibold break-words text-white',
                          todo.completed &&
                            'font-normal text-slate-500 line-through'
                        )}
                      >
                        {todo.title}
                      </p>
                      {(todo.due_date ||
                        todo.contact?.name ||
                        todo.property?.title) && (
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-slate-500">
                          {todo.due_date && (
                            <span>
                              {new Date(todo.due_date).toLocaleString('en-IN', {
                                day: 'numeric',
                                month: 'short',
                                hour: 'numeric',
                                minute: '2-digit',
                                hour12: true,
                              })}
                            </span>
                          )}
                          {todo.contact_id && todo.contact?.name && (
                            <Link
                              href={`/contacts?contactId=${todo.contact_id}`}
                              className="inline-flex max-w-full items-center gap-1 truncate transition-colors hover:text-white"
                              title="Open contact"
                            >
                              <User className="h-2.5 w-2.5 shrink-0" />
                              {todo.contact.name}
                            </Link>
                          )}
                          {todo.property_id && todo.property?.title && (
                            <Link
                              href={`/inventory?propertyId=${todo.property_id}`}
                              className="inline-flex max-w-full items-center gap-1 truncate transition-colors hover:text-white"
                              title="Open property"
                            >
                              <Home className="h-2.5 w-2.5 shrink-0" />
                              {todo.property.title}
                            </Link>
                          )}
                        </p>
                      )}
                      {todo.description && (
                        <p
                          className={cn(
                            'mt-1 line-clamp-2 text-[10px] leading-relaxed break-words text-slate-400 transition-all duration-300 group-hover:line-clamp-none',
                            todo.completed && 'text-slate-650 line-through'
                          )}
                        >
                          {todo.description}
                        </p>
                      )}
                      <span className="mt-1 flex flex-wrap items-center gap-1">
                        {todo.priority && !todo.completed && (
                          <span
                            className={cn(
                              'inline-block rounded px-1.5 py-0.5 text-[8px] font-bold uppercase',
                              todo.priority === 'high'
                                ? 'border border-rose-500/20 bg-rose-500/10 text-rose-400'
                                : todo.priority === 'medium'
                                  ? 'border border-amber-500/20 bg-amber-500/10 text-amber-400'
                                  : 'bg-slate-800 text-slate-400'
                            )}
                          >
                            {todo.priority}
                          </span>
                        )}
                        {todo.deal_id && (
                          <Link
                            href={dealDateHref(todo.deal_id)}
                            className={cn(
                              'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[8px] font-bold uppercase',
                              DEAL_DATE_META.chip
                            )}
                            title="Open the deal this task belongs to"
                          >
                            <Briefcase className="h-2.5 w-2.5" />
                            Deal
                          </Link>
                        )}
                      </span>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                      {todo.contact_id && (
                        <button
                          onClick={() => openContactChat(todo.contact_id!)}
                          className="p-0.5 text-slate-500 transition-colors hover:text-emerald-400"
                          title={`Check with ${todo.contact?.name?.trim().split(/\s+/)[0] || 'contact'} on WhatsApp`}
                          aria-label="Open chat"
                        >
                          <MessageSquare className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button
                        onClick={() => openEditTodoModal(todo)}
                        className="p-0.5 text-slate-500 transition-colors hover:text-white"
                        title="Edit task"
                        aria-label="Edit task"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => deleteTodo(todo.id)}
                        className="hover:text-rose-450 p-0.5 text-slate-500 transition-colors"
                        title="Delete task"
                        aria-label="Delete task"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* ── Appointment Edit/Create Dialog Modal Overlay ────────────────── */}
        {isApptModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/80 p-4 backdrop-blur-sm">
            <div className="my-auto max-h-[calc(100vh-2rem)] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
              {/* Modal Header */}
              <div className="mb-4 flex items-center justify-between border-b border-slate-800 pb-3">
                <h3 className="flex items-center gap-2 text-lg font-bold text-white">
                  <CalendarDays className="text-primary h-5 w-5" />
                  {selectedAppt ? 'Edit Schedule' : 'Schedule Appointment'}
                </h3>
                <button
                  onClick={() => setIsApptModalOpen(false)}
                  className="text-slate-400 hover:text-white"
                  aria-label="Close modal"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {!selectedAppt?.reschedule_requested_at &&
                selectedAppt?.client_confirmed_at && (
                  <div className="mb-4 flex items-center gap-2 rounded-lg border border-emerald-600/40 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-300">
                    <CheckCircle className="h-3.5 w-3.5 shrink-0" />
                    <span>
                      Client confirmed on{' '}
                      {new Date(
                        selectedAppt.client_confirmed_at
                      ).toLocaleString('en-IN', {
                        day: '2-digit',
                        month: 'short',
                        hour: 'numeric',
                        minute: '2-digit',
                        hour12: true,
                      })}{' '}
                      via the reminder&apos;s &ldquo;Fine&rdquo; button.
                    </span>
                  </div>
                )}
              {selectedAppt?.reschedule_requested_at && (
                <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-600/40 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
                  <RefreshCcw className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    Client requested a reschedule on{' '}
                    {new Date(
                      selectedAppt.reschedule_requested_at
                    ).toLocaleString('en-IN', {
                      day: '2-digit',
                      month: 'short',
                      hour: 'numeric',
                      minute: '2-digit',
                      hour12: true,
                    })}
                    . Changing the time below will clear this notice.
                  </span>
                </div>
              )}

              {/* Modal Form */}
              <form onSubmit={saveAppointment} className="space-y-4">
                <div>
                  <label className="mb-1 block text-xs font-bold tracking-wider text-slate-400 uppercase">
                    Visit / Title *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Site Visit - JP Nagar Plot"
                    value={apptTitle}
                    onChange={(e) => setApptTitle(e.target.value)}
                    className="focus:border-primary w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:outline-none"
                  />
                </div>

                {/* Event type chips */}
                <div>
                  <label className="mb-1.5 block text-xs font-bold tracking-wider text-slate-400 uppercase">
                    Activity Type
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {EVENT_TYPE_KEYS.map((key) => {
                      const meta = EVENT_TYPES[key];
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setApptEventType(key)}
                          className={cn(
                            'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-semibold transition-colors',
                            apptEventType === key
                              ? meta.chip
                              : 'border-slate-800 text-slate-500 hover:text-white'
                          )}
                        >
                          <meta.icon className="h-3 w-3" />
                          {meta.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {members.length > 1 && (
                  <div>
                    <label className="mb-1 block text-xs font-bold tracking-wider text-slate-400 uppercase">
                      Assign To
                    </label>
                    <select
                      value={apptAssignedTo}
                      onChange={(e) => setApptAssignedTo(e.target.value)}
                      className="focus:border-primary w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:outline-none"
                    >
                      {members.map((m) => (
                        <option key={m.user_id} value={m.user_id}>
                          {m.full_name}
                          {m.user_id === user?.id ? ' (me)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-1 block text-xs font-bold tracking-wider text-slate-400 uppercase">
                      Link Contacts (buyer, agent…)
                    </label>
                    <SearchableContactMultiSelect
                      contacts={contacts}
                      value={apptContactIds}
                      onChange={handleApptContactsChange}
                      placeholder="Search contacts..."
                    />
                    <p className="mt-1 text-[10px] font-medium text-slate-500">
                      {apptEventType === 'call'
                        ? 'Calls stay internal — only you get the reminder, linked contacts are not messaged.'
                        : 'Reminders go to every linked contact — 7 AM on the day & 1 hour before.'}
                    </p>
                    {selectedAppt && apptContactIds.length > 0 && (
                      <div className="mt-2">
                        <label className="mb-1 block text-[10px] font-bold tracking-wider text-slate-500 uppercase">
                          WhatsApp after saving
                        </label>
                        <select
                          value={apptNotificationScope}
                          onChange={(e) =>
                            setApptNotificationScope(
                              e.target.value as 'none' | 'new' | 'all'
                            )
                          }
                          className="focus:border-primary w-full rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-2 text-xs text-white focus:outline-none"
                        >
                          <option value="new">
                            Inform newly added participants
                          </option>
                          <option value="all">
                            Send updated details to everyone
                          </option>
                          <option value="none">Do not send a message</option>
                        </select>
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-bold tracking-wider text-slate-400 uppercase">
                      Link Property Listing
                    </label>
                    <SearchablePropertySelect
                      properties={properties}
                      value={apptPropertyId || null}
                      onChange={handleApptPropertyChange}
                      placeholder="Search by title or ID..."
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-1 block text-xs font-bold tracking-wider text-slate-400 uppercase">
                      Start Time *
                    </label>
                    <DateTimePicker
                      value={apptStartTime}
                      onChange={(val) => setApptStartTime(val)}
                      align="left"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-bold tracking-wider text-slate-400 uppercase">
                      End Time *
                    </label>
                    <DateTimePicker
                      value={apptEndTime}
                      onChange={(val) => setApptEndTime(val)}
                      align="right"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-bold tracking-wider text-slate-400 uppercase">
                    Location / Meeting Link
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. JP Nagar 5th Phase, or Google Meet URL"
                    value={apptLocation}
                    onChange={(e) => setApptLocation(e.target.value)}
                    className="focus:border-primary w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-bold tracking-wider text-slate-400 uppercase">
                    Notes / Description
                  </label>
                  <textarea
                    placeholder="Additional details regarding the client's interests, host requirements..."
                    value={apptDesc}
                    onChange={(e) => setApptDesc(e.target.value)}
                    rows={3}
                    className="focus:border-primary w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:outline-none"
                  />
                </div>

                {/* Type-specific notes: agenda before the event, minutes /
                    outcome once it exists. Post fields only show when
                    editing — there's nothing to log before it happens. */}
                {eventTypeFields(apptEventType)
                  .filter((f) => f.phase === 'pre' || !!selectedAppt)
                  .map((f) => (
                    <div key={f.key}>
                      <label className="mb-1 block text-xs font-bold tracking-wider text-slate-400 uppercase">
                        {f.label}
                        {f.phase === 'pre' ? (
                          <span className="ml-1.5 font-semibold text-slate-500 normal-case">
                            — sent in the pre-event reminder
                          </span>
                        ) : (
                          <span className="ml-1.5 font-semibold text-slate-500 normal-case">
                            — fill in after the event
                          </span>
                        )}
                      </label>
                      <textarea
                        placeholder={f.placeholder}
                        value={apptExtras[f.key]}
                        onChange={(e) =>
                          setApptExtras((prev) => ({
                            ...prev,
                            [f.key]: e.target.value,
                          }))
                        }
                        rows={2}
                        className="focus:border-primary w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:outline-none"
                      />
                    </div>
                  ))}

                {selectedAppt?.transcript && (
                  <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                    <p className="flex items-center gap-1.5 text-[10px] font-bold tracking-wider text-slate-500 uppercase">
                      <AudioLines className="h-3 w-3" />
                      Logged{' '}
                      {selectedAppt.source === 'voice'
                        ? 'by voice'
                        : 'via WhatsApp'}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-400 italic">
                      &ldquo;{selectedAppt.transcript}&rdquo;
                    </p>
                  </div>
                )}

                <div className="mt-2 flex items-center justify-between border-t border-slate-800 pt-4">
                  <div>
                    {selectedAppt && (
                      <button
                        type="button"
                        onClick={() => deleteAppointment()}
                        className="flex items-center gap-1 text-xs text-rose-500 hover:text-rose-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete Visit
                      </button>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {selectedAppt && (
                      <select
                        value={apptStatus}
                        onChange={(e) =>
                          setApptStatus(
                            e.target.value as
                              'scheduled' | 'completed' | 'cancelled'
                          )
                        }
                        className="focus:border-primary rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:outline-none"
                      >
                        <option value="scheduled">Scheduled</option>
                        <option value="completed">Completed</option>
                        <option value="cancelled">Cancelled</option>
                      </select>
                    )}
                    <button
                      type="submit"
                      className="bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-semibold hover:opacity-90"
                    >
                      Save Changes
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ── Todo Edit Dialog Modal Overlay ────────────────── */}
        {isTodoModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/80 p-4 backdrop-blur-sm">
            <div className="my-auto max-h-[calc(100vh-2rem)] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
              {/* Modal Header */}
              <div className="mb-4 flex items-center justify-between border-b border-slate-800 pb-3">
                <h3 className="flex items-center gap-2 text-lg font-bold text-white">
                  <ListTodo className="text-primary h-5 w-5" />
                  Edit Task
                </h3>
                <button
                  onClick={() => setIsTodoModalOpen(false)}
                  className="text-slate-400 hover:text-white"
                  aria-label="Close modal"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Modal Form */}
              <form onSubmit={updateTodo} className="space-y-4">
                <div>
                  <label className="mb-1 block text-xs font-bold tracking-wider text-slate-400 uppercase">
                    Task Name *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Send the EC copy to the advocate"
                    value={editTodoTitle}
                    onChange={(e) => setEditTodoTitle(e.target.value)}
                    className="focus:border-primary w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-bold tracking-wider text-slate-400 uppercase">
                    Description / Notes
                  </label>
                  <textarea
                    placeholder="Task details..."
                    value={editTodoDesc}
                    onChange={(e) => setEditTodoDesc(e.target.value)}
                    rows={3}
                    className="focus:border-primary w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-1 block text-xs font-bold tracking-wider text-slate-400 uppercase">
                      Due Date
                    </label>
                    <DateTimePicker
                      value={editTodoDueDate}
                      onChange={(val) => setEditTodoDueDate(val)}
                      align="left"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-bold tracking-wider text-slate-400 uppercase">
                      Priority
                    </label>
                    <select
                      value={editTodoPriority}
                      onChange={(e) =>
                        setEditTodoPriority(
                          e.target.value as 'low' | 'medium' | 'high'
                        )
                      }
                      className="focus:border-primary w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:outline-none"
                    >
                      <option value="low">Low Priority</option>
                      <option value="medium">Medium Priority</option>
                      <option value="high">High Priority</option>
                    </select>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="edit-todo-completed"
                    checked={editTodoCompleted}
                    onChange={(e) => setEditTodoCompleted(e.target.checked)}
                    className="text-primary h-4 w-4 cursor-pointer rounded border-slate-700 bg-slate-950 focus:ring-0 focus:ring-offset-0"
                  />
                  <label
                    htmlFor="edit-todo-completed"
                    className="text-slate-350 cursor-pointer text-sm font-semibold select-none"
                  >
                    Mark as Completed
                  </label>
                </div>

                <div className="mt-2 flex items-center justify-between border-t border-slate-800 pt-4">
                  <div>
                    <button
                      type="button"
                      onClick={() => {
                        if (
                          confirm('Are you sure you want to delete this task?')
                        ) {
                          deleteTodo(selectedTodo!.id);
                          setIsTodoModalOpen(false);
                        }
                      }}
                      className="flex items-center gap-1 text-xs text-rose-500 hover:text-rose-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete Task
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setIsTodoModalOpen(false)}
                      className="hover:bg-slate-850 rounded-lg border border-slate-800 bg-slate-950 px-4 py-2 text-sm font-semibold text-slate-300 hover:text-white"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-semibold hover:opacity-90"
                    >
                      Save Changes
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
