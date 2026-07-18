"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
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
  Users,
  LayoutGrid,
  Columns3,
  List,
  AudioLines,
  RefreshCcw,
} from "lucide-react";
import { toast } from "sonner";
import { CalendarLoader } from "@/components/ui/calendar-loader";
import { ConvoRealLoader } from "@/components/ui/convoreal-loader";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { SearchableContactMultiSelect } from "@/components/ui/searchable-contact-multi-select";
import { SearchablePropertySelect } from "@/components/ui/searchable-property-select";
import {
  autoLinkContactProperty,
  linkedContactForProperty,
  linkedPropertyForContacts,
} from "@/lib/calendar/auto-link";
import { InfoHint } from "@/components/ui/info-hint";
import { FavoriteButton } from "@/components/layout/favorite-button";
import { NameTagBadge } from "@/components/contacts/name-tag-badge";
import { SmartAddBar, ConfirmedEventDraft } from "@/components/calendar/smart-add-bar";
import { TeamView } from "@/components/calendar/team-view";
import { WeekView } from "@/components/calendar/week-view";
import { AgendaView } from "@/components/calendar/agenda-view";
import {
  CalendarEvent,
  TeamMember,
  EVENT_TYPES,
  EVENT_TYPE_KEYS,
  EventTypeKey,
  EventFieldKey,
  eventTypeFields,
  eventTypeMeta,
  memberInitials,
} from "@/components/calendar/event-types";

const EMPTY_EXTRAS: Record<EventFieldKey, string> = { agenda: "", minutes: "", outcome: "" };

interface Todo {
  id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  priority: "low" | "medium" | "high";
  completed: boolean;
  contact_id?: string | null;
  property_id?: string | null;
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
  isAppointment?: boolean;
  eventType?: EventTypeKey;
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
}

type ViewMode = "month" | "week" | "team" | "agenda";

export default function CalendarPage() {
  const supabase = createClient();
  const { accountId, user } = useAuth();

  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<ViewMode>("month");
  const [appointments, setAppointments] = useState<CalendarEvent[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [contacts, setContacts] = useState<SimpleContact[]>([]);
  const [properties, setProperties] = useState<SimpleProperty[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [typeFilter, setTypeFilter] = useState<EventTypeKey | "all">("all");
  const [memberFilter, setMemberFilter] = useState<string>("all");

  const searchParams = useSearchParams();
  const [todoFilter, setTodoFilter] = useState<"all" | "priority">("all");

  useEffect(() => {
    if (searchParams.get("filter") === "priority") {
      setTodoFilter("priority");
    } else {
      setTodoFilter("all");
    }
  }, [searchParams]);

  // Modals state
  const [isApptModalOpen, setIsApptModalOpen] = useState(false);
  const [selectedAppt, setSelectedAppt] = useState<CalendarEvent | null>(null);

  // Appointment Form state
  const [apptTitle, setApptTitle] = useState("");
  const [apptDesc, setApptDesc] = useState("");
  const [apptContactIds, setApptContactIds] = useState<string[]>([]);
  const [apptPropertyId, setApptPropertyId] = useState("");
  const [apptStartTime, setApptStartTime] = useState("");
  const [apptEndTime, setApptEndTime] = useState("");
  const [apptLocation, setApptLocation] = useState("");
  const [apptStatus, setApptStatus] = useState<"scheduled" | "completed" | "cancelled">("scheduled");
  const [apptEventType, setApptEventType] = useState<EventTypeKey>("meeting");
  const [apptAssignedTo, setApptAssignedTo] = useState("");
  // Type-specific structured notes (agenda / minutes / outcome).
  const [apptExtras, setApptExtras] = useState<Record<EventFieldKey, string>>({ ...EMPTY_EXTRAS });

  // Todo Form state
  const [todoTitle, setTodoTitle] = useState("");
  const [todoDesc, setTodoDesc] = useState("");
  const [todoDueDate, setTodoDueDate] = useState("");
  const [todoPriority, setTodoPriority] = useState<"low" | "medium" | "high">("medium");

  // Mentions Form state
  const [mentionType, setMentionType] = useState<"contact" | "property" | null>(null);
  const [mentionSearch, setMentionSearch] = useState("");

  // Todo Modal/Edit state
  const [isTodoModalOpen, setIsTodoModalOpen] = useState(false);
  const [selectedTodo, setSelectedTodo] = useState<Todo | null>(null);
  const [editTodoTitle, setEditTodoTitle] = useState("");
  const [editTodoDesc, setEditTodoDesc] = useState("");
  const [editTodoDueDate, setEditTodoDueDate] = useState("");
  const [editTodoPriority, setEditTodoPriority] = useState<"low" | "medium" | "high">("medium");
  const [editTodoCompleted, setEditTodoCompleted] = useState(false);

  // Fetch appointments and todos
  const loadData = useCallback(async () => {
    try {
      setLoading(true);

      const { data: appts, error: apptError } = await supabase
        .from("appointments")
        .select("*, contact:contacts(id, name, phone, name_tag), property:properties(id, title, location, sublocality)")
        .eq("account_id", accountId)
        .order("start_time", { ascending: true });

      if (apptError) throw apptError;
      setAppointments((appts || []) as CalendarEvent[]);

      const { data: todoList, error: todoError } = await supabase
        .from("todos")
        .select("*, contact:contacts(id, name, phone, name_tag), property:properties(id, title, location, sublocality)")
        .eq("account_id", accountId)
        .order("created_at", { ascending: true });

      if (todoError) throw todoError;
      setTodos(todoList || []);

      const { data: contactsList } = await supabase
        .from("contacts")
        .select("id, name, phone, last_inquired_property_id, name_tag")
        .eq("account_id", accountId)
        .order("name");
      setContacts(contactsList || []);

      const { data: propsList } = await supabase
        .from("properties")
        .select("id, title, property_code, location, sublocality")
        .eq("account_id", accountId)
        .order("title");
      setProperties(propsList || []);
    } catch (err) {
      console.error("[CALENDAR PAGE] loadData caught error:", err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      toast.error(errorMessage || "Failed to load calendar data");
    } finally {
      setLoading(false);
    }
  }, [accountId, supabase]);

  useEffect(() => {
    if (accountId) {
      loadData();
    }
  }, [accountId, loadData]);

  // Team roster for lanes, assignee select, and initials badges.
  useEffect(() => {
    if (!accountId) return;
    fetch("/api/account/members")
      .then((res) => (res.ok ? res.json() : { members: [] }))
      .then((json) => {
        const rows = (json.members || []) as Array<{
          user_id: string;
          full_name: string;
          avatar_url: string | null;
          org_role?: string;
          team_id: string | null;
        }>;
        setMembers(rows.map((r) => ({ ...r, full_name: r.full_name || "Member" })));
      })
      .catch(() => setMembers([]));
  }, [accountId]);

  // Calendar math
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
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
        date: new Date(year, month - 1, prevDaysInMonth - i)
      });
    }

    for (let i = 1; i <= daysInMonth; i++) {
      cells.push({
        day: i,
        isCurrentMonth: true,
        date: new Date(year, month, i)
      });
    }

    const remaining = 42 - cells.length; // 6 rows of 7 days = 42
    for (let i = 1; i <= remaining; i++) {
      cells.push({
        day: i,
        isCurrentMonth: false,
        date: new Date(year, month + 1, i)
      });
    }

    return cells;
  }, [year, month, firstDayIndex, daysInMonth, prevDaysInMonth]);

  // View-level filters applied to every calendar surface.
  const filteredAppointments = useMemo(() => {
    return appointments.filter((appt) => {
      if (typeFilter !== "all" && (appt.event_type || "other") !== typeFilter) return false;
      if (memberFilter !== "all" && (appt.assigned_to || appt.user_id) !== memberFilter) return false;
      return true;
    });
  }, [appointments, typeFilter, memberFilter]);

  // Combine appointments and todos for the To-Do task list
  const combinedTodos = useMemo(() => {
    const apptTodos: Todo[] = appointments.map((appt) => ({
      id: appt.id,
      title: `[${eventTypeMeta(appt.event_type).label}] ${appt.title}`,
      description: appt.description,
      due_date: appt.start_time,
      priority: "medium" as const,
      completed: appt.status === "completed" || appt.status === "cancelled",
      contact_id: appt.contact_id,
      property_id: appt.property_id,
      contact: appt.contact,
      property: appt.property,
      isAppointment: true,
      eventType: appt.event_type,
    }));

    const all = [...todos, ...apptTodos];
    const filtered = todoFilter === "priority"
      ? all.filter((t) => t.priority === "high" || t.priority === "medium")
      : all;

    return filtered.sort((a, b) => {
      if (a.completed !== b.completed) {
        return a.completed ? 1 : -1;
      }
      const dateA = a.due_date ? new Date(a.due_date).getTime() : 0;
      const dateB = b.due_date ? new Date(b.due_date).getTime() : 0;
      return dateA - dateB;
    });
  }, [todos, appointments, todoFilter]);

  // Group appointments by date string
  const appointmentsByDate = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {};
    filteredAppointments.forEach((appt) => {
      const dateStr = new Date(appt.start_time).toDateString();
      if (!map[dateStr]) map[dateStr] = [];
      map[dateStr].push(appt);
    });
    return map;
  }, [filteredAppointments]);

  // Date Nav handlers
  const handlePrev = () => {
    if (view === "month") {
      setCurrentDate(new Date(year, month - 1, 1));
    } else {
      const d = new Date(currentDate);
      d.setDate(d.getDate() - 7);
      setCurrentDate(d);
    }
  };

  const handleNext = () => {
    if (view === "month") {
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

  const formatDateTimeLocal = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  // Appointment modal edit/create
  const openNewApptModal = (date?: Date, assignedTo?: string) => {
    setSelectedAppt(null);
    setApptTitle("");
    setApptDesc("");
    setApptContactIds([]);
    setApptPropertyId("");
    setApptLocation("");
    setApptStatus("scheduled");
    setApptEventType("meeting");
    setApptAssignedTo(assignedTo || user?.id || "");
    setApptExtras({ ...EMPTY_EXTRAS });

    const start = date ? new Date(date) : new Date();
    start.setHours(10, 0, 0, 0); // Default to 10:00 AM
    const end = new Date(start);
    end.setHours(11, 0, 0, 0); // Default 1 hour duration

    setApptStartTime(formatDateTimeLocal(start));
    setApptEndTime(formatDateTimeLocal(end));
    setIsApptModalOpen(true);
  };

  const openEditApptModal = (appt: CalendarEvent) => {
    setSelectedAppt(appt);
    setApptTitle(appt.title);
    setApptDesc(appt.description || "");
    setApptContactIds(
      appt.contact_ids && appt.contact_ids.length > 0
        ? appt.contact_ids
        : appt.contact_id
          ? [appt.contact_id]
          : []
    );
    setApptPropertyId(appt.property_id || "");
    setApptLocation(appt.location || "");
    setApptStatus(appt.status);
    setApptEventType(appt.event_type || "meeting");
    setApptAssignedTo(appt.assigned_to || appt.user_id || "");
    setApptExtras({
      agenda: appt.agenda || "",
      minutes: appt.minutes || "",
      outcome: appt.outcome || "",
    });
    setApptStartTime(formatDateTimeLocal(new Date(appt.start_time)));
    setApptEndTime(formatDateTimeLocal(new Date(appt.end_time)));
    setIsApptModalOpen(true);
  };

  const saveAppointment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apptTitle.trim()) {
      toast.error("Please enter a title");
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
        throw new Error("Invalid start or end date selection.");
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
        agenda: extraOrNull("agenda"),
        minutes: extraOrNull("minutes"),
        outcome: extraOrNull("outcome"),
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
          new Date(payload.start_time).getTime() !== new Date(selectedAppt.start_time).getTime();
        // A reschedule also resolves any pending "Requesting reschedule"
        // flag (src/lib/whatsapp/webhook-handler.ts) — the client's ask
        // is addressed by definition once the time actually changes.
        const updatePayload = rescheduled
          ? { ...payload, reminder_morning_sent: false, reminder_1h_sent: false, reschedule_requested_at: null, client_confirmed_at: null }
          : payload;

        const { error } = await supabase
          .from("appointments")
          .update(updatePayload)
          .eq("id", selectedAppt.id)
          .eq("account_id", accountId);

        if (error) throw error;
        toast.success("Appointment updated successfully");
      } else {
        const userRes = await supabase.auth.getUser();
        const userId = userRes.data.user?.id;

        if (!userId) {
          throw new Error("User session not found. Please re-login.");
        }

        const { error } = await supabase
          .from("appointments")
          .insert({
            ...payload,
            account_id: accountId,
            user_id: userId,
            source: "web",
          });

        if (error) throw error;
        toast.success("Appointment scheduled successfully");
      }

      setIsApptModalOpen(false);
      loadData();
    } catch (err) {
      console.error("[CALENDAR SAVE] caught error:", err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      toast.error(errorMessage || "Failed to save appointment");
    }
  };

  const deleteAppointment = async (apptToDelete?: CalendarEvent) => {
    const target = apptToDelete || selectedAppt;
    if (!target) return;
    if (!confirm(`Are you sure you want to cancel and delete "${target.title}"?`)) return;

    try {
      const { error } = await supabase
        .from("appointments")
        .delete()
        .eq("id", target.id)
        .eq("account_id", accountId);

      if (error) throw error;
      toast.success("Appointment deleted successfully");
      setIsApptModalOpen(false);
      loadData();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      toast.error(errorMessage || "Failed to delete appointment");
    }
  };

  // Smart add bar → one-tap create from parsed natural language / voice.
  const handleSmartConfirm = async (draft: ConfirmedEventDraft) => {
    try {
      const userId = user?.id || (await supabase.auth.getUser()).data.user?.id;
      if (!userId) throw new Error("User session not found. Please re-login.");

      if (draft.kind === "appointment" && draft.start_time) {
        const { error } = await supabase.from("appointments").insert({
          account_id: accountId,
          user_id: userId,
          assigned_to: draft.assigned_to || userId,
          title: draft.title,
          description: draft.notes,
          event_type: draft.event_type,
          start_time: draft.start_time,
          end_time: draft.end_time || draft.start_time,
          location: draft.location,
          status: "scheduled",
          contact_id: draft.contact_id,
          contact_ids: draft.contact_id ? [draft.contact_id] : [],
          property_id: draft.property_id,
          source: draft.source,
          transcript: draft.transcript,
        });
        if (error) throw error;
        toast.success("Event added to the calendar");
        setCurrentDate(new Date(draft.start_time));
      } else {
        const { error } = await supabase.from("todos").insert({
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
        toast.success("Task added");
      }
      loadData();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      toast.error(errorMessage || "Failed to save");
      throw err;
    }
  };

  // Mentions suggestions filtering
  const filteredContacts = useMemo(() => {
    if (mentionType !== "contact") return [];
    const searchVal = mentionSearch.toLowerCase();
    return contacts
      .filter((c) => c.name.toLowerCase().includes(searchVal))
      .slice(0, 5);
  }, [contacts, mentionType, mentionSearch]);

  const filteredProperties = useMemo(() => {
    if (mentionType !== "property") return [];
    const searchVal = mentionSearch.toLowerCase();
    return properties
      .filter(
        (p) =>
          p.title.toLowerCase().includes(searchVal) ||
          (p.property_code || "").toLowerCase().includes(searchVal)
      )
      .slice(0, 5);
  }, [properties, mentionType, mentionSearch]);

  const handleTodoTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setTodoTitle(val);

    const words = val.split(/\s+/);
    const lastWord = words[words.length - 1] || "";

    if (lastWord.startsWith("@")) {
      setMentionType("contact");
      setMentionSearch(lastWord.substring(1));
    } else if (lastWord.startsWith("#")) {
      setMentionType("property");
      setMentionSearch(lastWord.substring(1));
    } else {
      setMentionType(null);
      setMentionSearch("");
    }
  };

  const selectMention = (nameOrTitle: string, id: string, type: "contact" | "property") => {
    const words = todoTitle.split(/\s+/);
    words.pop();
    const trigger = type === "contact" ? "@" : "#";
    const replacement = `${trigger}${nameOrTitle} `;
    words.push(replacement);

    setTodoTitle(words.join(" "));
    setMentionType(null);
    setMentionSearch("");
  };

  const renderTodoTitle = (todo: Todo) => {
    const title = todo.title;
    const contactName = todo.contact?.name;
    const propertyTitle = todo.property?.title;

    const elements: React.ReactNode[] = [];
    const matches: { start: number; end: number; type: "contact" | "property"; label: string; url: string }[] = [];

    // Parse contact mention (e.g. @Praneeth or @Praneeth Kumar)
    if (todo.contact_id && contactName) {
      const firstName = contactName.split(" ")[0];
      let matchedText = "";
      if (title.includes(`@${contactName}`)) {
        matchedText = `@${contactName}`;
      } else if (title.includes(`@${firstName}`)) {
        matchedText = `@${firstName}`;
      } else {
        const match = title.match(/@([A-Za-z0-9_]+)/);
        if (match) {
          matchedText = match[0];
        }
      }

      if (matchedText) {
        const start = title.indexOf(matchedText);
        matches.push({
          start,
          end: start + matchedText.length,
          type: "contact",
          label: matchedText,
          url: `/contacts?search=${encodeURIComponent(contactName)}`,
        });
      }
    }

    // Parse property mention (e.g. #2400JP Nagar or #2400JP)
    if (todo.property_id && propertyTitle) {
      const firstWord = propertyTitle.split(" ")[0];
      let matchedText = "";
      if (title.includes(`#${propertyTitle}`)) {
        matchedText = `#${propertyTitle}`;
      } else if (title.includes(`#${firstWord}`)) {
        matchedText = `#${firstWord}`;
      } else {
        const match = title.match(/#([A-Za-z0-9_]+)/);
        if (match) {
          matchedText = match[0];
        }
      }

      if (matchedText) {
        const start = title.indexOf(matchedText);
        matches.push({
          start,
          end: start + matchedText.length,
          type: "property",
          label: matchedText,
          url: `/inventory?search=${encodeURIComponent(propertyTitle)}`,
        });
      }
    }

    matches.sort((a, b) => a.start - b.start);

    let lastIndex = 0;
    for (const match of matches) {
      if (match.start > lastIndex) {
        elements.push(title.substring(lastIndex, match.start));
      }
      elements.push(
        <Link
          key={match.start}
          href={match.url}
          className={cn(
            "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold transition-all mx-0.5 whitespace-nowrap",
            match.type === "contact"
              ? cn(
                  "bg-violet-500/10 text-violet-400 border border-violet-500/20",
                  todo.completed ? "opacity-50 line-through" : "hover:bg-violet-500/25 hover:scale-105 active:scale-95"
                )
              : cn(
                  "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20",
                  todo.completed ? "opacity-50 line-through" : "hover:bg-emerald-500/25 hover:scale-105 active:scale-95"
                )
          )}
        >
          {match.label}
        </Link>
      );
      lastIndex = match.end;
    }

    if (lastIndex < title.length) {
      elements.push(title.substring(lastIndex));
    }

    return elements.length > 0 ? elements : title;
  };

  // Helper to extract/resolve mentions
  const resolveMentions = useCallback((title: string) => {
    let finalContactId: string | null = null;
    const sortedContacts = [...contacts].sort((a, b) => b.name.length - a.name.length);
    for (const c of sortedContacts) {
      if (title.toLowerCase().includes(`@${c.name.toLowerCase()}`)) {
        finalContactId = c.id;
        break;
      }
    }
    if (!finalContactId) {
      const contactMentionMatch = title.match(/@([A-Za-z0-9_]+)/);
      if (contactMentionMatch) {
        const query = contactMentionMatch[1].toLowerCase();
        const matchedContact = contacts.find((c) => c.name.toLowerCase().includes(query));
        if (matchedContact) {
          finalContactId = matchedContact.id;
        }
      }
    }

    let finalPropertyId: string | null = null;
    const sortedProps = [...properties].sort((a, b) => b.title.length - a.title.length);
    for (const p of sortedProps) {
      if (
        title.toLowerCase().includes(`#${p.title.toLowerCase()}`) ||
        (p.property_code && title.toLowerCase().includes(`#${p.property_code.toLowerCase()}`))
      ) {
        finalPropertyId = p.id;
        break;
      }
    }
    if (!finalPropertyId) {
      const propertyMentionMatch = title.match(/#([A-Za-z0-9_-]+)/);
      if (propertyMentionMatch) {
        const query = propertyMentionMatch[1].toLowerCase();
        const matchedProp = properties.find(
          (p) =>
            p.title.toLowerCase().includes(query) ||
            (p.property_code || "").toLowerCase().includes(query)
        );
        if (matchedProp) {
          finalPropertyId = matchedProp.id;
        }
      }
    }

    // Bidirectional auto-link: tagging a contact pulls in the property
    // they inquired about, and tagging a property pulls in the contact
    // linked to it.
    const linked = autoLinkContactProperty(
      finalContactId ? contacts.find((c) => c.id === finalContactId) || null : null,
      finalPropertyId ? properties.find((p) => p.id === finalPropertyId) || null : null,
      contacts,
      properties
    );

    return { contactId: linked.contact?.id || null, propertyId: linked.property?.id || null };
  }, [contacts, properties]);

  // Appointment modal pickers with the same bidirectional auto-link:
  // picking a contact fills the property they inquired about, picking
  // a property pulls in the contact linked to it.
  const handleApptContactsChange = (ids: string[]) => {
    setApptContactIds(ids);
    if (!apptPropertyId) {
      const hit = linkedPropertyForContacts(ids, contacts, properties);
      if (hit) {
        setApptPropertyId(hit.property.id);
        toast.info(`Linked property "${hit.property.title}" from ${hit.contact.name}'s inquiry`);
      }
    }
  };

  const handleApptPropertyChange = (val: string | null) => {
    setApptPropertyId(val || "");
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
      toast.error("Please enter a task name");
      return;
    }

    try {
      const { contactId, propertyId } = resolveMentions(todoTitle);

      const { error } = await supabase.from("todos").insert({
        title: todoTitle,
        description: todoDesc || null,
        due_date: todoDueDate ? new Date(todoDueDate).toISOString() : null,
        priority: todoPriority,
        completed: false,
        account_id: accountId,
        user_id: (await supabase.auth.getUser()).data.user?.id,
        contact_id: contactId,
        property_id: propertyId,
      });

      if (error) throw error;
      toast.success("Task added successfully");
      setTodoTitle("");
      setTodoDesc("");
      setTodoDueDate("");
      setTodoPriority("medium");
      setMentionType(null);
      setMentionSearch("");
      loadData();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      toast.error(errorMessage || "Failed to add task");
    }
  };

  const openEditTodoModal = (todo: Todo) => {
    setSelectedTodo(todo);
    setEditTodoTitle(todo.title);
    setEditTodoDesc(todo.description || "");
    setEditTodoDueDate(todo.due_date ? todo.due_date.substring(0, 10) : "");
    setEditTodoPriority(todo.priority);
    setEditTodoCompleted(todo.completed);
    setIsTodoModalOpen(true);
  };

  const updateTodo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTodo) return;
    if (!editTodoTitle.trim()) {
      toast.error("Please enter a task name");
      return;
    }

    try {
      const { contactId, propertyId } = resolveMentions(editTodoTitle);

      const { error } = await supabase
        .from("todos")
        .update({
          title: editTodoTitle,
          description: editTodoDesc || null,
          due_date: editTodoDueDate ? new Date(editTodoDueDate).toISOString() : null,
          priority: editTodoPriority,
          completed: editTodoCompleted,
          contact_id: contactId,
          property_id: propertyId,
        })
        .eq("id", selectedTodo.id)
        .eq("account_id", accountId);

      if (error) throw error;
      toast.success("Task updated successfully");
      setIsTodoModalOpen(false);
      setSelectedTodo(null);
      loadData();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      toast.error(errorMessage || "Failed to update task");
    }
  };

  const handleGoToChat = async (contactId: string) => {
    try {
      // Find existing conversation
      const { data: existing, error } = await supabase
        .from("conversations")
        .select("id")
        .eq("account_id", accountId)
        .eq("contact_id", contactId)
        .maybeSingle();

      if (error) throw error;

      if (existing) {
        window.location.href = `/inbox?c=${existing.id}`;
      } else {
        // Create conversation
        const { data: newConv, error: createError } = await supabase
          .from("conversations")
          .insert({
            account_id: accountId,
            user_id: (await supabase.auth.getUser()).data.user?.id,
            contact_id: contactId,
          })
          .select("id")
          .single();

        if (createError) throw createError;
        window.location.href = `/inbox?c=${newConv.id}`;
      }
    } catch (err) {
      console.error("Failed to open chat:", err);
      toast.error("Failed to open conversation");
    }
  };

  const toggleTodo = async (todo: Todo) => {
    try {
      if (todo.isAppointment) {
        const appt = appointments.find((a) => a.id === todo.id);
        if (!appt) return;
        const newStatus = appt.status === "completed" ? "scheduled" : "completed";
        const { error } = await supabase
          .from("appointments")
          .update({ status: newStatus })
          .eq("id", appt.id)
          .eq("account_id", accountId);

        if (error) throw error;
        toast.success(`Appointment marked as ${newStatus}`);
        loadData();
        return;
      }

      const { error } = await supabase
        .from("todos")
        .update({ completed: !todo.completed })
        .eq("id", todo.id)
        .eq("account_id", accountId);

      if (error) throw error;
      loadData();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      toast.error(errorMessage || "Failed to toggle task");
    }
  };

  const deleteTodo = async (id: string) => {
    try {
      const { error } = await supabase
        .from("todos")
        .delete()
        .eq("id", id)
        .eq("account_id", accountId);

      if (error) throw error;
      loadData();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      toast.error(errorMessage || "Failed to delete task");
    }
  };

  const memberByUserId = useMemo(() => {
    const map: Record<string, TeamMember> = {};
    for (const m of members) map[m.user_id] = m;
    return map;
  }, [members]);

  const headerLabel =
    view === "agenda"
      ? "All Scheduled Events"
      : view === "month"
        ? `${monthNames[month]} ${year}`
        : currentDate.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="space-y-6 relative overflow-hidden h-full flex flex-col">
      {/* Header */}
      <div className="relative z-10 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
            Calendar
          </h1>
          <p className="mt-1.5 text-xs sm:text-sm text-slate-400 font-medium leading-relaxed">
            Log site visits, calls, and follow-ups by typing or speaking — and see the whole team&apos;s day at a glance.
          </p>
        </div>
        <FavoriteButton label="Calendar" href="/calendar" icon="Calendar" />
      </div>

      {/* Smart quick-add (text + voice) */}
      <div className="relative z-30">
        <SmartAddBar onConfirm={handleSmartConfirm} />
      </div>

      <div className="flex flex-col gap-6 lg:h-full lg:flex-row overflow-hidden flex-1">
        {/* ── Left Side: Calendar views ────────────────── */}
        {/* `min-w-0`: this is a flex-row item on lg+, and without it the
            pane is only kept from bleeding by the ancestor's
            overflow-hidden — self-cap it so inner truncate engages. */}
        <div className="flex flex-1 flex-col min-w-0 rounded-xl border border-slate-800 bg-slate-900/50 p-6 backdrop-blur min-h-[560px] lg:min-h-0">
          {/* Calendar Header Nav */}
          <div className="mb-4 flex flex-col justify-between gap-4 xl:flex-row xl:items-center">
            <div className="flex items-center gap-3">
              <CalendarIcon className="h-6 w-6 text-primary" />
              <h1 className="text-xl font-bold text-white sm:text-2xl flex items-center">
                {headerLabel}
                <InfoHint text="Navigate and schedule site visits, client appointments, or phone calls. Use the Team view to see every member's lane for the day." />
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* View switcher */}
              <div className="flex items-center rounded-lg border border-slate-800 bg-slate-950 p-0.5">
                {([
                  { key: "month", label: "Month", icon: LayoutGrid },
                  { key: "week", label: "Week", icon: Columns3 },
                  { key: "team", label: "Team", icon: Users },
                  { key: "agenda", label: "Agenda", icon: List },
                ] as { key: ViewMode; label: string; icon: typeof Users }[]).map((v) => (
                  <button
                    key={v.key}
                    onClick={() => setView(v.key)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors",
                      view === v.key ? "bg-primary/15 text-primary" : "text-slate-400 hover:text-white"
                    )}
                  >
                    <v.icon className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">{v.label}</span>
                  </button>
                ))}
              </div>

              {view !== "agenda" && (
                <>
                  <button
                    onClick={handleToday}
                    className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-850 hover:text-white"
                  >
                    Today
                  </button>
                  <div className="flex items-center rounded-lg border border-slate-800 bg-slate-950 p-1">
                    <button
                      onClick={handlePrev}
                      aria-label="Previous"
                      className="rounded p-1 text-slate-400 hover:bg-slate-850 hover:text-white"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <button
                      onClick={handleNext}
                      aria-label="Next"
                      className="rounded p-1 text-slate-400 hover:bg-slate-850 hover:text-white"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </>
              )}
              <button
                onClick={() => openNewApptModal()}
                className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90"
              >
                <Plus className="h-3.5 w-3.5" />
                Schedule
              </button>
            </div>
          </div>

          {/* Type legend + member filter */}
          <div className="mb-4 flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => setTypeFilter("all")}
              className={cn(
                "rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors",
                typeFilter === "all"
                  ? "border-primary/50 bg-primary/15 text-primary"
                  : "border-slate-800 text-slate-400 hover:text-white"
              )}
            >
              All
            </button>
            {EVENT_TYPE_KEYS.map((key) => {
              const meta = EVENT_TYPES[key];
              return (
                <button
                  key={key}
                  onClick={() => setTypeFilter(typeFilter === key ? "all" : key)}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors",
                    typeFilter === key ? meta.chip : "border-slate-800 text-slate-500 hover:text-white"
                  )}
                >
                  <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
                  {meta.label}
                </button>
              );
            })}
            {members.length > 1 && (
              <select
                value={memberFilter}
                onChange={(e) => setMemberFilter(e.target.value)}
                className="ml-auto rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-[10px] font-bold text-slate-400 focus:outline-none cursor-pointer"
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
              <CalendarLoader size={104} label="Loading calendar" className="mb-3" />
              <ConvoRealLoader size={20} className="mb-2" />
              <p className="text-sm">Loading calendar...</p>
            </div>
          ) : view === "team" ? (
            <TeamView
              events={filteredAppointments}
              members={memberFilter === "all" ? members : members.filter((m) => m.user_id === memberFilter)}
              selectedDate={currentDate}
              onSelectDate={setCurrentDate}
              onEventClick={openEditApptModal}
              onSlotClick={(date, assignedTo) => openNewApptModal(date, assignedTo)}
            />
          ) : view === "week" ? (
            <WeekView
              events={filteredAppointments}
              members={members}
              selectedDate={currentDate}
              onEventClick={openEditApptModal}
              onSlotClick={(date) => openNewApptModal(date)}
            />
          ) : view === "agenda" ? (
            <AgendaView
              events={filteredAppointments}
              members={members}
              onEventClick={openEditApptModal}
            />
          ) : (
            <>
              {/* Days of the Week headings */}
              <div className="grid grid-cols-7 border-b border-slate-800 pb-2 text-center text-xs font-bold uppercase tracking-wider text-slate-400">
                <div>Sun</div>
                <div>Mon</div>
                <div>Tue</div>
                <div>Wed</div>
                <div>Thu</div>
                <div>Fri</div>
                <div>Sat</div>
              </div>

              {/* Calendar Day Grid */}
              <div className="grid flex-1 grid-cols-7 grid-rows-6 gap-px bg-slate-800/40 mt-1 min-h-[420px]">
                {calendarCells.map((cell, idx) => {
                  const dateStr = cell.date.toDateString();
                  const cellAppts = appointmentsByDate[dateStr] || [];
                  const isToday = new Date().toDateString() === dateStr;

                  return (
                    <div
                      key={idx}
                      onClick={() => openNewApptModal(cell.date)}
                      className={cn(
                        "group relative flex flex-col min-h-[70px] bg-slate-950 p-2 transition-colors hover:bg-slate-900/60 cursor-pointer overflow-hidden",
                        !cell.isCurrentMonth && "opacity-45"
                      )}
                    >
                      {/* Day Number Label */}
                      <span
                        className={cn(
                          "text-xs font-bold inline-flex items-center justify-center h-5 w-5 rounded-full mb-1",
                          isToday
                            ? "bg-primary text-primary-foreground font-black"
                            : "text-slate-400 group-hover:text-white"
                        )}
                      >
                        {cell.day}
                      </span>

                      {/* Appointments indicators inside cell */}
                      <div className="flex flex-col gap-1 overflow-y-auto max-h-[80px]">
                        {cellAppts.map((appt) => {
                          const meta = eventTypeMeta(appt.event_type);
                          const assignee = memberByUserId[appt.assigned_to || appt.user_id];
                          return (
                            <div
                              key={appt.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                openEditApptModal(appt);
                              }}
                              className={cn(
                                "flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border leading-snug cursor-pointer transition-colors",
                                meta.chip,
                                appt.status === "completed" && "opacity-60",
                                appt.status === "cancelled" && "line-through opacity-50"
                              )}
                            >
                              <meta.icon className="h-2.5 w-2.5 shrink-0" />
                              <span className="truncate flex-1">{appt.title}</span>
                              {appt.reschedule_requested_at && (
                                <RefreshCcw
                                  className="h-2.5 w-2.5 shrink-0 text-amber-400"
                                  aria-label="Reschedule requested"
                                />
                              )}
                              {!appt.reschedule_requested_at && appt.client_confirmed_at && (
                                <CheckCircle
                                  className="h-2.5 w-2.5 shrink-0 text-emerald-400"
                                  aria-label="Client confirmed"
                                />
                              )}
                              {members.length > 1 && assignee && (
                                <span
                                  className="rounded bg-slate-900/70 px-1 text-[8px] font-bold shrink-0"
                                  title={assignee.full_name}
                                >
                                  {memberInitials(assignee.full_name)}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* ── Right Side: Interactive To-Do Checklist Panel ────────────────── */}
        <div className="flex w-full flex-col gap-6 lg:w-80 shrink-0">
          {/* To-Do panel */}
          <div className="flex flex-1 flex-col rounded-xl border border-slate-800 bg-slate-900/50 p-6 backdrop-blur overflow-hidden">
            <div className="mb-4 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ListTodo className="h-5 w-5 text-primary" />
                <h2 className="text-sm font-bold text-white flex items-center">
                  To-Do Task List
                  <InfoHint text="A checklist of operational tasks. You can tag contacts using '@' or properties using '#' directly in task titles." />
                </h2>
              </div>
              <select
                value={todoFilter}
                onChange={(e) => setTodoFilter(e.target.value as "all" | "priority")}
                className="rounded border border-slate-800 bg-slate-950 px-2 py-0.5 text-[10px] font-bold text-slate-400 focus:outline-none cursor-pointer"
              >
                <option value="all">All Tasks</option>
                <option value="priority">Priority Only</option>
              </select>
            </div>

            {/* Quick task add form */}
            <form onSubmit={saveTodo} className="mb-4 flex flex-col gap-2 border-b border-slate-800 pb-4 relative">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Add new task..."
                  value={todoTitle}
                  onChange={handleTodoTitleChange}
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-primary focus:outline-none"
                />

                {/* Autocomplete dropdown overlay */}
                {mentionType && (
                  <div className="absolute left-0 right-0 z-50 mt-1 max-h-48 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950 p-1 shadow-xl">
                    {mentionType === "contact" ? (
                      filteredContacts.length === 0 ? (
                        <div className="px-3 py-2 text-xs text-slate-500">No matching contacts</div>
                      ) : (
                        filteredContacts.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => selectMention(c.name, c.id, "contact")}
                            className="w-full text-left px-3 py-1.5 text-xs text-slate-300 rounded hover:bg-slate-800 hover:text-white"
                          >
                            <span className="inline-flex items-center gap-1.5">
                              {c.name} ({c.phone}) <NameTagBadge tag={c.name_tag} />
                            </span>
                          </button>
                        ))
                      )
                    ) : (
                      filteredProperties.length === 0 ? (
                        <div className="px-3 py-2 text-xs text-slate-500">No matching properties</div>
                      ) : (
                        filteredProperties.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => selectMention(p.title, p.id, "property")}
                            className="w-full text-left px-3 py-1.5 text-xs text-slate-300 rounded hover:bg-slate-800 hover:text-white"
                          >
                            {p.property_code ? `[${p.property_code}] ` : ""}{p.title}
                          </button>
                        ))
                      )
                    )}
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <select
                  value={todoPriority}
                  onChange={(e) => setTodoPriority(e.target.value as "low" | "medium" | "high")}
                  className="flex-1 rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-300 focus:border-primary focus:outline-none"
                >
                  <option value="low">Low Priority</option>
                  <option value="medium">Medium Priority</option>
                  <option value="high">High Priority</option>
                </select>
                <button
                  type="submit"
                  className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90"
                >
                  Add
                </button>
              </div>
            </form>

            {/* Task checklist */}
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {combinedTodos.length === 0 ? (
                <div className="flex h-32 flex-col items-center justify-center text-center text-slate-500">
                  <p className="text-xs">No pending tasks!</p>
                </div>
              ) : (
                combinedTodos.map((todo) => (
                  <div
                    key={todo.id}
                    className={cn(
                      "group flex items-start justify-between gap-3 p-2.5 rounded-lg border bg-slate-950/40 transition-colors hover:bg-slate-950/80",
                      todo.completed ? "border-slate-800 opacity-60" : "border-slate-800/80"
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

                    <div className="flex-1 min-w-0">
                      <p
                        className={cn(
                          "text-xs font-semibold text-white leading-normal break-words",
                          todo.completed && "line-through text-slate-500 font-normal"
                        )}
                      >
                        {renderTodoTitle(todo)}
                      </p>
                      {todo.description && (
                        <p
                          className={cn(
                            "text-[10px] text-slate-400 mt-1 break-words line-clamp-2 leading-relaxed group-hover:line-clamp-none transition-all duration-300",
                            todo.completed && "line-through text-slate-650"
                          )}
                        >
                          {todo.description}
                        </p>
                      )}
                      {todo.priority && !todo.completed && (
                        <span
                          className={cn(
                            "inline-block rounded px-1.5 py-0.5 text-[8px] font-bold uppercase mt-1",
                            todo.priority === "high"
                              ? "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                              : todo.priority === "medium"
                                ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                                : "bg-slate-800 text-slate-400"
                          )}
                        >
                          {todo.priority}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      {todo.contact_id && (
                        <button
                          onClick={() => handleGoToChat(todo.contact_id!)}
                          className="text-slate-500 hover:text-emerald-400 transition-colors p-0.5"
                          title="Go to WhatsApp Chat Inbox"
                          aria-label="Open Chat"
                        >
                          <MessageSquare className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button
                        onClick={() => {
                          if (todo.isAppointment) {
                            const appt = appointments.find((a) => a.id === todo.id);
                            if (appt) openEditApptModal(appt);
                          } else {
                            openEditTodoModal(todo);
                          }
                        }}
                        className="text-slate-500 hover:text-white transition-colors p-0.5"
                        title="Edit task"
                        aria-label="Edit task"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => {
                          if (todo.isAppointment) {
                            const appt = appointments.find((a) => a.id === todo.id);
                            if (appt) deleteAppointment(appt);
                          } else {
                            deleteTodo(todo.id);
                          }
                        }}
                        className="text-slate-500 hover:text-rose-450 transition-colors p-0.5"
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
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm overflow-y-auto">
            <div className="w-full max-w-lg rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-2xl my-auto max-h-[calc(100vh-2rem)] overflow-y-auto">
              {/* Modal Header */}
              <div className="mb-4 flex items-center justify-between border-b border-slate-800 pb-3">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <CalendarDays className="h-5 w-5 text-primary" />
                  {selectedAppt ? "Edit Schedule" : "Schedule Appointment"}
                </h3>
                <button
                  onClick={() => setIsApptModalOpen(false)}
                  className="text-slate-400 hover:text-white"
                  aria-label="Close modal"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {!selectedAppt?.reschedule_requested_at && selectedAppt?.client_confirmed_at && (
                <div className="mb-4 flex items-center gap-2 rounded-lg border border-emerald-600/40 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-300">
                  <CheckCircle className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    Client confirmed on{" "}
                    {new Date(selectedAppt.client_confirmed_at).toLocaleString("en-IN", {
                      day: "2-digit",
                      month: "short",
                      hour: "numeric",
                      minute: "2-digit",
                      hour12: true,
                    })}
                    {" "}via the reminder&apos;s &ldquo;Fine&rdquo; button.
                  </span>
                </div>
              )}
              {selectedAppt?.reschedule_requested_at && (
                <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-600/40 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
                  <RefreshCcw className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    Client requested a reschedule on{" "}
                    {new Date(selectedAppt.reschedule_requested_at).toLocaleString("en-IN", {
                      day: "2-digit",
                      month: "short",
                      hour: "numeric",
                      minute: "2-digit",
                      hour12: true,
                    })}
                    . Changing the time below will clear this notice.
                  </span>
                </div>
              )}

              {/* Modal Form */}
              <form onSubmit={saveAppointment} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                    Visit / Title *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Site Visit - JP Nagar Plot"
                    value={apptTitle}
                    onChange={(e) => setApptTitle(e.target.value)}
                    className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-primary focus:outline-none"
                  />
                </div>

                {/* Event type chips */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
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
                            "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-semibold transition-colors",
                            apptEventType === key ? meta.chip : "border-slate-800 text-slate-500 hover:text-white"
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
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                      Assign To
                    </label>
                    <select
                      value={apptAssignedTo}
                      onChange={(e) => setApptAssignedTo(e.target.value)}
                      className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-primary focus:outline-none"
                    >
                      {members.map((m) => (
                        <option key={m.user_id} value={m.user_id}>
                          {m.full_name}
                          {m.user_id === user?.id ? " (me)" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                      Link Contacts (buyer, agent…)
                    </label>
                    <SearchableContactMultiSelect
                      contacts={contacts}
                      value={apptContactIds}
                      onChange={handleApptContactsChange}
                      placeholder="Search contacts..."
                    />
                    <p className="mt-1 text-[10px] text-slate-500 font-medium">
                      Reminders go to every linked contact — 7 AM on the day &amp; 1 hour before.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
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
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                      Start Time *
                    </label>
                    <DateTimePicker
                      value={apptStartTime}
                      onChange={(val) => setApptStartTime(val)}
                      align="left"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
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
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                    Location / Meeting Link
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. JP Nagar 5th Phase, or Google Meet URL"
                    value={apptLocation}
                    onChange={(e) => setApptLocation(e.target.value)}
                    className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-primary focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                    Notes / Description
                  </label>
                  <textarea
                    placeholder="Additional details regarding the client's interests, host requirements..."
                    value={apptDesc}
                    onChange={(e) => setApptDesc(e.target.value)}
                    rows={3}
                    className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-primary focus:outline-none"
                  />
                </div>

                {/* Type-specific notes: agenda before the event, minutes /
                    outcome once it exists. Post fields only show when
                    editing — there's nothing to log before it happens. */}
                {eventTypeFields(apptEventType)
                  .filter((f) => f.phase === "pre" || !!selectedAppt)
                  .map((f) => (
                    <div key={f.key}>
                      <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                        {f.label}
                        {f.phase === "pre" ? (
                          <span className="ml-1.5 normal-case font-semibold text-slate-500">
                            — sent in the pre-event reminder
                          </span>
                        ) : (
                          <span className="ml-1.5 normal-case font-semibold text-slate-500">
                            — fill in after the event
                          </span>
                        )}
                      </label>
                      <textarea
                        placeholder={f.placeholder}
                        value={apptExtras[f.key]}
                        onChange={(e) =>
                          setApptExtras((prev) => ({ ...prev, [f.key]: e.target.value }))
                        }
                        rows={2}
                        className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-primary focus:outline-none"
                      />
                    </div>
                  ))}

                {selectedAppt?.transcript && (
                  <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                    <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      <AudioLines className="h-3 w-3" />
                      Logged {selectedAppt.source === "voice" ? "by voice" : "via WhatsApp"}
                    </p>
                    <p className="mt-1 text-[11px] italic text-slate-400">&ldquo;{selectedAppt.transcript}&rdquo;</p>
                  </div>
                )}

                <div className="flex items-center justify-between border-t border-slate-800 pt-4 mt-2">
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
                        onChange={(e) => setApptStatus(e.target.value as "scheduled" | "completed" | "cancelled")}
                        className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-primary focus:outline-none"
                      >
                        <option value="scheduled">Scheduled</option>
                        <option value="completed">Completed</option>
                        <option value="cancelled">Cancelled</option>
                      </select>
                    )}
                    <button
                      type="submit"
                      className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
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
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm overflow-y-auto">
            <div className="w-full max-w-lg rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-2xl my-auto max-h-[calc(100vh-2rem)] overflow-y-auto">
              {/* Modal Header */}
              <div className="mb-4 flex items-center justify-between border-b border-slate-800 pb-3">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <ListTodo className="h-5 w-5 text-primary" />
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
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                    Task Name *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Call @Customer name"
                    value={editTodoTitle}
                    onChange={(e) => setEditTodoTitle(e.target.value)}
                    className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-primary focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                    Description / Notes
                  </label>
                  <textarea
                    placeholder="Task details..."
                    value={editTodoDesc}
                    onChange={(e) => setEditTodoDesc(e.target.value)}
                    rows={3}
                    className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-primary focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                      Due Date
                    </label>
                    <input
                      type="date"
                      value={editTodoDueDate}
                      onChange={(e) => setEditTodoDueDate(e.target.value)}
                      className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-primary focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                      Priority
                    </label>
                    <select
                      value={editTodoPriority}
                      onChange={(e) => setEditTodoPriority(e.target.value as "low" | "medium" | "high")}
                      className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-primary focus:outline-none"
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
                    className="rounded border-slate-700 bg-slate-950 text-primary focus:ring-0 focus:ring-offset-0 h-4 w-4 cursor-pointer"
                  />
                  <label htmlFor="edit-todo-completed" className="text-sm font-semibold text-slate-350 cursor-pointer select-none">
                    Mark as Completed
                  </label>
                </div>

                <div className="flex items-center justify-between border-t border-slate-800 pt-4 mt-2">
                  <div>
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm("Are you sure you want to delete this task?")) {
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
                      className="rounded-lg border border-slate-800 bg-slate-950 px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-slate-850 hover:text-white"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
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
