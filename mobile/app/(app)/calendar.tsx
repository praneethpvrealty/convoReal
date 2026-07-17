import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Link, Stack } from 'expo-router';
import { useMemo } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { EmptyState } from '@/components/ui';
import { dayLabel } from '@/lib/format';
import { queryClient } from '@/lib/query';
import { supabase } from '@/lib/supabase';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { Appointment, AppointmentType } from '@/lib/types';

const TYPE_META: Record<AppointmentType, { icon: keyof typeof Ionicons.glyphMap; label: string }> = {
  site_visit: { icon: 'location', label: 'Site visit' },
  call: { icon: 'call', label: 'Call' },
  follow_up: { icon: 'repeat', label: 'Follow-up' },
  document: { icon: 'document-text', label: 'Document' },
  meeting: { icon: 'people', label: 'Meeting' },
  other: { icon: 'ellipse', label: 'Other' },
};

async function fetchUpcoming(): Promise<Appointment[]> {
  // Same select the web calendar page runs, scoped to today onward.
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const { data, error } = await supabase
    .from('appointments')
    .select(
      '*, contact:contacts(id, name, phone, name_tag), property:properties(id, title, location, sublocality)'
    )
    .gte('start_time', startOfToday.toISOString())
    .order('start_time', { ascending: true })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as Appointment[];
}

export default function CalendarScreen() {
  const { colors } = useTheme();
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['appointments'],
    queryFn: fetchUpcoming,
  });

  const grouped = useMemo(() => {
    const groups: { label: string; items: Appointment[] }[] = [];
    for (const appt of data ?? []) {
      const label = dayLabel(appt.start_time);
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.items.push(appt);
      else groups.push({ label, items: [appt] });
    }
    return groups;
  }, [data]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Calendar',
          headerStyle: { backgroundColor: colors.tabBar },
          headerTintColor: colors.text,
          headerRight: () => (
            <Link href="/(app)/appointment-new" asChild>
              <Pressable hitSlop={8}>
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
        {!isLoading && grouped.length === 0 ? (
          <EmptyState
            icon="calendar-outline"
            title="Nothing scheduled"
            subtitle="Tap + to schedule a site visit, call or meeting. WhatsApp reminders go out automatically."
          />
        ) : (
          grouped.map((group) => (
            <View key={group.label} style={{ gap: spacing.sm }}>
              <Text style={[styles.dayLabel, { color: colors.textFaint }]}>{group.label}</Text>
              {group.items.map((appt) => (
                <AppointmentCard key={appt.id} appointment={appt} />
              ))}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

function AppointmentCard({ appointment }: { appointment: Appointment }) {
  const { colors } = useTheme();
  const meta = TYPE_META[appointment.event_type] ?? TYPE_META.other;
  const time = new Date(appointment.start_time).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  const cancelled = appointment.status === 'cancelled';
  const completed = appointment.status === 'completed';

  async function setStatus(status: Appointment['status']) {
    await supabase.from('appointments').update({ status }).eq('id', appointment.id);
    queryClient.invalidateQueries({ queryKey: ['appointments'] });
  }

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.surface, borderColor: colors.border },
        (cancelled || completed) && { opacity: 0.55 },
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
            cancelled && { textDecorationLine: 'line-through' },
          ]}
          numberOfLines={1}
        >
          {appointment.title}
        </Text>
        <Text style={{ fontSize: 12.5, color: colors.textMuted }}>
          {time} · {meta.label}
          {appointment.location ? ` · ${appointment.location}` : ''}
        </Text>
        {appointment.contact ? (
          <Link href={`/(app)/contact/${appointment.contact.id}`} asChild>
            <Pressable>
              <Text style={{ fontSize: 12.5, color: colors.primary, fontWeight: '600' }}>
                {appointment.contact.name || appointment.contact.phone}
              </Text>
            </Pressable>
          </Link>
        ) : null}
        {appointment.property ? (
          <Text style={{ fontSize: 12.5, color: colors.textFaint }} numberOfLines={1}>
            {appointment.property.title}
          </Text>
        ) : null}
      </View>
      {appointment.status === 'scheduled' ? (
        <View style={{ gap: 6 }}>
          <Pressable hitSlop={6} onPress={() => setStatus('completed')}>
            <Ionicons name="checkmark-circle-outline" size={22} color={colors.success} />
          </Pressable>
          <Pressable hitSlop={6} onPress={() => setStatus('cancelled')}>
            <Ionicons name="close-circle-outline" size={22} color={colors.danger} />
          </Pressable>
        </View>
      ) : (
        <Text
          style={{
            fontSize: 11,
            fontWeight: '700',
            color: completed ? colors.success : colors.danger,
            textTransform: 'uppercase',
          }}
        >
          {appointment.status}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  dayLabel: {
    fontSize: 12.5,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
  },
  typeBadge: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: { fontSize: 15, fontWeight: '700' },
});
