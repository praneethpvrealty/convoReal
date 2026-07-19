import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Link, Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { InlineDateTimePicker } from '@/components/datetime-field';
import { ConvoRealLoader } from '@/components/loader';
import { BottomSheet } from '@/components/sheet';
import { EmptyState } from '@/components/ui';
import { apiFetch, ApiError } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { queryClient } from '@/lib/query';
import { supabase } from '@/lib/supabase';
import { radius, spacing, useTheme , fonts } from '@/lib/theme';
import type { Appointment, AppointmentType } from '@/lib/types';

const TYPE_META: Record<AppointmentType, { icon: keyof typeof Ionicons.glyphMap; label: string }> = {
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
  const today = new Date();
  const [month, setMonth] = useState(() => monthStart(today));
  const [selected, setSelected] = useState<Date>(today);
  const [detail, setDetail] = useState<Appointment | null>(null);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['appointments', month.getFullYear(), month.getMonth()],
    queryFn: () => fetchMonth(month),
  });

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
    const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
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
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Calendar',
          headerRight: () => (
            <Link href="/(app)/appointment-new" asChild>
              <Pressable
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="New appointment"
              >
                <Ionicons name="add-circle" size={26} color={colors.primary} />
              </Pressable>
            </Link>
          ),
        }}
      />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
        refreshControl={
          <RefreshControl refreshing={isFetching} onRefresh={refetch} tintColor={colors.primary} />
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
          <Text style={{ fontSize: 17, fontFamily: f.extrabold, color: colors.text }}>
            {month.toLocaleDateString([], { month: 'long', year: 'numeric' })}
          </Text>
          <Pressable
            onPress={() => shiftMonth(1)}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Next month"
          >
            <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
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
            <Text style={{ fontSize: 13, fontFamily: f.bold, color: colors.primary }}>Today</Text>
          </Pressable>
        </View>

        {/* Grid */}
        <View style={[styles.grid, { backgroundColor: colors.glass, borderColor: colors.glassBorder }]}>
          <View style={styles.weekRow}>
            {WEEKDAYS.map((w, i) => (
              <Text key={i} style={[styles.weekday, { color: colors.textFaint }]}>
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
                        !isSelected && isToday && { borderWidth: 1.5, borderColor: colors.primary },
                      ]}
                    >
                      <Text
                        style={{
                          fontSize: 14,
                          fontFamily: isSelected || isToday ? fonts.extrabold : fonts.medium,
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
          {selected.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}
        </Text>
        {isLoading ? (
          <ConvoRealLoader style={{ alignSelf: 'center', paddingVertical: 20 }} />
        ) : dayAppointments.length === 0 ? (
          <EmptyState
            icon="calendar-outline"
            title="Nothing on this day"
            subtitle="Tap + to schedule a site visit, call or meeting. Attached contacts get automatic WhatsApp reminders."
          />
        ) : (
          dayAppointments.map((appt) => (
            <AppointmentCard key={appt.id} appointment={appt} onPress={() => setDetail(appt)} />
          ))
        )}
      </ScrollView>

      <AppointmentDetail appointment={detail} onClose={() => setDetail(null)} />
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
            appointment.status === 'cancelled' && { textDecorationLine: 'line-through' },
          ]}
          numberOfLines={1}
        >
          {appointment.title}
        </Text>
        <Text style={{ fontSize: 12.5, color: colors.textMuted }} numberOfLines={1}>
          {time} · {meta.label}
          {appointment.location ? ` · ${appointment.location}` : ''}
        </Text>
        {appointment.contact ? (
          <Text style={{ fontSize: 12.5, color: colors.primary, fontFamily: f.semibold }}>
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
            color: appointment.status === 'completed' ? colors.success : colors.danger,
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
    await supabase.from('appointments').update({ status }).eq('id', appointment.id);
    setBusy(false);
    queryClient.invalidateQueries({ queryKey: ['appointments'] });
    reset();
    onClose();
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
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            <View style={[styles.typeBadge, { backgroundColor: colors.primarySoft }]}>
              <Ionicons name={meta.icon} size={17} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 17, fontFamily: f.extrabold, color: colors.text }}>
                {appointment.title}
              </Text>
              <Text style={{ fontSize: 12.5, color: colors.textMuted }}>
                {meta.label} ·{' '}
                {effectiveStart.toLocaleDateString([], {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                })}{' '}
                · {effectiveStart.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </Text>
            </View>
          </View>

          {appointment.location ? (
            <DetailRow icon="location-outline" text={appointment.location} />
          ) : null}
          {appointment.description ? (
            <DetailRow icon="text-outline" text={appointment.description} />
          ) : null}
          {appointment.agenda ? (
            <DetailRow icon="list-outline" text={appointment.agenda} />
          ) : null}
          {appointment.contact ? (
            <Link href={`/(app)/contact/${appointment.contact.id}`} asChild>
              <Pressable onPress={onClose}>
                <DetailRow
                  icon="person-outline"
                  text={appointment.contact.name || appointment.contact.phone || ''}
                  accent
                />
              </Pressable>
            </Link>
          ) : null}
          {appointment.property ? (
            <Link href={`/(app)/property/${appointment.property.id}`} asChild>
              <Pressable onPress={onClose}>
                <DetailRow icon="home-outline" text={appointment.property.title} accent />
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
                    style={[styles.pickerButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
                    onPress={() => setPicker('date')}
                  >
                    <Ionicons name="calendar-outline" size={15} color={colors.primary} />
                    <Text style={{ fontSize: 13.5, fontFamily: f.semibold, color: colors.text }}>
                      {effectiveStart.toLocaleDateString([], { day: 'numeric', month: 'short' })}
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[styles.pickerButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
                    onPress={() => setPicker('time')}
                  >
                    <Ionicons name="time-outline" size={15} color={colors.primary} />
                    <Text style={{ fontSize: 13.5, fontFamily: f.semibold, color: colors.text }}>
                      {effectiveStart.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
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
                <Text style={{ fontSize: 11.5, color: colors.textFaint, textAlign: 'center' }}>
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
  const { colors, fonts: f } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }}>
      <Ionicons name={icon} size={16} color={accent ? colors.primary : colors.textMuted} />
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
        <Text style={{ fontSize: 13.5, fontFamily: f.bold, color: textColor }}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  monthHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  grid: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: spacing.sm,
    paddingHorizontal: 4,
  },
  weekRow: { flexDirection: 'row' },
  weekday: { flex: 1, textAlign: 'center', fontSize: 11, fontFamily: fonts.bold, paddingVertical: 4 },
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
});
