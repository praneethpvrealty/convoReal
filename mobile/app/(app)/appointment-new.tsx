import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import {
  Stack,
  router,
  useLocalSearchParams,
  useNavigation,
} from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Switch,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type TextInput,
} from 'react-native';

import { AppDialog, useAppDialog } from '@/components/app-dialog';
import {
  PropertyRow,
  fetchLinkedProperty,
  usePropertyOptions,
  type LinkedProperty,
} from '@/components/appointment-property-field';
import { TourTarget } from '@/components/copilot-tour';
import { InlineDateTimePicker } from '@/components/datetime-field';
import {
  Avatar,
  Banner,
  PrimaryButton,
  Tag,
  TextField,
  nameTagCap,
} from '@/components/ui';
import { VoiceScheduler } from '@/components/voice-scheduler';
import { useAuthStore } from '@/lib/auth-store';
import { friendlyError } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { useDebounced } from '@/lib/use-debounced';
import { queryClient } from '@/lib/query';
import { supabase } from '@/lib/supabase';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { AppointmentType, Contact } from '@/lib/types';
import { voiceHints, type VoicePrefill } from '@/lib/voice-event';
import { contactHandle } from '@/lib/reachability';
import { hasUnsavedChanges } from '@/lib/unsaved-changes';
import {
  DEFAULT_EVENT_DURATION_MS,
  PAST_START_CONFIRM,
  eventTimesError,
  startsInPast,
} from '@/lib/event-timing';
import {
  EVENT_TYPE_LABELS,
  EVENT_TYPE_ORDER,
  eventTypeFromParam,
} from '@shared/lib/calendar/event-type-defaults';
import {
  linkedContactForProperty,
  participantsForLinkedProperty,
} from '@shared/lib/calendar/auto-link';
import {
  propertyArea,
  stripPropertyTag,
  titleForLinkedProperty,
  trailingPropertyTag,
} from '@shared/lib/calendar/property-hashtag';

const TYPES = EVENT_TYPE_ORDER.map((value) => ({
  value,
  label: EVENT_TYPE_LABELS[value],
}));

export default function NewAppointmentScreen() {
  const { colors, fonts: f } = useTheme();
  const session = useAuthStore((s) => s.session);
  const accountId = useAuthStore((s) => s.profile?.account_id);
  // Prefill support: the agent detail's Schedule shortcut passes the
  // contact so the picker starts resolved.
  const params = useLocalSearchParams<{
    contactId?: string;
    contactName?: string;
    contactPhone?: string;
    eventType?: string;
    propertyId?: string;
    title?: string;
  }>();

  const [title, setTitle] = useState(params.title ?? '');
  const [eventType, setEventType] = useState<AppointmentType>(
    eventTypeFromParam(params.eventType)
  );
  const [start, setStart] = useState(() => {
    const d = new Date();
    d.setHours(d.getHours() + 1, 0, 0, 0);
    return d;
  });
  const [picker, setPicker] = useState<'date' | 'time' | null>(null);
  const [location, setLocation] = useState('');
  const [contactSearch, setContactSearch] = useState('');
  const debouncedContactSearch = useDebounced(contactSearch);
  const [contacts, setContacts] = useState<Contact[]>(() =>
    params.contactId && params.contactPhone
      ? [
          {
            id: params.contactId,
            name: params.contactName || undefined,
            phone: params.contactPhone,
          } as Contact,
        ]
      : []
  );
  const [remindMe, setRemindMe] = useState(true);
  const [peopleAppliedFor, setPeopleAppliedFor] = useState<string | null>(null);
  const [property, setProperty] = useState<LinkedProperty | null>(null);
  const [propertyCleared, setPropertyCleared] = useState(false);
  const [propertySearch, setPropertySearch] = useState('');
  const locationRef = useRef<TextInput>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [voice, setVoice] = useState<{
    transcript: string | null;
    description: string | null;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const navigation = useNavigation();
  const dialog = useAppDialog();
  const saved = useRef(false);
  const [initialDraft] = useState(() => ({
    title: params.title ?? '',
    type: eventTypeFromParam(params.eventType),
    start: start.toISOString(),
    location: '',
    contact: contacts.map((c) => c.id).join(','),
    property: params.propertyId ?? '',
    remind: true,
  }));
  const dirty =
    voice !== null ||
    hasUnsavedChanges(initialDraft, {
      title,
      type: eventType,
      start: start.toISOString(),
      location,
      contact: contacts.map((c) => c.id).join(','),
      property:
        property?.id ?? (propertyCleared ? '' : (params.propertyId ?? '')),
      remind: remindMe,
    });

  usePreventRemove(dirty && !saving, ({ data }) => {
    if (saved.current) {
      navigation.dispatch(data.action);
      return;
    }
    dialog.show({
      title: 'Discard this appointment?',
      message: 'What you entered has not been scheduled.',
      actions: [
        { label: 'Keep editing', variant: 'muted', onPress: dialog.close },
        {
          label: 'Discard',
          variant: 'destructive',
          onPress: () => {
            dialog.close();
            navigation.dispatch(data.action);
          },
        },
      ],
    });
  });

  const propertyRef = useRef(property);
  const contactsRef = useRef(contacts);
  const propertyClearedRef = useRef(propertyCleared);
  useEffect(() => {
    propertyClearedRef.current = propertyCleared;
  }, [propertyCleared]);
  useEffect(() => {
    propertyRef.current = property;
  }, [property]);
  useEffect(() => {
    contactsRef.current = contacts;
  }, [contacts]);

  const { data: prefilledProperty, isPending: prefillPending } = useQuery({
    queryKey: ['appointment-prefill-property', params.propertyId],
    enabled: Boolean(params.propertyId),
    queryFn: () => fetchLinkedProperty(params.propertyId as string),
  });
  const [prefillApplied, setPrefillApplied] = useState(false);
  if (prefilledProperty && !prefillApplied) {
    setPrefillApplied(true);
    if (!property && !propertyCleared) {
      setProperty(prefilledProperty);
      setTitle((current) =>
        titleForLinkedProperty(
          current,
          EVENT_TYPE_LABELS[eventType],
          prefilledProperty.title
        )
      );
      setLocation((current) => current || propertyArea(prefilledProperty));
    }
  }

  const propertyHeld =
    Boolean(property) || (Boolean(params.propertyId) && !propertyCleared);
  const propertyTag = propertyHeld ? null : trailingPropertyTag(title);
  const { data: tagOptions } = usePropertyOptions(propertyTag, 0);
  const { data: propertyOptions } = usePropertyOptions(
    propertyHeld || propertyTag !== null ? null : propertySearch,
    2
  );

  const { data: propertyPeople } = useQuery({
    queryKey: [
      'appointment-property-people',
      property?.id,
      property?.owner_contact_id,
    ],
    enabled: Boolean(property),
    queryFn: async () => {
      const linked = property as LinkedProperty;
      const columns = 'id, name, name_tag, phone, last_inquired_property_id';
      const { data: enquirers } = await supabase
        .from('contacts')
        .select(columns)
        .eq('status', 'active')
        .eq('last_inquired_property_id', linked.id)
        .order('name')
        .limit(1);
      const { data: owner } = linked.owner_contact_id
        ? await supabase
            .from('contacts')
            .select(columns)
            .eq('status', 'active')
            .eq('id', linked.owner_contact_id)
            .maybeSingle()
        : { data: null };
      return {
        propertyId: linked.id,
        enquirer: linkedContactForProperty(
          linked.id,
          (enquirers ?? []) as Contact[]
        ),
        owner: (owner as Contact | null) ?? null,
      };
    },
  });
  if (
    property &&
    propertyPeople?.propertyId === property.id &&
    peopleAppliedFor !== property.id
  ) {
    setPeopleAppliedFor(property.id);
    const currentIds = contacts.map((c) => c.id);
    const ids = participantsForLinkedProperty(
      currentIds,
      propertyPeople.enquirer?.id ?? null,
      propertyPeople.owner?.id ?? null
    );
    if (ids.length !== currentIds.length) {
      const byId = new Map(contacts.map((c) => [c.id, c]));
      for (const person of [propertyPeople.enquirer, propertyPeople.owner]) {
        if (person && !byId.has(person.id)) byId.set(person.id, person);
      }
      setContacts(
        ids.map((id) => byId.get(id)).filter((c): c is Contact => Boolean(c))
      );
      const notes: string[] = [];
      const { enquirer, owner } = propertyPeople;
      if (enquirer && ids.includes(enquirer.id) && enquirer.id !== owner?.id) {
        if (!currentIds.includes(enquirer.id)) {
          notes.push(
            `Added ${enquirer.name || contactHandle(enquirer)} — they enquired about this property.`
          );
        }
      }
      if (owner && !currentIds.includes(owner.id)) {
        notes.push(
          `Added ${owner.name || contactHandle(owner)} as the property's owner — remove them if they shouldn't get reminders.`
        );
      }
      if (notes.length > 0) setNotice(notes.join(' '));
    }
  }

  async function linkPropertyForContact(contactId: string) {
    const { data } = await supabase
      .from('contacts')
      .select('last_inquired_property_id')
      .eq('id', contactId)
      .maybeSingle();
    const propertyId = (data as { last_inquired_property_id?: string | null })
      ?.last_inquired_property_id;
    if (!propertyId) return;
    const found = await fetchLinkedProperty(propertyId);
    if (!found || propertyRef.current) return;
    if (params.propertyId && !propertyClearedRef.current) return;
    if (!contactsRef.current.some((c) => c.id === contactId)) return;
    setProperty(found);
    setPropertyCleared(false);
    setTitle((current) =>
      titleForLinkedProperty(current, EVENT_TYPE_LABELS[eventType], found.title)
    );
    setLocation((current) => current || propertyArea(found));
    setNotice(`Linked ${found.title} from this contact's enquiry.`);
  }

  function linkProperty(next: LinkedProperty, fromTag: boolean) {
    haptic.tap();
    setProperty(next);
    setPropertyCleared(false);
    setPropertySearch('');
    setTitle((current) =>
      titleForLinkedProperty(
        fromTag ? stripPropertyTag(current) : current,
        EVENT_TYPE_LABELS[eventType],
        next.title
      )
    );
    setLocation((current) => current || propertyArea(next));
  }

  function clearProperty() {
    setProperty(null);
    setPropertyCleared(true);
    setPeopleAppliedFor(null);
  }

  function attachContact(next: Contact) {
    setContactSearch('');
    if (contacts.some((c) => c.id === next.id)) return;
    setContacts((current) =>
      current.some((c) => c.id === next.id) ? current : [...current, next]
    );
    if (!propertyHeld) void linkPropertyForContact(next.id);
  }

  function removeContact(id: string) {
    setContacts((current) => current.filter((c) => c.id !== id));
  }

  function applyVoicePrefill(prefill: VoicePrefill) {
    setError(null);
    setTitle(prefill.title);
    setEventType(prefill.eventType);
    if (prefill.start) setStart(prefill.start);
    if (prefill.location) setLocation(prefill.location);
    if (prefill.contact) attachContact(prefill.contact);
    setVoice({
      transcript: prefill.transcript,
      description: prefill.description,
    });
    const hints = voiceHints(prefill);
    setNotice(
      hints.length > 0
        ? hints.join(' ')
        : 'Filled from voice — review below, then tap Schedule.'
    );
  }

  const { data: contactOptions } = useQuery({
    queryKey: ['contact-picker', debouncedContactSearch],
    enabled: debouncedContactSearch.trim().length >= 2,
    queryFn: async () => {
      const term = `%${debouncedContactSearch.trim()}%`;
      const { data } = await supabase
        .from('contacts')
        .select('id, name, name_tag, phone')
        .eq('is_merged', false)
        .or(`name.ilike.${term},name_tag.ilike.${term},phone.ilike.${term}`)
        .limit(6);
      return (data ?? []) as Contact[];
    },
  });

  // Each control says what it changes. Carrying the time on the date
  // button made the only thing showing a time open the date picker.
  const dateLabel = useMemo(
    () =>
      start.toLocaleDateString([], {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      }),
    [start]
  );
  const timeLabel = useMemo(
    () => start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    [start]
  );

  function requestSave() {
    if (!title.trim() || saving) return;
    if (!startsInPast(start)) {
      void save();
      return;
    }
    dialog.show({
      title: PAST_START_CONFIRM.title,
      message: PAST_START_CONFIRM.message,
      actions: [
        { label: 'Change time', variant: 'muted', onPress: dialog.close },
        {
          label: PAST_START_CONFIRM.confirmLabel,
          variant: 'primary',
          onPress: () => {
            dialog.close();
            void save();
          },
        },
      ],
    });
  }

  async function save() {
    if (!title.trim() || !session || !accountId) return;
    const end = new Date(start.getTime() + DEFAULT_EVENT_DURATION_MS);
    const timesError = eventTimesError(start, end);
    if (timesError) {
      haptic.warn();
      setError(timesError);
      return;
    }
    setSaving(true);
    setError(null);
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
      contact_id: contacts[0]?.id ?? null,
      contact_ids: contacts.map((c) => c.id),
      remind_creator: remindMe,
      property_id:
        property?.id ?? (propertyCleared ? null : (params.propertyId ?? null)),
      ...(voice
        ? {
            source: 'voice',
            transcript: voice.transcript,
            description: voice.description,
          }
        : {}),
    });
    setSaving(false);
    if (insertError) {
      haptic.warn();
      setError(friendlyError(insertError.message));
      return;
    }
    haptic.success();
    queryClient.invalidateQueries({ queryKey: ['appointments'] });
    for (const attached of contacts) {
      queryClient.invalidateQueries({
        queryKey: ['contact-appointments', attached.id],
      });
    }
    saved.current = true;
    router.back();
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'New appointment',
        }}
      />
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {error ? <Banner kind="error" text={error} /> : null}

        <VoiceScheduler
          onParsed={applyVoicePrefill}
          onInfo={(message) => {
            setError(null);
            setNotice(message);
          }}
          onError={(message) => {
            setNotice(null);
            setError(message);
          }}
        />
        {notice ? <Banner kind="info" text={notice} /> : null}

        <TourTarget id="appointment-form">
          <TextField
            placeholder="Title · type # to tag a property"
            returnKeyType="next"
            onSubmitEditing={() => locationRef.current?.focus()}
            blurOnSubmit={false}
            value={title}
            onChangeText={setTitle}
          />
        </TourTarget>
        {propertyTag !== null && (tagOptions ?? []).length > 0 ? (
          <View style={{ gap: spacing.sm }}>
            {(tagOptions ?? []).map((p) => (
              <PropertyRow
                key={p.id}
                property={p}
                onPress={() => linkProperty(p, true)}
              />
            ))}
          </View>
        ) : null}

        <View
          style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}
        >
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
                    backgroundColor: active
                      ? colors.primarySoft
                      : colors.surface,
                    borderColor: active ? colors.primary : colors.border,
                  },
                ]}
              >
                <Text
                  style={{
                    fontSize: 12.5,
                    fontFamily: f.semibold,
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
            style={[
              styles.pickerButton,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
            onPress={() => setPicker('date')}
            accessibilityRole="button"
            accessibilityLabel={`Date — ${dateLabel}`}
          >
            <Ionicons
              name="calendar-outline"
              size={16}
              color={colors.primary}
            />
            <Text
              style={{
                fontSize: 14,
                fontFamily: f.semibold,
                color: colors.text,
              }}
            >
              {dateLabel}
            </Text>
          </Pressable>
          <Pressable
            style={[
              styles.pickerButton,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
            onPress={() => setPicker('time')}
            accessibilityRole="button"
            accessibilityLabel={`Time — ${timeLabel}`}
          >
            <Ionicons name="time-outline" size={16} color={colors.primary} />
            <Text
              style={{
                fontSize: 14,
                fontFamily: f.semibold,
                color: colors.text,
              }}
            >
              {timeLabel}
            </Text>
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

        {property ? (
          <PropertyRow property={property} onClear={clearProperty} />
        ) : params.propertyId && !propertyCleared ? (
          <PropertyRow
            property={{
              id: params.propertyId,
              title: prefillPending ? 'Loading property…' : 'Linked property',
            }}
            onClear={clearProperty}
          />
        ) : propertyTag === null ? (
          <View style={{ gap: spacing.sm }}>
            <TextField
              placeholder="Link property — search title, code or area (optional)"
              value={propertySearch}
              onChangeText={setPropertySearch}
            />
            {(propertyOptions ?? []).map((p) => (
              <PropertyRow
                key={p.id}
                property={p}
                onPress={() => linkProperty(p, false)}
              />
            ))}
          </View>
        ) : null}

        <TextField
          ref={locationRef}
          placeholder="Location (optional)"
          returnKeyType="done"
          value={location}
          onChangeText={setLocation}
        />

        <View style={{ gap: spacing.sm }}>
          {contacts.map((attached) => (
            <View
              key={attached.id}
              style={[
                styles.contactRow,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <Avatar
                name={attached.name || contactHandle(attached)}
                size={30}
              />
              <Text
                style={{
                  flexShrink: 1,
                  fontSize: 14.5,
                  fontFamily: f.semibold,
                  color: colors.text,
                }}
                numberOfLines={1}
              >
                {attached.name || contactHandle(attached)}
              </Text>
              {attached.id === property?.owner_contact_id ? (
                <View style={nameTagCap}>
                  <Tag label="Owner" />
                </View>
              ) : null}
              <View style={{ flex: 1 }} />
              <Pressable
                onPress={() => removeContact(attached.id)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${attached.name || 'contact'}`}
              >
                <Ionicons
                  name="close-circle"
                  size={18}
                  color={colors.textFaint}
                />
              </Pressable>
            </View>
          ))}
          <TextField
            placeholder={
              contacts.length > 0
                ? 'Add another contact — search name or phone'
                : 'Attach contact — search name or phone (optional)'
            }
            value={contactSearch}
            onChangeText={setContactSearch}
          />
          {(contactOptions ?? [])
            .filter((c) => !contacts.some((attached) => attached.id === c.id))
            .map((c) => (
              <Pressable
                key={c.id}
                style={[
                  styles.contactRow,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  },
                ]}
                onPress={() => attachContact(c)}
              >
                <Avatar name={c.name || contactHandle(c)} size={30} />
                <Text
                  style={{ flexShrink: 1, fontSize: 14.5, color: colors.text }}
                  numberOfLines={1}
                >
                  {c.name || c.phone}
                </Text>
                {c.name_tag ? (
                  <View style={nameTagCap}>
                    <Tag label={c.name_tag} />
                  </View>
                ) : null}
              </Pressable>
            ))}
        </View>

        <View
          style={[
            styles.contactRow,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <Text
              style={{
                fontSize: 14.5,
                fontFamily: f.semibold,
                color: colors.text,
              }}
            >
              Remind me
            </Text>
            <Text style={{ fontSize: 12, color: colors.textMuted }}>
              WhatsApp brief before the event and a line in your morning digest,
              as well as the person it is assigned to.
            </Text>
          </View>
          <Switch
            value={remindMe}
            onValueChange={setRemindMe}
            trackColor={{ true: colors.primary }}
            accessibilityLabel="Remind me about this appointment"
          />
        </View>

        <View style={{ marginTop: spacing.sm }}>
          <PrimaryButton
            label="Schedule"
            busy={saving}
            disabled={!title.trim()}
            onPress={requestSave}
          />
        </View>

        <Text
          style={{ fontSize: 12, color: colors.textFaint, textAlign: 'center' }}
        >
          {eventType === 'call'
            ? 'Calls stay internal — only you get the reminder, attached contacts are not messaged.'
            : 'Attached contacts get automatic WhatsApp reminders (morning-of and 1 hour before).'}
        </Text>
      </ScrollView>
      <AppDialog {...dialog.dialogProps} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md },
  typeChip: {
    flexBasis: '30%',
    flexGrow: 1,
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
