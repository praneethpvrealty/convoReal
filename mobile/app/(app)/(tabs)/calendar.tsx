import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TAB_BAR_CLEARANCE } from '@/app/(app)/(tabs)/_layout';
import { InlineDateTimePicker } from '@/components/datetime-field';
import { ConvoRealLoader } from '@/components/loader';
import { BottomSheet, sheetScrollArea } from '@/components/sheet';
import { EmptyState, FilterChip } from '@/components/ui';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { haptic } from '@/lib/haptics';
import { queryClient } from '@/lib/query';
import { supabase } from '@/lib/supabase';
import { radius, spacing, useTheme, fonts } from '@/lib/theme';
import { eventTypeFields, type EventFieldKey } from '@/lib/event-fields';
import {
  addTodo,
  deleteTodo,
  fetchTodos,
  setTodoCompleted,
  sortTodos,
  type Todo,
  type TodoPriority,
} from '@/lib/todos';
import type { Appointment, AppointmentType } from '@/lib/types';
import { usePullRefresh } from '@/lib/use-pull-refresh';

const TYPE_META: Record<
  AppointmentType,
  { icon: keyof typeof Ionicons.glyphMap; label: string }
> = {
  site_visit: { icon: 'location', label: 'Site visit' },
  call: { icon: 'call', label: 'Call' },
  follow_up: { icon: 'repeat', label: 'Follow-up' },
  document: { icon: 'document-text', label: 'Document' },
  meeting: { icon: 'people', label: 'Meeting' },
  other: { icon: 'ellipse', label: 'Other' },
};

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function monthStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

async function fetchMonth(month: Date): Promise<Appointment[]> {
  const from = monthStart(month);
  const to = new Date(month.getFullYear(), month.getMonth() + 1, 1);
  const { data, error } = await supabase
    .from('appointments')
    .select(
      '*, contact:contacts(id, name, phone, name_tag), property:properties(id, title, location, sublocality)'
    )
    .gte('start_time', from.toISOString())
    .lt('start_time', to.toISOString())
    .order('start_time', { ascending: true })
    .limit(300);
  if (error) throw error;
  return (data ?? []) as Appointment[];
}

export default function CalendarScreen() {
  const { colors, fonts: f } = useTheme();
  const insets = useSafeAreaInsets();
  const today = new Date();
  const [month, setMonth] = useState(() => monthStart(today));
  const [selected, setSelected] = useState<Date>(today);
  const [detail, setDetail] = useState<Appointment | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['appointments', month.getFullYear(), month.getMonth()],
    queryFn: () => fetchMonth(month),
  });
  const todosQuery = useQuery({ queryKey: ['todos'], queryFn: fetchTodos });
  const pull = usePullRefresh(() =>
    Promise.all([refetch(), todosQuery.refetch()])
  );

  const byDay = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    for (const appt of data ?? []) {
      const key = dayKey(new Date(appt.start_time));
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(appt);
    }
    return map;
  }, [data]);

  // Build the visible grid: leading blanks (Monday-first) + days.
  const cells = useMemo(() => {
    const first = monthStart(month);
    const daysInMonth = new Date(
      month.getFullYear(),
      month.getMonth() + 1,
      0
    ).getDate();
    const lead = (first.getDay() + 6) % 7; // Monday = 0
    const out: (Date | null)[] = Array(lead).fill(null);
    for (let d = 1; d <= daysInMonth; d++) {
      out.push(new Date(month.getFullYear(), month.getMonth(), d));
    }
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [month]);

  const dayAppointments = byDay.get(dayKey(selected)) ?? [];

  function shiftMonth(delta: number) {
    haptic.tap();
    setMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));
  }

  return (
    <View style={{ flex: 1 }}>
      <View
        style={[styles.screenHeader, { paddingTop: insets.top + spacing.sm }]}
      >
        <Text
          style={[
            styles.screenTitle,
            { color: colors.text, fontFamily: f.extrabold },
          ]}
        >
          Calendar
        </Text>
        <Link href="/(app)/appointment-new" asChild>
          <Pressable
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="New appointment"
          >
            <Ionicons name="add-circle" size={30} color={colors.primary} />
          </Pressable>
        </Link>
      </View>

      <ScrollView
        testID="calendar-screen"
        style={{ flex: 1 }}
        contentContainerStyle={{
          padding: spacing.lg,
          gap: spacing.md,
          paddingBottom: TAB_BAR_CLEARANCE,
        }}
        refreshControl={
          <RefreshControl
            refreshing={pull.refreshing}
            onRefresh={pull.onRefresh}
            tintColor={colors.primary}
          />
        }
      >
        {/* Month header */}
        <View style={styles.monthHeader}>
          <Pressable
            onPress={() => shiftMonth(-1)}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Previous month"
          >
            <Ionicons name="chevron-back" size={20} color={colors.textMuted} />
          </Pressable>
          <Text
            style={{
              fontSize: 17,
              fontFamily: f.extrabold,
              color: colors.text,
            }}
          >
            {month.toLocaleDateString([], { month: 'long', year: 'numeric' })}
          </Text>
          <Pressable
            onPress={() => shiftMonth(1)}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Next month"
          >
            <Ionicons
              name="chevron-forward"
              size={20}
              color={colors.textMuted}
            />
          </Pressable>
          <View style={{ flex: 1 }} />
          <Pressable
            onPress={() => {
              haptic.tap();
              setMonth(monthStart(today));
              setSelected(today);
            }}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Jump to today"
            style={{ paddingVertical: 8, paddingHorizontal: 4 }}
          >
            <Text
              style={{
                fontSize: 13,
                fontFamily: f.bold,
                color: colors.primary,
              }}
            >
              Today
            </Text>
          </Pressable>
        </View>

        {/* Grid */}
        <View
          style={[
            styles.grid,
            { backgroundColor: colors.glass, borderColor: colors.glassBorder },
          ]}
        >
          <View style={styles.weekRow}>
            {WEEKDAYS.map((w, i) => (
              <Text
                key={i}
                style={[styles.weekday, { color: colors.textFaint }]}
              >
                {w}
              </Text>
            ))}
          </View>
          {Array.from({ length: cells.length / 7 }, (_, row) => (
            <View key={row} style={styles.weekRow}>
              {cells.slice(row * 7, row * 7 + 7).map((date, i) => {
                if (!date) return <View key={i} style={styles.dayCell} />;
                const appts = byDay.get(dayKey(date)) ?? [];
                const isSelected = sameDay(date, selected);
                const isToday = sameDay(date, today);
                return (
                  <Pressable
                    key={i}
                    style={styles.dayCell}
                    onPress={() => {
                      haptic.tap();
                      setSelected(date);
                    }}
                  >
                    <View
                      style={[
                        styles.dayInner,
                        isSelected && { backgroundColor: colors.primary },
                        !isSelected &&
                          isToday && {
                            borderWidth: 1.5,
                            borderColor: colors.primary,
                          },
                      ]}
                    >
                      <Text
                        style={{
                          fontSize: 14,
                          fontFamily:
                            isSelected || isToday
                              ? fonts.extrabold
                              : fonts.medium,
                          color: isSelected ? colors.onPrimary : colors.text,
                        }}
                      >
                        {date.getDate()}
                      </Text>
                    </View>
                    <View style={styles.dots}>
                      {appts.slice(0, 3).map((a) => (
                        <View
                          key={a.id}
                          style={[
                            styles.dot,
                            {
                              backgroundColor:
                                a.status === 'cancelled'
                                  ? colors.textFaint
                                  : a.event_type === 'site_visit'
                                    ? colors.success
                                    : colors.primary,
                            },
                          ]}
                        />
                      ))}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>

        {/* Selected-day agenda */}
        <Text style={[styles.dayLabel, { color: colors.textFaint }]}>
          {selected.toLocaleDateString([], {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          })}
        </Text>
        {isLoading ? (
          <ConvoRealLoader
            style={{ alignSelf: 'center', paddingVertical: 20 }}
          />
        ) : dayAppointments.length === 0 ? (
          <EmptyState
            icon="calendar-outline"
            title="Nothing on this day"
            subtitle="Tap + to schedule a site visit, call or meeting. Attached contacts get automatic WhatsApp reminders."
          />
        ) : (
          dayAppointments.map((appt) => (
            <AppointmentCard
              key={appt.id}
              appointment={appt}
              onPress={() => setDetail(appt)}
            />
          ))
        )}

        {/* To-dos (web parity: the calendar's task panel). Not tied to
            the selected day — a flat list under the agenda, open tasks
            first. Contact/property mentions stay a web smart-add
            feature; rows created there still show their links here. */}
        <Text style={[styles.dayLabel, { color: colors.textFaint }]}>
          To-dos
        </Text>
        <TodoQuickAdd />
        {todosQuery.isLoading ? (
          <ConvoRealLoader
            style={{ alignSelf: 'center', paddingVertical: 20 }}
          />
        ) : (todosQuery.data ?? []).length === 0 ? (
          <Text style={{ fontSize: 13, color: colors.textMuted }}>
            No tasks yet. Add one above — tasks sync with the web calendar.
          </Text>
        ) : (
          sortTodos(todosQuery.data ?? []).map((todo) => (
            <TodoRow key={todo.id} todo={todo} now={today} />
          ))
        )}
      </ScrollView>

      {/* Keyed so the notes draft belongs to one event: without it the
          sheet keeps its state when a different event is opened. */}
      <AppointmentDetail
        key={detail?.id ?? 'none'}
        appointment={detail}
        onClose={() => setDetail(null)}
      />
    </View>
  );
}

const PRIORITIES: TodoPriority[] = ['low', 'medium', 'high'];

function priorityColor(
  priority: TodoPriority,
  colors: ReturnType<typeof useTheme>['colors']
) {
  return priority === 'high'
    ? colors.danger
    : priority === 'medium'
      ? colors.warning
      : colors.textFaint;
}

function TodoQuickAdd() {
  const { colors, fonts: f } = useTheme();
  const accountId = useAuthStore((s) => s.profile?.account_id);
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<TodoPriority>('medium');
  const [dueDate, setDueDate] = useState<Date | null>(null);
  const [picker, setPicker] = useState<'date' | 'time' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const trimmed = title.trim();
    if (!trimmed || !accountId) return;
    haptic.tap();
    setBusy(true);
    setError(null);
    try {
      await addTodo({ accountId, title: trimmed, priority, dueDate });
      haptic.success();
      setTitle('');
      setPriority('medium');
      setDueDate(null);
      setPicker(null);
      queryClient.invalidateQueries({ queryKey: ['todos'] });
    } catch {
      haptic.warn();
      setError('Could not add this task. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: spacing.sm }}>
      <View style={styles.todoAddRow}>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="Add a task…"
          placeholderTextColor={colors.textFaint}
          accessibilityLabel="New task title"
          returnKeyType="done"
          onSubmitEditing={save}
          style={[
            styles.todoInput,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              color: colors.text,
            },
          ]}
        />
        {busy ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <Pressable
            onPress={save}
            hitSlop={8}
            disabled={!title.trim()}
            accessibilityRole="button"
            accessibilityLabel="Add task"
          >
            <Ionicons
              name="add-circle"
              size={30}
              color={title.trim() ? colors.primary : colors.textFaint}
            />
          </Pressable>
        )}
      </View>
      {title.trim() ? (
        <View style={{ gap: spacing.sm }}>
          <View
            style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}
          >
            {PRIORITIES.map((p) => (
              <FilterChip
                key={p}
                label={p === 'low' ? 'Low' : p === 'medium' ? 'Medium' : 'High'}
                active={priority === p}
                onPress={() => {
                  haptic.tap();
                  setPriority(p);
                }}
              />
            ))}
            <Pressable
              onPress={() => {
                haptic.tap();
                setPicker(picker ? null : 'date');
                if (!dueDate) {
                  const tomorrow = new Date();
                  tomorrow.setDate(tomorrow.getDate() + 1);
                  tomorrow.setHours(9, 0, 0, 0);
                  setDueDate(tomorrow);
                }
              }}
              accessibilityRole="button"
              accessibilityLabel={dueDate ? 'Change due date' : 'Add due date'}
              style={[styles.todoDueChip, { borderColor: colors.border }]}
            >
              <Ionicons
                name="calendar-outline"
                size={14}
                color={colors.primary}
              />
              <Text
                style={{
                  fontSize: 13,
                  fontFamily: f.semibold,
                  color: colors.text,
                }}
              >
                {dueDate
                  ? `${dueDate.toLocaleDateString([], { day: 'numeric', month: 'short' })} · ${dueDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                  : 'Due date'}
              </Text>
              {dueDate ? (
                <Pressable
                  onPress={() => {
                    setDueDate(null);
                    setPicker(null);
                  }}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Clear due date"
                >
                  <Ionicons
                    name="close-circle"
                    size={15}
                    color={colors.textFaint}
                  />
                </Pressable>
              ) : null}
            </Pressable>
          </View>
          {picker && dueDate ? (
            <View style={{ gap: spacing.sm }}>
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <FilterChip
                  label="Day"
                  active={picker === 'date'}
                  onPress={() => setPicker('date')}
                />
                <FilterChip
                  label="Time"
                  active={picker === 'time'}
                  onPress={() => setPicker('time')}
                />
              </View>
              <InlineDateTimePicker
                value={dueDate}
                mode={picker}
                onChange={setDueDate}
                onClose={() => setPicker(null)}
              />
            </View>
          ) : null}
        </View>
      ) : null}
      {error ? (
        <Text style={{ fontSize: 12.5, color: colors.danger }}>{error}</Text>
      ) : null}
    </View>
  );
}

function TodoRow({ todo, now }: { todo: Todo; now: Date }) {
  const { colors, fonts: f } = useTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const due = todo.due_date ? new Date(todo.due_date) : null;
  const overdue =
    due !== null && !todo.completed && due.getTime() < now.getTime();

  async function toggle() {
    haptic.tap();
    setBusy(true);
    setError(null);
    try {
      await setTodoCompleted(todo.id, !todo.completed);
      if (!todo.completed) haptic.success();
      queryClient.invalidateQueries({ queryKey: ['todos'] });
    } catch {
      haptic.warn();
      setError('Could not update this task. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    haptic.warn();
    setBusy(true);
    setError(null);
    try {
      await deleteTodo(todo.id);
      queryClient.invalidateQueries({ queryKey: ['todos'] });
    } catch {
      haptic.warn();
      setError('Could not delete this task. Check your connection and try again.');
      setBusy(false);
    }
  }

  const meta = [
    due
      ? `${due.toLocaleDateString([], { day: 'numeric', month: 'short' })} · ${due.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
      : null,
    todo.contact ? todo.contact.name || todo.contact.phone : null,
    todo.property?.title ?? null,
  ].filter(Boolean);

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.glass, borderColor: colors.glassBorder },
        todo.completed && { opacity: 0.55 },
      ]}
    >
      <Pressable
        onPress={toggle}
        disabled={busy}
        hitSlop={8}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: todo.completed }}
        accessibilityLabel={todo.title}
      >
        {busy ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <Ionicons
            name={todo.completed ? 'checkmark-circle' : 'ellipse-outline'}
            size={24}
            color={
              todo.completed
                ? colors.success
                : priorityColor(todo.priority, colors)
            }
          />
        )}
      </Pressable>
      <View style={{ flex: 1, gap: 2 }}>
        <Text
          style={[
            { fontSize: 14.5, fontFamily: f.semibold, color: colors.text },
            todo.completed && { textDecorationLine: 'line-through' },
          ]}
          numberOfLines={2}
        >
          {todo.title}
        </Text>
        {meta.length > 0 ? (
          <Text
            style={{
              fontSize: 12,
              color: overdue ? colors.danger : colors.textMuted,
            }}
            numberOfLines={1}
          >
            {overdue ? 'Overdue · ' : ''}
            {meta.join(' · ')}
          </Text>
        ) : null}
        {error ? (
          <Text style={{ fontSize: 11.5, color: colors.danger }}>{error}</Text>
        ) : null}
      </View>
      <Pressable
        onPress={remove}
        disabled={busy}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Delete task"
      >
        <Ionicons name="trash-outline" size={17} color={colors.textFaint} />
      </Pressable>
    </View>
  );
}

function AppointmentCard({
  appointment,
  onPress,
}: {
  appointment: Appointment;
  onPress: () => void;
}) {
  const { colors, fonts: f } = useTheme();
  const meta = TYPE_META[appointment.event_type] ?? TYPE_META.other;
  const time = new Date(appointment.start_time).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  const done = appointment.status !== 'scheduled';

  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.card,
        { backgroundColor: colors.glass, borderColor: colors.glassBorder },
        done && { opacity: 0.55 },
      ]}
    >
      <View style={[styles.typeBadge, { backgroundColor: colors.primarySoft }]}>
        <Ionicons name={meta.icon} size={17} color={colors.primary} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text
          style={[
            styles.cardTitle,
            { color: colors.text },
            appointment.status === 'cancelled' && {
              textDecorationLine: 'line-through',
            },
          ]}
          numberOfLines={1}
        >
          {appointment.title}
        </Text>
        <Text
          style={{ fontSize: 12.5, color: colors.textMuted }}
          numberOfLines={1}
        >
          {time} · {meta.label}
          {appointment.location ? ` · ${appointment.location}` : ''}
        </Text>
        {appointment.contact ? (
          <Text
            style={{
              fontSize: 12.5,
              color: colors.primary,
              fontFamily: f.semibold,
            }}
          >
            {appointment.contact.name || appointment.contact.phone}
          </Text>
        ) : null}
      </View>
      {done ? (
        <Text
          style={{
            fontSize: 11,
            fontFamily: f.bold,
            textTransform: 'uppercase',
            color:
              appointment.status === 'completed'
                ? colors.success
                : colors.danger,
          }}
        >
          {appointment.status}
        </Text>
      ) : (
        <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
      )}
    </Pressable>
  );
}

/**
 * Call-to-action for an event with nothing logged yet. Names the
 * post-event field this type actually has — "Add minutes of the
 * meeting" on a meeting, "Add visit feedback" on a site visit — rather
 * than a generic "Add notes" that hides which of the three applies.
 */
function postFieldLabel(eventType: Appointment['event_type']): string {
  const post = eventTypeFields(eventType).find(
    (field) => field.phase === 'post'
  );
  return post ? `Add ${post.label.toLowerCase()}` : 'Add notes';
}

/** Bottom sheet: full info + complete / cancel / reschedule. */
function AppointmentDetail({
  appointment,
  onClose,
}: {
  appointment: Appointment | null;
  onClose: () => void;
}) {
  const { colors, fonts: f } = useTheme();
  const [rescheduling, setRescheduling] = useState(false);
  const [newStart, setNewStart] = useState<Date | null>(null);
  const [picker, setPicker] = useState<'date' | 'time' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notes, setNotes] = useState<Record<EventFieldKey, string>>({
    agenda: appointment?.agenda ?? '',
    minutes: appointment?.minutes ?? '',
    outcome: appointment?.outcome ?? '',
  });

  if (!appointment) return null;
  const meta = TYPE_META[appointment.event_type] ?? TYPE_META.other;
  const start = new Date(appointment.start_time);
  const effectiveStart = newStart ?? start;

  function reset() {
    setRescheduling(false);
    setNewStart(null);
    setPicker(null);
    setError(null);
  }

  async function setStatus(status: Appointment['status']) {
    if (!appointment) return;
    haptic.tap();
    setBusy(true);
    setError(null);
    // Ask for the row back rather than firing and forgetting: a write
    // that errored — or matched nothing — used to close this sheet as if
    // it had worked, leaving the event still 'scheduled' in the Engine with
    // its reminders (src/lib/calendar/agent-reminders.ts) queued to fire
    // an hour before an event the agent believed was closed.
    const { data, error: updateError } = await supabase
      .from('appointments')
      .update({ status })
      .eq('id', appointment.id)
      .select('id');
    setBusy(false);

    if (updateError || !data?.length) {
      haptic.warn();
      setError(
        'Could not update this event. Check your connection and try again.'
      );
      return;
    }

    haptic.success();
    queryClient.invalidateQueries({ queryKey: ['appointments'] });
    reset();
    onClose();
  }

  // Only the fields that belong to this event type are written, so
  // switching type later cannot leave a stale note behind — same rule
  // the web calendar applies on save.
  async function saveNotes() {
    if (!appointment) return;
    setBusy(true);
    setError(null);
    const payload: Partial<Record<EventFieldKey, string | null>> = {};
    for (const field of eventTypeFields(appointment.event_type)) {
      payload[field.key] = notes[field.key].trim() || null;
    }
    const { data, error: updateError } = await supabase
      .from('appointments')
      .update(payload)
      .eq('id', appointment.id)
      .select('id');
    setBusy(false);

    if (updateError || !data?.length) {
      haptic.warn();
      setError(
        'Could not save these notes. Check your connection and try again.'
      );
      return;
    }

    haptic.success();
    queryClient.invalidateQueries({ queryKey: ['appointments'] });
    setEditingNotes(false);
  }

  async function saveReschedule() {
    if (!appointment || !newStart) return;
    setBusy(true);
    setError(null);
    try {
      const end = new Date(newStart.getTime() + 60 * 60 * 1000);
      // The PUT route re-arms WhatsApp reminders when the time moves —
      // that's why this is not a direct table update.
      await apiFetch(`/api/appointments/${appointment.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          start_time: newStart.toISOString(),
          end_time: end.toISOString(),
        }),
      });
      haptic.success();
      queryClient.invalidateQueries({ queryKey: ['appointments'] });
      reset();
      onClose();
    } catch (err) {
      haptic.warn();
      setError(err instanceof ApiError ? err.message : 'Could not reschedule.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet
      visible
      onClose={() => {
        reset();
        onClose();
      }}
      contentStyle={styles.sheet}
    >
      <ScrollView
        style={sheetScrollArea}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: spacing.md }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.md,
          }}
        >
          <View
            style={[styles.typeBadge, { backgroundColor: colors.primarySoft }]}
          >
            <Ionicons name={meta.icon} size={17} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text
              style={{
                fontSize: 17,
                fontFamily: f.extrabold,
                color: colors.text,
              }}
            >
              {appointment.title}
            </Text>
            <Text style={{ fontSize: 12.5, color: colors.textMuted }}>
              {meta.label} ·{' '}
              {effectiveStart.toLocaleDateString([], {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
              })}{' '}
              ·{' '}
              {effectiveStart.toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </Text>
          </View>
        </View>

        {appointment.location ? (
          <DetailRow icon="location-outline" text={appointment.location} />
        ) : null}
        {appointment.description ? (
          <DetailRow icon="text-outline" text={appointment.description} />
        ) : null}
        {/* Type-specific notes (migration 128): agenda before the
              event, minutes / outcome after it. Editable here because
              the post-event ones exist to be filled in once the event
              is done, which is when this sheet is open. */}
        {editingNotes ? (
          <View style={{ gap: spacing.md }}>
            {eventTypeFields(appointment.event_type).map((field) => (
              <View key={field.key} style={{ gap: 6 }}>
                <Text
                  style={{
                    fontSize: 11.5,
                    fontFamily: f.bold,
                    color: colors.textMuted,
                  }}
                >
                  {field.label.toUpperCase()}
                  <Text
                    style={{
                      fontFamily: fonts.regular,
                      color: colors.textFaint,
                    }}
                  >
                    {field.phase === 'pre'
                      ? '  — sent in the pre-event reminder'
                      : '  — fill in after the event'}
                  </Text>
                </Text>
                <TextInput
                  multiline
                  value={notes[field.key]}
                  onChangeText={(next) =>
                    setNotes((prev) => ({ ...prev, [field.key]: next }))
                  }
                  placeholder={field.placeholder}
                  placeholderTextColor={colors.textFaint}
                  accessibilityLabel={field.label}
                  style={[
                    styles.notesInput,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                      color: colors.text,
                    },
                  ]}
                />
              </View>
            ))}
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <SheetButton
                label="Save notes"
                color={colors.primary}
                textColor={colors.onPrimary}
                disabled={busy}
                busy={busy}
                onPress={saveNotes}
              />
              <SheetButton
                label="Cancel"
                color={colors.surface}
                textColor={colors.textMuted}
                onPress={() => {
                  setNotes({
                    agenda: appointment.agenda ?? '',
                    minutes: appointment.minutes ?? '',
                    outcome: appointment.outcome ?? '',
                  });
                  setEditingNotes(false);
                }}
              />
            </View>
          </View>
        ) : (
          <>
            {eventTypeFields(appointment.event_type)
              .filter(
                (field) => (appointment[field.key] ?? '').trim().length > 0
              )
              .map((field) => (
                <DetailRow
                  key={field.key}
                  icon={
                    field.phase === 'pre' ? 'list-outline' : 'create-outline'
                  }
                  text={`${field.label}: ${appointment[field.key]}`}
                />
              ))}
            <Pressable
              onPress={() => {
                haptic.tap();
                setEditingNotes(true);
              }}
              accessibilityRole="button"
              accessibilityLabel="Add or edit notes for this event"
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.md,
              }}
            >
              <Ionicons
                name="create-outline"
                size={16}
                color={colors.primary}
              />
              <Text
                style={{
                  fontSize: 14,
                  fontFamily: f.semibold,
                  color: colors.primary,
                }}
              >
                {eventTypeFields(appointment.event_type).some(
                  (field) => (appointment[field.key] ?? '').trim().length > 0
                )
                  ? 'Edit notes'
                  : postFieldLabel(appointment.event_type)}
              </Text>
            </Pressable>
          </>
        )}
        {appointment.contact ? (
          <Link href={`/(app)/contact/${appointment.contact.id}`} asChild>
            <Pressable onPress={onClose}>
              <DetailRow
                icon="person-outline"
                text={
                  appointment.contact.name || appointment.contact.phone || ''
                }
                accent
              />
            </Pressable>
          </Link>
        ) : null}
        {appointment.property ? (
          <Link href={`/(app)/property/${appointment.property.id}`} asChild>
            <Pressable onPress={onClose}>
              <DetailRow
                icon="home-outline"
                text={appointment.property.title}
                accent
              />
            </Pressable>
          </Link>
        ) : null}

        {error ? (
          <Text style={{ fontSize: 12.5, color: colors.danger }}>{error}</Text>
        ) : null}

        {appointment.status === 'scheduled' ? (
          rescheduling ? (
            <View style={{ gap: spacing.sm }}>
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <Pressable
                  style={[
                    styles.pickerButton,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                    },
                  ]}
                  onPress={() => setPicker('date')}
                >
                  <Ionicons
                    name="calendar-outline"
                    size={15}
                    color={colors.primary}
                  />
                  <Text
                    style={{
                      fontSize: 13.5,
                      fontFamily: f.semibold,
                      color: colors.text,
                    }}
                  >
                    {effectiveStart.toLocaleDateString([], {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.pickerButton,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                    },
                  ]}
                  onPress={() => setPicker('time')}
                >
                  <Ionicons
                    name="time-outline"
                    size={15}
                    color={colors.primary}
                  />
                  <Text
                    style={{
                      fontSize: 13.5,
                      fontFamily: f.semibold,
                      color: colors.text,
                    }}
                  >
                    {effectiveStart.toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </Text>
                </Pressable>
              </View>
              {picker ? (
                <InlineDateTimePicker
                  value={effectiveStart}
                  mode={picker}
                  onChange={setNewStart}
                  onClose={() => setPicker(null)}
                />
              ) : null}
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <SheetButton
                  label="Save new time"
                  color={colors.primary}
                  textColor={colors.onPrimary}
                  disabled={!newStart || busy}
                  busy={busy}
                  onPress={saveReschedule}
                />
                <SheetButton
                  label="Back"
                  color={colors.surface}
                  textColor={colors.textMuted}
                  onPress={() => setRescheduling(false)}
                />
              </View>
              <Text
                style={{
                  fontSize: 11.5,
                  color: colors.textFaint,
                  textAlign: 'center',
                }}
              >
                Rescheduling re-arms the WhatsApp reminders for the new time.
              </Text>
            </View>
          ) : (
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <SheetButton
                label="Reschedule"
                color={colors.primarySoft}
                textColor={colors.primary}
                onPress={() => setRescheduling(true)}
              />
              <SheetButton
                label="Complete"
                color={colors.successSoft}
                textColor={colors.success}
                disabled={busy}
                onPress={() => setStatus('completed')}
              />
              <SheetButton
                label="Cancel it"
                color={colors.dangerSoft}
                textColor={colors.danger}
                disabled={busy}
                onPress={() => setStatus('cancelled')}
              />
            </View>
          )
        ) : null}
      </ScrollView>
    </BottomSheet>
  );
}

function DetailRow({
  icon,
  text,
  accent,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  text: string;
  accent?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: spacing.md,
      }}
    >
      <Ionicons
        name={icon}
        size={16}
        color={accent ? colors.primary : colors.textMuted}
      />
      <Text
        style={{
          flex: 1,
          fontSize: 14,
          lineHeight: 20,
          color: accent ? colors.primary : colors.text,
          fontFamily: accent ? fonts.semibold : fonts.regular,
        }}
      >
        {text}
      </Text>
    </View>
  );
}

function SheetButton({
  label,
  color,
  textColor,
  onPress,
  disabled,
  busy,
}: {
  label: string;
  color: string;
  textColor: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  const { fonts: f } = useTheme();
  return (
    <Pressable
      style={{
        flex: 1,
        borderRadius: radius.md,
        paddingVertical: 12,
        alignItems: 'center',
        backgroundColor: color,
        opacity: disabled ? 0.55 : 1,
      }}
      disabled={disabled}
      onPress={onPress}
    >
      {busy ? (
        <ActivityIndicator size="small" color={textColor} />
      ) : (
        <Text style={{ fontSize: 13.5, fontFamily: f.bold, color: textColor }}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screenHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
  },
  screenTitle: {
    fontSize: 30,
    fontFamily: fonts.extrabold,
    letterSpacing: -0.5,
  },
  monthHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  grid: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: spacing.sm,
    paddingHorizontal: 4,
  },
  weekRow: { flexDirection: 'row' },
  weekday: {
    flex: 1,
    textAlign: 'center',
    fontSize: 11,
    fontFamily: fonts.bold,
    paddingVertical: 4,
  },
  dayCell: { flex: 1, alignItems: 'center', paddingVertical: 3 },
  dayInner: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dots: { flexDirection: 'row', gap: 2, height: 5, marginTop: 1 },
  dot: { width: 4, height: 4, borderRadius: 2 },
  dayLabel: {
    fontSize: 12.5,
    fontFamily: fonts.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: spacing.sm,
  },
  card: {
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  typeBadge: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: { fontSize: 15, fontFamily: fonts.bold },
  sheet: {
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  notesInput: {
    minHeight: 76,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: fonts.regular,
    textAlignVertical: 'top',
  },
  pickerButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingVertical: 10,
  },
  todoAddRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  todoInput: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: fonts.regular,
  },
  todoDueChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: radius.full,
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
});
