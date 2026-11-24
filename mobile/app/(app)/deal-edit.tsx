import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  AppDialog,
  showAppDialog,
  useAppDialog,
} from '@/components/app-dialog';
import { InlineDateTimePicker } from '@/components/datetime-field';
import { DealInvoices } from '@/components/deal-invoices';
import { ConvoRealLoader } from '@/components/loader';
import {
  ChoiceChip,
  Avatar,
  Banner,
  PriceHint,
  PrimaryButton,
  Tag,
  TextField,
  nameTagCap,
} from '@/components/ui';
import { ApiError, apiFetch } from '@/lib/api';
import { DEAL_SAVED_QUERY_KEYS } from '@/lib/deal-workspace';
import { parseDateOnly } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { queryClient } from '@/lib/query';
import { supabase } from '@/lib/supabase';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { Contact, Deal, PipelineStage } from '@/lib/types';
import { useDebounced } from '@/lib/use-debounced';
import { useAccountCurrency } from '@/lib/use-account-currency';
import {
  CURRENCY_SYMBOLS,
  parseAmountInput,
} from '@shared/lib/format/currency';
import { dealFormMissing } from '@/lib/deal-form';
import {
  DEAL_PARTICIPANT_ROLES,
  DEAL_PARTICIPANT_ROLE_LABELS,
  MAX_DEAL_PARTICIPANTS,
  dealCreateWarning,
  dealTitleFromEvent,
  eventContactIds,
  participantRoleForContact,
  participantRoleForStakeholder,
  participantsFromEvent,
  type DealCreateResult,
  type DealParticipantRole,
} from '@shared/lib/deals/participants';
import { useDiscardGuard } from '@/lib/use-discard-guard';
import { contactHandle, hasPhone } from '@/lib/reachability';
import { dealStatusForStage, isLostStage } from '@/lib/stage-semantics';
import {
  isLostReason,
  lostReasonNeedsNote,
  type LostReason,
} from '@/lib/lost-reasons';
import { LostReasonPicker } from '@/components/lost-reason-sheet';

/**
 * Web parity: the deal form (deal-form.tsx). Creating posts to
 * /api/deals, editing PUTs /api/deals/[id], deleting DELETEs it —
 * all three sync the linked property's status server-side off the
 * stage name. Assignment, brokerage and non-INR currencies stay on
 * the web's fuller form.
 *
 * A deal takes several contacts, each a buyer, a seller or an agent;
 * the first is the deal's own contact and the rest are saved by the
 * same request as stakeholders. With `?appointmentId=`, the form
 * starts from that calendar event's contacts and property, and the
 * new deal is connected to the event.
 *
 * With `?id=`, the deal loads before the form mounts so every field
 * starts at its stored value — no prop-to-state effect to keep in sync.
 */

function localDateString(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

interface PropertyOption {
  id: string;
  title: string;
  property_code: string | null;
  location: string | null;
  sublocality: string | null;
}

interface DealRow extends Deal {
  notes?: string | null;
}

interface DealPerson {
  contact: Contact;
  role: DealParticipantRole;
}

interface DealSeed {
  appointmentId: string | null;
  title: string;
  people: DealPerson[];
  property: PropertyOption | null;
}

const PERSON_COLUMNS = 'id, name, phone, name_tag, classification';

async function loadDealPeople(deal: DealRow): Promise<DealPerson[]> {
  const { data, error } = await supabase
    .from('deal_stakeholders')
    .select(`role, contact:contacts(${PERSON_COLUMNS})`)
    .eq('deal_id', deal.id)
    .not('contact_id', 'is', null)
    .order('created_at');
  if (error) throw error;
  const people: DealPerson[] = [];
  for (const row of (data ?? []) as unknown as {
    role: string;
    contact: Contact | null;
  }[]) {
    const role = participantRoleForStakeholder(row.role);
    if (!role || !row.contact) continue;
    if (people.some((p) => p.contact.id === row.contact!.id)) continue;
    people.push({ contact: row.contact, role });
  }
  const primary = deal.contact ?? null;
  if (!primary) return people;
  const stored = people.find((p) => p.contact.id === primary.id);
  return [
    { contact: primary, role: stored?.role ?? 'buyer' },
    ...people.filter((p) => p.contact.id !== primary.id),
  ];
}

async function loadEventSeed(appointmentId: string): Promise<DealSeed> {
  const { data: event, error } = await supabase
    .from('appointments')
    .select(
      'id, title, contact_id, contact_ids, property_id, property:properties(id, title, property_code, location, sublocality, owner_contact_id)'
    )
    .eq('id', appointmentId)
    .single();
  if (error) throw error;
  const row = event as unknown as {
    id: string;
    title: string;
    contact_id: string | null;
    contact_ids: string[] | null;
    property_id: string | null;
    property: (PropertyOption & { owner_contact_id?: string | null }) | null;
  };
  const ids = eventContactIds(row);
  const { data: contactRows, error: contactError } = ids.length
    ? await supabase.from('contacts').select(PERSON_COLUMNS).in('id', ids)
    : { data: [], error: null };
  if (contactError) throw contactError;
  const contacts = (contactRows ?? []) as Contact[];
  const byId = new Map(contacts.map((c) => [c.id, c]));
  const people = participantsFromEvent(
    row,
    contacts,
    row.property?.owner_contact_id
  ).map((p) => ({ contact: byId.get(p.contact_id)!, role: p.role }));
  const lead = people.find((p) => p.role === 'buyer') ?? people[0];
  return {
    appointmentId: row.id,
    title: dealTitleFromEvent({
      eventTitle: row.title,
      propertyTitle: row.property?.title,
      contactName: lead?.contact.name,
    }),
    people: lead ? [lead, ...people.filter((p) => p !== lead)] : [],
    property: row.property,
  };
}

export default function DealFormScreen() {
  const params = useLocalSearchParams<{
    id?: string;
    pipelineId?: string;
    stageId?: string;
    appointmentId?: string;
  }>();
  const dealId = params.id ?? null;
  const appointmentId = dealId ? null : (params.appointmentId ?? null);

  const existing = useQuery({
    queryKey: ['deal', dealId],
    enabled: Boolean(dealId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('deals')
        .select(
          '*, contact:contacts(id, name, phone, name_tag), property:properties(id, title, property_code, location, sublocality)'
        )
        .eq('id', dealId!)
        .single();
      if (error) throw error;
      return data as DealRow;
    },
  });

  const people = useQuery({
    queryKey: ['deal-people', dealId],
    enabled: Boolean(existing.data),
    gcTime: 0,
    queryFn: () => loadDealPeople(existing.data!),
  });
  const seed = useQuery({
    queryKey: ['deal-event-seed', appointmentId],
    enabled: Boolean(appointmentId),
    gcTime: 0,
    queryFn: () => loadEventSeed(appointmentId!),
  });
  const needsPipeline = !dealId && !params.pipelineId;
  const defaultPipeline = useQuery({
    queryKey: ['pipelines', 'default'],
    enabled: needsPipeline,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pipelines')
        .select('id')
        .order('created_at')
        .limit(1);
      if (error) throw error;
      return (data?.[0]?.id as string | undefined) ?? null;
    },
  });

  const failed =
    existing.isError ||
    people.isError ||
    seed.isError ||
    defaultPipeline.isError ||
    (needsPipeline && defaultPipeline.data === null);
  const waiting =
    (dealId && (!existing.data || !people.data)) ||
    (appointmentId && !seed.data) ||
    (needsPipeline && !defaultPipeline.data);

  if (failed || waiting) {
    return (
      <View style={{ flex: 1 }}>
        <Stack.Screen
          options={{
            headerShown: true,
            title: dealId ? 'Edit deal' : 'New deal',
          }}
        />
        {failed ? (
          <View style={styles.container}>
            <Banner
              kind="error"
              text={
                dealId
                  ? 'Could not load this deal.'
                  : needsPipeline && defaultPipeline.data === null
                    ? 'Open Deals once to set up your pipeline, then try again.'
                    : 'Could not start a deal from this event.'
              }
            />
          </View>
        ) : (
          <ConvoRealLoader style={{ alignSelf: 'center', marginTop: 60 }} />
        )}
      </View>
    );
  }

  return (
    <DealForm
      deal={existing.data ?? null}
      initialPeople={people.data ?? seed.data?.people ?? []}
      seed={seed.data ?? null}
      pipelineId={
        existing.data?.pipeline_id ??
        params.pipelineId ??
        defaultPipeline.data ??
        null
      }
      defaultStageId={existing.data?.stage_id ?? params.stageId ?? null}
    />
  );
}

function DealForm({
  deal,
  initialPeople,
  seed,
  pipelineId,
  defaultStageId,
}: {
  deal: DealRow | null;
  initialPeople: DealPerson[];
  seed: DealSeed | null;
  pipelineId: string | null;
  defaultStageId: string | null;
}) {
  const { colors, fonts: f } = useTheme();
  const dialog = useAppDialog();
  const accountCurrency = useAccountCurrency();
  const dealCurrency = deal?.currency || accountCurrency;

  const [title, setTitle] = useState(deal?.title ?? seed?.title ?? '');
  const [value, setValue] = useState(deal?.value ? String(deal.value) : '');
  const [stageId, setStageId] = useState<string | null>(defaultStageId);
  const [people, setPeople] = useState<DealPerson[]>(initialPeople);
  const contact = people[0]?.contact ?? null;
  const [contactSearch, setContactSearch] = useState('');
  const [property, setProperty] = useState<PropertyOption | null>(
    (deal?.property as PropertyOption | undefined) ?? seed?.property ?? null
  );
  const [propertySearch, setPropertySearch] = useState('');
  const [closeDate, setCloseDate] = useState<Date | null>(
    parseDateOnly(deal?.expected_close_date)
  );
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [actualCloseDate, setActualCloseDate] = useState<Date | null>(
    parseDateOnly(deal?.actual_close_date)
  );
  const [showActualDatePicker, setShowActualDatePicker] = useState(false);
  const [notes, setNotes] = useState(deal?.notes ?? '');
  const [lostReason, setLostReason] = useState<LostReason | null>(
    isLostReason(deal?.lost_reason) ? deal.lost_reason : null
  );
  const [lostNote, setLostNote] = useState(deal?.lost_note ?? '');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const draft = JSON.stringify([
    title,
    value,
    stageId,
    people.map((p) => [p.contact.id, p.role]),
    property?.id ?? null,
    closeDate?.getTime() ?? null,
    actualCloseDate?.getTime() ?? null,
    notes,
    lostReason,
    lostNote,
  ]);
  const [initialDraft] = useState(
    seed
      ? JSON.stringify([
          '',
          '',
          defaultStageId,
          [],
          null,
          null,
          null,
          '',
          null,
          '',
        ])
      : draft
  );
  const allowLeave = useDiscardGuard(
    draft !== initialDraft && !deleting,
    dialog
  );
  const peopleKey = JSON.stringify(people.map((p) => [p.contact.id, p.role]));
  const [initialPeopleKey] = useState(peopleKey);
  const canAddPerson = people.length < MAX_DEAL_PARTICIPANTS;

  const debouncedContactSearch = useDebounced(contactSearch);
  const debouncedPropertySearch = useDebounced(propertySearch);

  const { data: stages } = useQuery({
    queryKey: ['pipeline-stages', pipelineId],
    enabled: Boolean(pipelineId),
    queryFn: async () => {
      const { data, error: stageError } = await supabase
        .from('pipeline_stages')
        .select('*')
        .eq('pipeline_id', pipelineId!)
        .order('position');
      if (stageError) throw stageError;
      return (data ?? []) as PipelineStage[];
    },
  });
  const activeStageId = stageId ?? stages?.[0]?.id ?? null;
  const activeStage = (stages ?? []).find((s) => s.id === activeStageId);
  const lostStageSelected = activeStage ? isLostStage(activeStage) : false;
  const lostReasonMissing =
    lostStageSelected &&
    (!lostReason || (lostReasonNeedsNote(lostReason) && !lostNote.trim()));
  const missing = dealFormMissing({
    title,
    hasContact: Boolean(contact),
    hasStage: Boolean(activeStageId),
    lostReasonMissing,
    creating: !deal,
  });
  const isClosedStage = activeStage
    ? dealStatusForStage(activeStage) !== 'open'
    : false;

  const { data: contactOptions } = useQuery({
    queryKey: ['contact-picker', debouncedContactSearch],
    enabled: debouncedContactSearch.trim().length >= 2 && canAddPerson,
    queryFn: async () => {
      const term = `%${debouncedContactSearch.trim()}%`;
      const { data } = await supabase
        .from('contacts')
        .select(PERSON_COLUMNS)
        .eq('is_merged', false)
        .or(`name.ilike.${term},name_tag.ilike.${term},phone.ilike.${term}`)
        .limit(6);
      return (data ?? []) as Contact[];
    },
  });

  const { data: propertyOptions } = useQuery({
    queryKey: ['deal-property-picker', debouncedPropertySearch],
    enabled: debouncedPropertySearch.trim().length >= 2 && !property,
    queryFn: async () => {
      const term = `%${debouncedPropertySearch.trim()}%`;
      const { data } = await supabase
        .from('properties')
        .select('id, title, property_code, location, sublocality')
        .or(
          `title.ilike.${term},property_code.ilike.${term},location.ilike.${term}`
        )
        .limit(6);
      return (data ?? []) as PropertyOption[];
    },
  });

  async function save() {
    const selectedStage = (stages ?? []).find((s) => s.id === activeStageId);
    if (!title.trim() || !contact || !pipelineId || !selectedStage) return;
    haptic.tap();
    setSaving(true);
    setError(null);
    try {
      const result = await apiFetch<DealCreateResult>(
        deal ? `/api/deals/${deal.id}` : '/api/deals',
        {
          method: deal ? 'PUT' : 'POST',
          body: JSON.stringify({
            title: title.trim(),
            value: parseAmountInput(value) ?? 0,
            currency: dealCurrency,
            contact_id: contact.id,
            source: 'mobile',
            ...(!deal || peopleKey !== initialPeopleKey
              ? {
                  participants: people.map((p) => ({
                    contact_id: p.contact.id,
                    role: p.role,
                  })),
                }
              : {}),
            ...(!deal && seed?.appointmentId
              ? { appointment_id: seed.appointmentId }
              : {}),
            pipeline_id: pipelineId,
            stage_id: selectedStage.id,
            notes: notes.trim() || null,
            expected_close_date: closeDate ? localDateString(closeDate) : null,
            actual_close_date:
              isClosedStage && actualCloseDate
                ? localDateString(actualCloseDate)
                : null,
            property_id: property?.id ?? null,
            status: dealStatusForStage(selectedStage),
            stage_name: selectedStage.name,
            ...(isLostStage(selectedStage) && lostReason
              ? { lost_reason: lostReason, lost_note: lostNote.trim() || null }
              : {}),
          }),
        }
      );
      haptic.success();
      allowLeave();
      for (const queryKey of DEAL_SAVED_QUERY_KEYS) {
        queryClient.invalidateQueries({ queryKey });
      }
      if (deal) {
        queryClient.invalidateQueries({ queryKey: ['deal', deal.id] });
        queryClient.invalidateQueries({
          queryKey: ['deal-stakeholders', deal.id],
        });
      }
      if (seed?.appointmentId) {
        queryClient.invalidateQueries({ queryKey: ['appointments'] });
      }
      const warning = deal ? null : dealCreateWarning(result);
      if (warning) showAppDialog({ title: 'Deal created', message: warning });
      router.back();
    } catch (err) {
      haptic.warn();
      setError(
        err instanceof ApiError
          ? err.message
          : deal
            ? 'Could not save this deal.'
            : 'Could not create the deal.'
      );
      setSaving(false);
    }
  }

  async function remove() {
    if (!deal) return;
    haptic.warn();
    setDeleting(true);
    setError(null);
    try {
      // The route also resets a linked property back to Available.
      await apiFetch(`/api/deals/${deal.id}`, { method: 'DELETE' });
      haptic.success();
      allowLeave();
      for (const queryKey of DEAL_SAVED_QUERY_KEYS) {
        queryClient.invalidateQueries({ queryKey });
      }
      router.back();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not delete this deal.'
      );
      setDeleting(false);
    }
  }

  function confirmDelete() {
    dialog.show({
      title: 'Delete this deal?',
      message: `“${deal?.title}” will be removed for everyone. A linked property goes back to Available.`,
      actions: [
        { label: 'Cancel', variant: 'muted', onPress: dialog.close },
        {
          label: 'Delete',
          variant: 'destructive',
          onPress: () => {
            dialog.close();
            void remove();
          },
        },
      ],
    });
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Stack.Screen
        options={{ headerShown: true, title: deal ? 'Edit deal' : 'New deal' }}
      />
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {error ? <Banner kind="error" text={error} /> : null}

        <TextField
          label="Title"
          placeholder="e.g. 3BHK Prestige Lakeview — Ravi"
          value={title}
          onChangeText={setTitle}
        />

        <TextField
          label={`Deal value (${CURRENCY_SYMBOLS[dealCurrency] ?? dealCurrency})`}
          placeholder="e.g. 1,50,00,000"
          keyboardType="numeric"
          value={value}
          onChangeText={setValue}
        />
        <PriceHint value={parseAmountInput(value)} currency={dealCurrency} />

        {seed ? (
          <Banner
            kind="info"
            text="Started from your calendar event. Check each person's role, then create the deal."
          />
        ) : null}

        {people.length > 0 ? (
          <Text
            style={[
              styles.label,
              { color: colors.textFaint, fontFamily: f.bold },
            ]}
          >
            Contacts on this deal
          </Text>
        ) : null}
        {people.map((person, index) => (
          <View key={person.contact.id} style={{ gap: 6 }}>
            <SelectedRow
              label={person.contact.name || person.contact.phone}
              detail={index === 0 ? 'Primary contact' : null}
              nameTag={person.contact.name_tag}
              avatar
              onClear={() =>
                setPeople((prev) =>
                  prev.filter((p) => p.contact.id !== person.contact.id)
                )
              }
            />
            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: spacing.sm,
              }}
            >
              {DEAL_PARTICIPANT_ROLES.map((role) => (
                <ChoiceChip
                  key={role}
                  label={DEAL_PARTICIPANT_ROLE_LABELS[role]}
                  accessibilityLabel={`${person.contact.name || 'Contact'} is the ${DEAL_PARTICIPANT_ROLE_LABELS[role].toLowerCase()}`}
                  selected={person.role === role}
                  onPress={() => {
                    haptic.tap();
                    setPeople((prev) =>
                      prev.map((p) =>
                        p.contact.id === person.contact.id ? { ...p, role } : p
                      )
                    );
                  }}
                />
              ))}
              {index > 0 ? (
                <Pressable
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Make ${person.contact.name || 'this contact'} the primary contact`}
                  onPress={() => {
                    haptic.tap();
                    setPeople((prev) => [
                      person,
                      ...prev.filter((p) => p.contact.id !== person.contact.id),
                    ]);
                  }}
                >
                  <Text
                    style={{
                      fontSize: 12.5,
                      fontFamily: f.semibold,
                      color: colors.primary,
                    }}
                  >
                    Make primary
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ))}

        {canAddPerson ? (
          <View style={{ gap: spacing.sm }}>
            {people.length > 0 ? (
              <TextField
                label="Add another contact"
                placeholder="Another buyer, seller or agent (optional)"
                value={contactSearch}
                onChangeText={setContactSearch}
              />
            ) : (
              <TextField
                label="Contact"
                placeholder="Search name or phone (required)"
                value={contactSearch}
                onChangeText={setContactSearch}
              />
            )}
            {(contactOptions ?? [])
              .filter((c) => !people.some((p) => p.contact.id === c.id))
              .map((c) => (
                <Pressable
                  key={c.id}
                  style={[
                    styles.optionRow,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                    },
                  ]}
                  onPress={() => {
                    haptic.tap();
                    setPeople((prev) => [
                      ...prev,
                      {
                        contact: c,
                        role: participantRoleForContact(c.classification),
                      },
                    ]);
                    setContactSearch('');
                  }}
                >
                  <Avatar name={c.name || contactHandle(c)} size={30} />
                  <Text
                    style={{
                      flexShrink: 1,
                      fontSize: 14.5,
                      color: colors.text,
                    }}
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
        ) : null}

        {property ? (
          <SelectedRow
            label={property.title}
            detail={property.sublocality || property.location}
            icon="home-outline"
            onClear={() => setProperty(null)}
          />
        ) : (
          <View style={{ gap: spacing.sm }}>
            <TextField
              label="Property"
              placeholder="Search title or code (optional)"
              value={propertySearch}
              onChangeText={setPropertySearch}
            />
            {(propertyOptions ?? []).map((p) => (
              <Pressable
                key={p.id}
                style={[
                  styles.optionRow,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  },
                ]}
                onPress={() => {
                  haptic.tap();
                  setProperty(p);
                  setPropertySearch('');
                }}
              >
                <Ionicons
                  name="home-outline"
                  size={17}
                  color={colors.primary}
                />
                <View style={{ flex: 1, gap: 1 }}>
                  <Text
                    style={{ fontSize: 14.5, color: colors.text }}
                    numberOfLines={1}
                  >
                    {p.title}
                  </Text>
                  <Text
                    style={{ fontSize: 12, color: colors.textFaint }}
                    numberOfLines={1}
                  >
                    {[p.property_code, p.sublocality || p.location]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>
        )}

        <Text
          style={[
            styles.label,
            { color: colors.textFaint, fontFamily: f.bold },
          ]}
        >
          Stage
        </Text>
        <View
          style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}
        >
          {(stages ?? []).map((s) => (
            <ChoiceChip
              key={s.id}
              label={s.name}
              selected={s.id === activeStageId}
              onPress={() => {
                haptic.tap();
                setStageId(s.id);
                // Moving a deal to a closing stage almost always means
                // it closed today; the agent can still change it.
                if (dealStatusForStage(s) !== 'open' && !actualCloseDate) {
                  setActualCloseDate(new Date());
                }
              }}
            />
          ))}
        </View>

        {lostStageSelected ? (
          <LostReasonPicker
            reason={lostReason}
            note={lostNote}
            onReason={setLostReason}
            onNote={setLostNote}
          />
        ) : null}

        <Pressable
          onPress={() => {
            haptic.tap();
            if (!closeDate) {
              const inAMonth = new Date();
              inAMonth.setMonth(inAMonth.getMonth() + 1);
              setCloseDate(inAMonth);
            }
            setShowDatePicker((v) => !v);
          }}
          accessibilityRole="button"
          accessibilityLabel={
            closeDate ? 'Change expected close date' : 'Add expected close date'
          }
          style={[
            styles.dateButton,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Ionicons name="calendar-outline" size={16} color={colors.primary} />
          <Text
            style={{
              flex: 1,
              fontSize: 14,
              fontFamily: f.semibold,
              color: colors.text,
            }}
          >
            {closeDate
              ? `Expected close · ${closeDate.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}`
              : 'Expected close date (optional)'}
          </Text>
          {closeDate ? (
            <Pressable
              onPress={() => {
                setCloseDate(null);
                setShowDatePicker(false);
              }}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Clear expected close date"
            >
              <Ionicons
                name="close-circle"
                size={18}
                color={colors.textFaint}
              />
            </Pressable>
          ) : null}
        </Pressable>
        {showDatePicker && closeDate ? (
          <InlineDateTimePicker
            value={closeDate}
            mode="date"
            onChange={setCloseDate}
            onClose={() => setShowDatePicker(false)}
          />
        ) : null}

        {isClosedStage ? (
          <>
            <Pressable
              onPress={() => {
                haptic.tap();
                if (!actualCloseDate) setActualCloseDate(new Date());
                setShowActualDatePicker((v) => !v);
              }}
              accessibilityRole="button"
              accessibilityLabel={
                actualCloseDate
                  ? 'Change actual close date'
                  : 'Add actual close date'
              }
              style={[
                styles.dateButton,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <Ionicons
                name="checkmark-done-outline"
                size={16}
                color={colors.primary}
              />
              <Text
                style={{
                  flex: 1,
                  fontSize: 14,
                  fontFamily: f.semibold,
                  color: colors.text,
                }}
              >
                {actualCloseDate
                  ? `Actually closed · ${actualCloseDate.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}`
                  : 'Actual close date'}
              </Text>
              {actualCloseDate ? (
                <Pressable
                  onPress={() => {
                    setActualCloseDate(null);
                    setShowActualDatePicker(false);
                  }}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Clear actual close date"
                >
                  <Ionicons
                    name="close-circle"
                    size={18}
                    color={colors.textFaint}
                  />
                </Pressable>
              ) : null}
            </Pressable>
            {showActualDatePicker && actualCloseDate ? (
              <InlineDateTimePicker
                value={actualCloseDate}
                mode="date"
                onChange={setActualCloseDate}
                onClose={() => setShowActualDatePicker(false)}
              />
            ) : null}
          </>
        ) : null}

        {deal ? <DealInvoices dealId={deal.id} /> : null}

        <TextField
          label="Notes"
          placeholder="Optional"
          multiline
          value={notes}
          onChangeText={setNotes}
        />

        <View style={{ marginTop: spacing.sm }}>
          <PrimaryButton
            label={deal ? 'Save changes' : 'Create deal'}
            busy={saving}
            disabled={missing !== null || deleting}
            onPress={save}
          />
          {missing && !saving ? (
            <Text
              style={{
                marginTop: spacing.sm,
                fontSize: 12.5,
                color: colors.textMuted,
                textAlign: 'center',
              }}
            >
              {missing}
            </Text>
          ) : null}
        </View>

        {deal ? (
          <Pressable
            onPress={confirmDelete}
            disabled={saving || deleting}
            accessibilityRole="button"
            accessibilityLabel="Delete this deal"
            style={styles.deleteRow}
          >
            {deleting ? (
              <ActivityIndicator size="small" color={colors.danger} />
            ) : (
              <Ionicons name="trash-outline" size={15} color={colors.danger} />
            )}
            <Text
              style={{ fontSize: 13, fontFamily: f.bold, color: colors.danger }}
            >
              {deleting ? 'Deleting…' : 'Delete deal'}
            </Text>
          </Pressable>
        ) : null}

        <Text
          style={{ fontSize: 12, color: colors.textFaint, textAlign: 'center' }}
        >
          Assignment, brokerage and other currencies live on the web's deal
          form.
        </Text>
      </ScrollView>
      <AppDialog {...dialog.dialogProps} />
    </KeyboardAvoidingView>
  );
}

function SelectedRow({
  label,
  detail,
  nameTag,
  icon,
  avatar,
  onClear,
}: {
  label: string | null | undefined;
  detail?: string | null;
  nameTag?: string | null;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  avatar?: boolean;
  onClear: () => void;
}) {
  const { colors, fonts: f } = useTheme();
  return (
    <View
      style={[
        styles.optionRow,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      {avatar ? (
        <Avatar name={label ?? '?'} size={30} />
      ) : icon ? (
        <Ionicons name={icon} size={17} color={colors.primary} />
      ) : null}
      <View style={{ flex: 1, gap: 1 }}>
        <Text
          style={{ fontSize: 14.5, fontFamily: f.semibold, color: colors.text }}
          numberOfLines={1}
        >
          {label}
        </Text>
        {detail ? (
          <Text
            style={{ fontSize: 12, color: colors.textFaint }}
            numberOfLines={1}
          >
            {detail}
          </Text>
        ) : null}
      </View>
      {nameTag ? <Tag label={nameTag} /> : null}
      <Pressable
        onPress={onClear}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Remove selection"
      >
        <Ionicons name="close-circle" size={18} color={colors.textFaint} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
  },
  label: {
    fontSize: 12.5,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  dateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  deleteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: spacing.md,
  },
});
