import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Stack, router } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type TextInput,
} from 'react-native';

import { InlineDateTimePicker } from '@/components/datetime-field';
import { Avatar, Banner, PrimaryButton, TextField } from '@/components/ui';
import { useAuthStore } from '@/lib/auth-store';
import { friendlyError } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { useDebounced } from '@/lib/use-debounced';
import { queryClient } from '@/lib/query';
import { supabase } from '@/lib/supabase';
import { radius, spacing, useTheme , fonts } from '@/lib/theme';
import type { AppointmentType, Contact } from '@/lib/types';

const TYPES: { value: AppointmentType; label: string; icon: string }[] = [
  { value: 'site_visit', label: 'Site visit', icon: 'location-outline' },
  { value: 'meeting', label: 'Meeting', icon: 'people-outline' },
  { value: 'call', label: 'Call', icon: 'call-outline' },
  { value: 'follow_up', label: 'Follow-up', icon: 'repeat-outline' },
];

export default function NewAppointmentScreen() {
  const { colors } = useTheme();
  const session = useAuthStore((s) => s.session);
  const accountId = useAuthStore((s) => s.profile?.account_id);

  const [title, setTitle] = useState('');
  const [eventType, setEventType] = useState<AppointmentType>('site_visit');
  const [start, setStart] = useState(() => {
    const d = new Date();
    d.setHours(d.getHours() + 1, 0, 0, 0);
    return d;
  });
  const [picker, setPicker] = useState<'date' | 'time' | null>(null);
  const [location, setLocation] = useState('');
  const [contactSearch, setContactSearch] = useState('');
  const debouncedContactSearch = useDebounced(contactSearch);
  const [contact, setContact] = useState<Contact | null>(null);
  const locationRef = useRef<TextInput>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const { data: contactOptions } = useQuery({
    queryKey: ['contact-picker', debouncedContactSearch],
    enabled: debouncedContactSearch.trim().length >= 2 && !contact,
    queryFn: async () => {
      const term = `%${debouncedContactSearch.trim()}%`;
      const { data } = await supabase
        .from('contacts')
        .select('id, name, phone')
        .or(`name.ilike.${term},phone.ilike.${term}`)
        .limit(6);
      return (data ?? []) as Contact[];
    },
  });

  const startLabel = useMemo(
    () =>
      `${start.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} · ${start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
    [start]
  );

  async function save() {
    if (!title.trim() || !session || !accountId) return;
    setSaving(true);
    setError(null);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    // Same direct insert the web's schedule dialog performs — WhatsApp
    // reminders are cron-driven off the row, no API call needed.
    const { error: insertError } = await supabase.from('appointments').insert({
      account_id: accountId,
      user_id: session.user.id,
      title: title.trim(),
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      location: location.trim() || null,
      status: 'scheduled',
      event_type: eventType,
      contact_id: contact?.id ?? null,
      contact_ids: contact ? [contact.id] : [],
    });
    setSaving(false);
    if (insertError) {
      haptic.warn();
      setError(friendlyError(insertError.message));
      return;
    }
    haptic.success();
    queryClient.invalidateQueries({ queryKey: ['appointments'] });
    router.back();
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'New appointment',
        }}
      />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {error ? <Banner kind="error" text={error} /> : null}

        <TextField
          placeholder="Title · e.g. Site visit — Prestige Lakeview"
          returnKeyType="next"
          onSubmitEditing={() => locationRef.current?.focus()}
          blurOnSubmit={false}
          value={title}
          onChangeText={setTitle}
        />

        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          {TYPES.map((t) => {
            const active = eventType === t.value;
            return (
              <Pressable
                key={t.value}
                onPress={() => setEventType(t.value)}
                accessibilityRole="button"
                accessibilityLabel={t.label}
                accessibilityState={{ selected: active }}
                style={[
                  styles.typeChip,
                  {
                    backgroundColor: active ? colors.primarySoft : colors.surface,
                    borderColor: active ? colors.primary : colors.border,
                  },
                ]}
              >
                <Text
                  style={{
                    fontSize: 12.5,
                    fontFamily: fonts.semibold,
                    color: active ? colors.primary : colors.textMuted,
                  }}
                >
                  {t.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Pressable
            style={[styles.pickerButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
            onPress={() => setPicker('date')}
          >
            <Ionicons name="calendar-outline" size={16} color={colors.primary} />
            <Text style={{ fontSize: 14, fontFamily: fonts.semibold, color: colors.text }}>{startLabel}</Text>
          </Pressable>
          <Pressable
            style={[styles.pickerButton, { backgroundColor: colors.surface, borderColor: colors.border, flexGrow: 0 }]}
            onPress={() => setPicker('time')}
          >
            <Ionicons name="time-outline" size={16} color={colors.primary} />
          </Pressable>
        </View>
        {picker ? (
          <InlineDateTimePicker
            value={start}
            mode={picker}
            onChange={setStart}
            onClose={() => setPicker(null)}
          />
        ) : null}

        <TextField
          ref={locationRef}
          placeholder="Location (optional)"
          returnKeyType="done"
          value={location}
          onChangeText={setLocation}
        />

        {contact ? (
          <View style={[styles.contactRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Avatar name={contact.name || contact.phone} size={30} />
            <Text style={{ flex: 1, fontSize: 14.5, fontFamily: fonts.semibold, color: colors.text }}>
              {contact.name || contact.phone}
            </Text>
            <Pressable
              onPress={() => setContact(null)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Remove attached contact"
            >
              <Ionicons name="close-circle" size={18} color={colors.textFaint} />
            </Pressable>
          </View>
        ) : (
          <View style={{ gap: spacing.sm }}>
            <TextField
              placeholder="Attach contact — search name or phone (optional)"
              value={contactSearch}
              onChangeText={setContactSearch}
            />
            {(contactOptions ?? []).map((c) => (
              <Pressable
                key={c.id}
                style={[styles.contactRow, { backgroundColor: colors.surface, borderColor: colors.border }]}
                onPress={() => {
                  setContact(c);
                  setContactSearch('');
                }}
              >
                <Avatar name={c.name || c.phone} size={30} />
                <Text style={{ flex: 1, fontSize: 14.5, color: colors.text }}>
                  {c.name || c.phone}
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        <View style={{ marginTop: spacing.sm }}>
          <PrimaryButton
            label="Schedule"
            busy={saving}
            disabled={!title.trim()}
            onPress={save}
          />
        </View>

        <Text style={{ fontSize: 12, color: colors.textFaint, textAlign: 'center' }}>
          Attached contacts get automatic WhatsApp reminders (morning-of and 1 hour before).
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md },
  typeChip: {
    flex: 1,
    alignItems: 'center',
    borderRadius: radius.full,
    borderWidth: 1,
    paddingVertical: 11,
  },
  pickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
  },
});
