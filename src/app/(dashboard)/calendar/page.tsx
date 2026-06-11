"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Clock,
  MapPin,
  Plus,
  Trash2,
  CheckCircle,
  Circle,
  AlertTriangle,
  User,
  Home,
  X,
  CalendarDays,
  ListTodo
} from "lucide-react";
import { toast } from "sonner";

interface Appointment {
  id: string;
  account_id: string;
  user_id: string;
  title: string;
  description: string | null;
  start_time: string;
  end_time: string;
  location: string | null;
  status: "scheduled" | "completed" | "cancelled";
  contact_id: string | null;
  property_id: string | null;
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
}

export default function CalendarPage() {
  const supabase = createClient();
  const { accountId } = useAuth();

  const [currentDate, setCurrentDate] = useState(new Date());
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [properties, setProperties] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Modals state
  const [isApptModalOpen, setIsApptModalOpen] = useState(false);
  const [selectedAppt, setSelectedAppt] = useState<Appointment | null>(null);

  // Appointment Form state
  const [apptTitle, setApptTitle] = useState("");
  const [apptDesc, setApptDesc] = useState("");
  const [apptContactId, setApptContactId] = useState("");
  const [apptPropertyId, setApptPropertyId] = useState("");
  const [apptStartTime, setApptStartTime] = useState("");
  const [apptEndTime, setApptEndTime] = useState("");
  const [apptLocation, setApptLocation] = useState("");
  const [apptStatus, setApptStatus] = useState<"scheduled" | "completed" | "cancelled">("scheduled");

  // Todo Form state
  const [todoTitle, setTodoTitle] = useState("");
  const [todoDesc, setTodoDesc] = useState("");
  const [todoDueDate, setTodoDueDate] = useState("");
  const [todoPriority, setTodoPriority] = useState<"low" | "medium" | "high">("medium");

  // Mentions Form state
  const [mentionType, setMentionType] = useState<"contact" | "property" | null>(null);
  const [mentionSearch, setMentionSearch] = useState("");

  // Fetch appointments and todos
  const loadData = async () => {
    try {
      setLoading(true);

      // Fetch appointments
      const { data: appts, error: apptError } = await supabase
        .from("appointments")
        .select("*, contact:contacts(id, name, phone), property:properties(id, title, location, sublocality)")
        .eq("account_id", accountId)
        .order("start_time", { ascending: true });

      if (apptError) throw apptError;
      setAppointments(appts || []);

      // Fetch todos
      const { data: todoList, error: todoError } = await supabase
        .from("todos")
        .select("*, contact:contacts(id, name, phone), property:properties(id, title, location, sublocality)")
        .eq("account_id", accountId)
        .order("created_at", { ascending: true });

      if (todoError) throw todoError;
      setTodos(todoList || []);

      // Fetch contacts
      const { data: contactsList } = await supabase
        .from("contacts")
        .select("id, name, phone")
        .eq("account_id", accountId)
        .order("name");
      setContacts(contactsList || []);

      // Fetch properties
      const { data: propsList } = await supabase
        .from("properties")
        .select("id, title, location, sublocality")
        .eq("account_id", accountId)
        .order("title");
      setProperties(propsList || []);
    } catch (err: any) {
      toast.error(err.message || "Failed to load calendar data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (accountId) {
      loadData();
    }
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
    
    // Add prev month trailing days
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      cells.push({
        day: prevDaysInMonth - i,
        isCurrentMonth: false,
        date: new Date(year, month - 1, prevDaysInMonth - i)
      });
    }

    // Add current month days
    for (let i = 1; i <= daysInMonth; i++) {
      cells.push({
        day: i,
        isCurrentMonth: true,
        date: new Date(year, month, i)
      });
    }

    // Add next month leading days to complete grid (multiples of 7)
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

  // Group appointments by date string
  const appointmentsByDate = useMemo(() => {
    const map: Record<string, Appointment[]> = {};
    appointments.forEach((appt) => {
      const dateStr = new Date(appt.start_time).toDateString();
      if (!map[dateStr]) map[dateStr] = [];
      map[dateStr].push(appt);
    });
    return map;
  }, [appointments]);

  // Date Nav handlers
  const handlePrevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
  };

  const handleToday = () => {
    setCurrentDate(new Date());
  };

  // Appointment modal edit/create
  const openNewApptModal = (date?: Date) => {
    setSelectedAppt(null);
    setApptTitle("");
    setApptDesc("");
    setApptContactId("");
    setApptPropertyId("");
    setApptLocation("");
    setApptStatus("scheduled");

    const start = date ? new Date(date) : new Date();
    start.setHours(10, 0, 0, 0); // Default to 10:00 AM
    const end = new Date(start);
    end.setHours(11, 0, 0, 0); // Default 1 hour duration

    // Format for datetime-local value (YYYY-MM-DDTHH:MM)
    const pad = (n: number) => String(n).padStart(2, "0");
    const formatDateTime = (d: Date) => 
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

    setApptStartTime(formatDateTime(start));
    setApptEndTime(formatDateTime(end));
    setIsApptModalOpen(true);
  };

  const openEditApptModal = (appt: Appointment) => {
    setSelectedAppt(appt);
    setApptTitle(appt.title);
    setApptDesc(appt.description || "");
    setApptContactId(appt.contact_id || "");
    setApptPropertyId(appt.property_id || "");
    setApptLocation(appt.location || "");
    setApptStatus(appt.status);

    const pad = (n: number) => String(n).padStart(2, "0");
    const formatDateTime = (d: Date) => 
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

    setApptStartTime(formatDateTime(new Date(appt.start_time)));
    setApptEndTime(formatDateTime(new Date(appt.end_time)));
    setIsApptModalOpen(true);
  };

  const saveAppointment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apptTitle.trim()) {
      toast.error("Please enter a title");
      return;
    }

    try {
      const payload = {
        title: apptTitle,
        description: apptDesc || null,
        start_time: new Date(apptStartTime).toISOString(),
        end_time: new Date(apptEndTime).toISOString(),
        location: apptLocation || null,
        status: apptStatus,
        contact_id: apptContactId || null,
        property_id: apptPropertyId || null,
      };

      if (selectedAppt) {
        // Edit mode
        const { error } = await supabase
          .from("appointments")
          .update(payload)
          .eq("id", selectedAppt.id)
          .eq("account_id", accountId);

        if (error) throw error;
        toast.success("Appointment updated successfully");
      } else {
        // Create mode
        const { error } = await supabase
          .from("appointments")
          .insert({
            ...payload,
            account_id: accountId,
            user_id: (await supabase.auth.getUser()).data.user?.id,
          });

        if (error) throw error;
        toast.success("Appointment scheduled successfully");
      }

      setIsApptModalOpen(false);
      loadData();
    } catch (err: any) {
      toast.error(err.message || "Failed to save appointment");
    }
  };

  const deleteAppointment = async () => {
    if (!selectedAppt) return;
    if (!confirm("Are you sure you want to cancel and delete this appointment?")) return;

    try {
      const { error } = await supabase
        .from("appointments")
        .delete()
        .eq("id", selectedAppt.id)
        .eq("account_id", accountId);

      if (error) throw error;
      toast.success("Appointment deleted successfully");
      setIsApptModalOpen(false);
      loadData();
    } catch (err: any) {
      toast.error(err.message || "Failed to delete appointment");
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
      .filter((p) => p.title.toLowerCase().includes(searchVal))
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

    let elements: React.ReactNode[] = [];
    const matches: { start: number; end: number; type: "contact" | "property"; label: string; url: string }[] = [];

    if (contactName && title.includes(`@${contactName}`)) {
      const start = title.indexOf(`@${contactName}`);
      matches.push({
        start,
        end: start + `@${contactName}`.length,
        type: "contact",
        label: `@${contactName}`,
        url: `/contacts?search=${encodeURIComponent(contactName)}`,
      });
    }

    if (propertyTitle && title.includes(`#${propertyTitle}`)) {
      const start = title.indexOf(`#${propertyTitle}`);
      matches.push({
        start,
        end: start + `#${propertyTitle}`.length,
        type: "property",
        label: `#${propertyTitle}`,
        url: `/inventory?search=${encodeURIComponent(propertyTitle)}`,
      });
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
            "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold transition-all mx-0.5 whitespace-nowrap",
            match.type === "contact"
              ? cn(
                  "bg-violet-500/10 text-violet-400 border border-violet-500/20",
                  todo.completed ? "opacity-50 line-through" : "hover:bg-violet-500/25"
                )
              : cn(
                  "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20",
                  todo.completed ? "opacity-50 line-through" : "hover:bg-emerald-500/25"
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

  // Todo CRUD handlers
  const saveTodo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!todoTitle.trim()) {
      toast.error("Please enter a task name");
      return;
    }

    try {
      let finalContactId = null;
      const sortedContacts = [...contacts].sort((a, b) => b.name.length - a.name.length);
      for (const c of sortedContacts) {
        if (todoTitle.includes(`@${c.name}`)) {
          finalContactId = c.id;
          break;
        }
      }

      let finalPropertyId = null;
      const sortedProps = [...properties].sort((a, b) => b.title.length - a.title.length);
      for (const p of sortedProps) {
        if (todoTitle.includes(`#${p.title}`)) {
          finalPropertyId = p.id;
          break;
        }
      }

      const { error } = await supabase.from("todos").insert({
        title: todoTitle,
        description: todoDesc || null,
        due_date: todoDueDate ? new Date(todoDueDate).toISOString() : null,
        priority: todoPriority,
        completed: false,
        account_id: accountId,
        user_id: (await supabase.auth.getUser()).data.user?.id,
        contact_id: finalContactId,
        property_id: finalPropertyId,
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
    } catch (err: any) {
      toast.error(err.message || "Failed to add task");
    }
  };

  const toggleTodo = async (todo: Todo) => {
    try {
      const { error } = await supabase
        .from("todos")
        .update({ completed: !todo.completed })
        .eq("id", todo.id)
        .eq("account_id", accountId);

      if (error) throw error;
      loadData();
    } catch (err: any) {
      toast.error(err.message || "Failed to toggle task");
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
    } catch (err: any) {
      toast.error(err.message || "Failed to delete task");
    }
  };

  return (
    <div className="flex flex-col gap-6 lg:h-full lg:flex-row overflow-hidden">
      {/* ── Left Side: Interactive Calendar Monthly View ────────────────── */}
      <div className="flex flex-1 flex-col rounded-xl border border-slate-800 bg-slate-900/50 p-6 backdrop-blur">
        {/* Calendar Header Nav */}
        <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div className="flex items-center gap-3">
            <CalendarIcon className="h-6 w-6 text-primary" />
            <h1 className="text-xl font-bold text-white sm:text-2xl">
              {monthNames[month]} {year}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleToday}
              className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-850 hover:text-white"
            >
              Today
            </button>
            <div className="flex items-center rounded-lg border border-slate-800 bg-slate-950 p-1">
              <button
                onClick={handlePrevMonth}
                aria-label="Previous month"
                className="rounded p-1 text-slate-400 hover:bg-slate-850 hover:text-white"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={handleNextMonth}
                aria-label="Next month"
                className="rounded p-1 text-slate-400 hover:bg-slate-850 hover:text-white"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <button
              onClick={() => openNewApptModal()}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90"
            >
              <Plus className="h-3.5 w-3.5" />
              Schedule Visit
            </button>
          </div>
        </div>

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
          {loading ? (
            <div className="col-span-7 row-span-6 flex items-center justify-center bg-slate-900/10">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : (
            calendarCells.map((cell, idx) => {
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
                    {cellAppts.map((appt) => (
                      <div
                        key={appt.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          openEditApptModal(appt);
                        }}
                        className={cn(
                          "truncate text-[10px] px-1.5 py-0.5 rounded border leading-snug cursor-pointer transition-colors",
                          appt.status === "completed"
                            ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20"
                            : appt.status === "cancelled"
                              ? "bg-rose-500/10 border-rose-500/30 text-rose-400 line-through hover:bg-rose-500/20"
                              : "bg-primary/10 border-primary/30 text-primary hover:bg-primary/20"
                        )}
                      >
                        {appt.title}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── Right Side: Interactive To-Do Checklist Panel ────────────────── */}
      <div className="flex w-full flex-col gap-6 lg:w-80 shrink-0">
        {/* To-Do panel */}
        <div className="flex flex-1 flex-col rounded-xl border border-slate-800 bg-slate-900/50 p-6 backdrop-blur overflow-hidden">
          <div className="mb-4 flex items-center gap-2">
            <ListTodo className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-bold text-white">To-Do Task List</h2>
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
                          {c.name} ({c.phone})
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
                          {p.title}
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
                onChange={(e) => setTodoPriority(e.target.value as any)}
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
            {todos.length === 0 ? (
              <div className="flex h-32 flex-col items-center justify-center text-center text-slate-500">
                <p className="text-xs">No pending tasks!</p>
              </div>
            ) : (
              todos.map((todo) => (
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

                  <button
                    onClick={() => deleteTodo(todo.id)}
                    className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-rose-400 transition-opacity p-0.5"
                    aria-label="Delete task"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* ── Appointment Edit/Create Dialog Modal Overlay ────────────────── */}
      {isApptModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
            {/* Modal Header */}
            <div className="mb-4 flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <CalendarDays className="h-5 w-5 text-primary" />
                {selectedAppt ? "Edit Scheduled Visit" : "Schedule Property Visit"}
              </h3>
              <button
                onClick={() => setIsApptModalOpen(false)}
                className="text-slate-400 hover:text-white"
                aria-label="Close modal"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

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

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                    Link Client / Contact
                  </label>
                  <select
                    value={apptContactId}
                    onChange={(e) => setApptContactId(e.target.value)}
                    className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-primary focus:outline-none"
                  >
                    <option value="">-- Select Contact --</option>
                    {contacts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.phone})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                    Link Property Listing
                  </label>
                  <select
                    value={apptPropertyId}
                    onChange={(e) => setApptPropertyId(e.target.value)}
                    className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-primary focus:outline-none"
                  >
                    <option value="">-- Select Property --</option>
                    {properties.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                    Start Time *
                  </label>
                  <input
                    type="datetime-local"
                    required
                    value={apptStartTime}
                    onChange={(e) => setApptStartTime(e.target.value)}
                    className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-primary focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                    End Time *
                  </label>
                  <input
                    type="datetime-local"
                    required
                    value={apptEndTime}
                    onChange={(e) => setApptEndTime(e.target.value)}
                    className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-primary focus:outline-none"
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

              <div className="flex items-center justify-between border-t border-slate-800 pt-4 mt-2">
                <div>
                  {selectedAppt && (
                    <button
                      type="button"
                      onClick={deleteAppointment}
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
                      onChange={(e) => setApptStatus(e.target.value as any)}
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
    </div>
  );
}
