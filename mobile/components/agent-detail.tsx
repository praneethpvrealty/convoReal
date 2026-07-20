import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BottomSheet } from '@/components/sheet';
import { Avatar, EmptyState, PrimaryButton, SearchBar, SectionLabel, Tag, TextField } from '@/components/ui';
import { useAuthStore } from '@/lib/auth-store';
import { friendlyError } from '@/lib/errors';
import { chatListTime, formatInr } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { queryClient } from '@/lib/query';
import { supabase } from '@/lib/supabase';
import { radius, spacing, useTheme } from '@/lib/theme';
import { openWelcomeWhatsApp } from '@/lib/welcome-message';
import type { Appointment, Contact, ContactNote, Property, Tag as TagRow } from '@/lib/types';

export async function openConversation(contactId: string) {
  const { data } = await supabase
    .from('conversations')
    .select('id')
    .eq('contact_id', contactId)
    .order('last_message_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (data?.id) {
    router.push(`/(app)/conversation/${data.id}`);
  }
}

/** Properties linked via owner_contact_id — the web Agents tab's
 *  showcase list and the contact detail's "Managed Properties". */
export function AgentProperties({
  contactId,
  title = 'Showcase properties',
}: {
  contactId: string;
  title?: string;
}) {
  const { colors, fonts: f } = useTheme();
  const { data: props } = useQuery({
    queryKey: ['agent-properties', contactId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('properties')
        .select('id, title, location, price, status, images, property_code')
        .eq('owner_contact_id', contactId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as Property[];
    },
  });

  function confirmUnlink(p: Property) {
    Alert.alert(
      'Unlink this property?',
      `"${p.title}" stays in inventory but is no longer showcased under this agent.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unlink',
          style: 'destructive',
          onPress: async () => {
            const { error } = await supabase
              .from('properties')
              .update({ owner_contact_id: null })
              .eq('id', p.id);
            if (error) {
              haptic.warn();
              Alert.alert('Could not unlink', friendlyError(error.message));
              return;
            }
            haptic.success();
            queryClient.invalidateQueries({ queryKey: ['agent-properties', contactId] });
            queryClient.invalidateQueries({ queryKey: ['agents-directory'] });
          },
        },
      ]
    );
  }

  return (
    <View style={{ gap: spacing.sm }}>
      <SectionLabel text={`${title}${props ? ` (${props.length})` : ''}`} />
      {!props || props.length === 0 ? (
        <Text style={{ fontSize: 12.5, color: colors.textFaint }}>
          Nothing linked yet — set this agent as the owner contact on a property to showcase it
          here.
        </Text>
      ) : (
        <View style={[styles.card, { backgroundColor: colors.glass, borderColor: colors.glassBorder }]}>
          {props.map((p) => (
            <Pressable
              key={p.id}
              onPress={() => router.push(`/(app)/property/${p.id}`)}
              accessibilityRole="button"
              accessibilityLabel={`Open property ${p.title}`}
              style={[styles.propertyRow, { borderTopColor: colors.border }]}
            >
              {p.images?.[0] ? (
                <Image source={{ uri: p.images[0] }} style={styles.propertyThumb} />
              ) : (
                <View style={[styles.propertyThumb, { backgroundColor: colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }]}>
                  <Ionicons name="business-outline" size={20} color={colors.textFaint} />
                </View>
              )}
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ fontSize: 14, fontFamily: f.bold, color: colors.text }} numberOfLines={1}>
                  {p.title}
                </Text>
                <Text style={{ fontSize: 12, color: colors.textMuted }} numberOfLines={1}>
                  {[p.location, p.status].filter(Boolean).join(' · ')}
                </Text>
                <Text style={{ fontSize: 12.5, fontFamily: f.bold, color: colors.primary }}>
                  {formatInr(p.price)}
                </Text>
              </View>
              <Pressable
                hitSlop={10}
                onPress={() => confirmUnlink(p)}
                accessibilityRole="button"
                accessibilityLabel={`Unlink ${p.title}`}
              >
                <Ionicons name="unlink-outline" size={18} color={colors.textMuted} />
              </Pressable>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

/**
 * Web contact detail's "Interested Properties": the listings a buyer
 * inquired about or was marked interested in. Source of truth is the
 * contact_property_inquiries junction (web parity) plus the contact's
 * last_inquired_property_id pointer. Assign via the picker, unlink per
 * row — mirrors handleLinkInterestProperty/handleRemoveInquiredProperty.
 */
export function InterestedProperties({ contact }: { contact: Contact }) {
  const { colors, fonts: f } = useTheme();
  const [picking, setPicking] = useState(false);

  const { data: props } = useQuery({
    queryKey: ['interested-properties', contact.id],
    queryFn: async () => {
      const { data: inquiries, error: inqError } = await supabase
        .from('contact_property_inquiries')
        .select('property_id')
        .eq('contact_id', contact.id);
      if (inqError) throw inqError;
      const ids = Array.from(
        new Set(
          [
            ...(inquiries ?? []).map((i: { property_id: string }) => i.property_id),
            contact.last_inquired_property_id,
          ].filter((v): v is string => Boolean(v))
        )
      );
      if (ids.length === 0) return [] as Property[];
      const { data, error } = await supabase
        .from('properties')
        .select('id, title, location, price, status, images, property_code')
        .in('id', ids);
      if (error) throw error;
      return (data ?? []) as Property[];
    },
  });

  async function assign(propertyId: string) {
    const { error: updateError } = await supabase
      .from('contacts')
      .update({ last_inquired_property_id: propertyId })
      .eq('id', contact.id);
    const { error: inqError } = await supabase
      .from('contact_property_inquiries')
      .upsert(
        { contact_id: contact.id, property_id: propertyId, inquiry_source: 'Manual' },
        { onConflict: 'contact_id,property_id' }
      );
    if (updateError || inqError) {
      haptic.warn();
      Alert.alert('Could not assign', friendlyError((updateError ?? inqError)!.message));
      return;
    }
    haptic.success();
    setPicking(false);
    queryClient.invalidateQueries({ queryKey: ['interested-properties', contact.id] });
    queryClient.invalidateQueries({ queryKey: ['contact', contact.id] });
    queryClient.invalidateQueries({ queryKey: ['contacts'] });
  }

  function confirmRemove(p: Property) {
    Alert.alert('Remove interest?', `"${p.title}" will no longer be linked to this contact.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase
            .from('contact_property_inquiries')
            .delete()
            .eq('contact_id', contact.id)
            .eq('property_id', p.id);
          if (error) {
            haptic.warn();
            Alert.alert('Could not remove', friendlyError(error.message));
            return;
          }
          if (contact.last_inquired_property_id === p.id) {
            await supabase
              .from('contacts')
              .update({ last_inquired_property_id: null })
              .eq('id', contact.id);
          }
          haptic.success();
          queryClient.invalidateQueries({ queryKey: ['interested-properties', contact.id] });
          queryClient.invalidateQueries({ queryKey: ['contact', contact.id] });
          queryClient.invalidateQueries({ queryKey: ['contacts'] });
        },
      },
    ]);
  }

  const excludeIds = (props ?? []).map((p) => p.id);

  return (
    <View style={{ gap: spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <SectionLabel text={`Interested properties${props ? ` (${props.length})` : ''}`} />
        <Pressable
          onPress={() => setPicking(true)}
          accessibilityRole="button"
          accessibilityLabel="Assign interest property"
          style={[styles.scheduleButton, { backgroundColor: colors.primarySoft }]}
        >
          <Ionicons name="add" size={15} color={colors.primary} />
          <Text style={{ fontSize: 12.5, fontFamily: f.bold, color: colors.primary }}>Assign</Text>
        </Pressable>
      </View>
      {props && props.length === 0 ? (
        <Text style={{ fontSize: 12.5, color: colors.textFaint }}>
          No interest properties yet — tap Assign to link a listing this contact inquired about.
        </Text>
      ) : (
        <View style={[styles.card, { backgroundColor: colors.glass, borderColor: colors.glassBorder }]}>
          {(props ?? []).map((p) => (
            <Pressable
              key={p.id}
              onPress={() => router.push(`/(app)/property/${p.id}`)}
              accessibilityRole="button"
              accessibilityLabel={`Open property ${p.title}`}
              style={[styles.propertyRow, { borderTopColor: colors.border }]}
            >
              {p.images?.[0] ? (
                <Image source={{ uri: p.images[0] }} style={styles.propertyThumb} />
              ) : (
                <View style={[styles.propertyThumb, { backgroundColor: colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }]}>
                  <Ionicons name="business-outline" size={20} color={colors.textFaint} />
                </View>
              )}
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ fontSize: 14, fontFamily: f.bold, color: colors.text }} numberOfLines={1}>
                  {p.property_code ? `[${p.property_code}] ` : ''}
                  {p.title}
                </Text>
                <Text style={{ fontSize: 12, color: colors.textMuted }} numberOfLines={1}>
                  {[p.location, p.status].filter(Boolean).join(' · ')}
                </Text>
                <Text style={{ fontSize: 12.5, fontFamily: f.bold, color: colors.primary }}>
                  {formatInr(p.price)}
                </Text>
              </View>
              <Pressable
                hitSlop={10}
                onPress={() => confirmRemove(p)}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${p.title}`}
              >
                <Ionicons name="unlink-outline" size={18} color={colors.textMuted} />
              </Pressable>
            </Pressable>
          ))}
        </View>
      )}
      <PropertyPicker
        visible={picking}
        excludeIds={excludeIds}
        onClose={() => setPicking(false)}
        onSelect={assign}
      />
    </View>
  );
}

/** Search-and-pick modal over inventory, used to assign interest properties. */
function PropertyPicker({
  visible,
  excludeIds,
  onClose,
  onSelect,
}: {
  visible: boolean;
  excludeIds: string[];
  onClose: () => void;
  onSelect: (propertyId: string) => void;
}) {
  const { colors, fonts: f } = useTheme();
  const [q, setQ] = useState('');

  const { data: results, isLoading } = useQuery({
    queryKey: ['property-picker', q],
    enabled: visible,
    queryFn: async () => {
      let query = supabase
        .from('properties')
        .select('id, title, location, price, status, images, property_code')
        .order('created_at', { ascending: false })
        .limit(25);
      const term = q.trim();
      if (term) {
        query = query.or(
          `title.ilike.%${term}%,property_code.ilike.%${term}%,location.ilike.%${term}%`
        );
      }
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as Property[];
    },
  });

  const filtered = (results ?? []).filter((p) => !excludeIds.includes(p.id));

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Assign property">
      <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
        <SearchBar
          value={q}
          onChangeText={setQ}
          placeholder="Search by title, code or location"
          autoFocus
        />
        <View style={{ maxHeight: 400 }}>
          {isLoading ? (
            <View style={{ paddingVertical: spacing.xl, alignItems: 'center' }}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon="business-outline"
              title="No properties found"
              subtitle="Try a different search term."
            />
          ) : (
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ gap: spacing.sm }}
            >
              {filtered.map((p) => (
                <Pressable
                  key={p.id}
                  onPress={() => onSelect(p.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Assign ${p.title}`}
                  style={[styles.pickerRow, { backgroundColor: colors.glass, borderColor: colors.glassBorder }]}
                >
                  {p.images?.[0] ? (
                    <Image source={{ uri: p.images[0] }} style={styles.propertyThumb} />
                  ) : (
                    <View style={[styles.propertyThumb, { backgroundColor: colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }]}>
                      <Ionicons name="business-outline" size={20} color={colors.textFaint} />
                    </View>
                  )}
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ fontSize: 14, fontFamily: f.bold, color: colors.text }} numberOfLines={1}>
                      {p.property_code ? `[${p.property_code}] ` : ''}
                      {p.title}
                    </Text>
                    <Text style={{ fontSize: 12, color: colors.textMuted }} numberOfLines={1}>
                      {[p.location, p.status].filter(Boolean).join(' · ')}
                    </Text>
                    <Text style={{ fontSize: 12.5, fontFamily: f.bold, color: colors.primary }}>
                      {formatInr(p.price)}
                    </Text>
                  </View>
                  <Ionicons name="add-circle" size={22} color={colors.primary} />
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>
      </View>
    </BottomSheet>
  );
}

/**
 * Contact tags: toggle the account's tags on/off for this contact via
 * the contact_tags join — web parity with the detail view's Tags tab.
 */
export function ContactTags({ contactId }: { contactId: string }) {
  const { colors, fonts: f } = useTheme();

  const { data } = useQuery({
    queryKey: ['contact-tags', contactId],
    queryFn: async () => {
      const [allRes, linkedRes] = await Promise.all([
        supabase.from('tags').select('id, name, color').order('name'),
        supabase.from('contact_tags').select('tag_id').eq('contact_id', contactId),
      ]);
      if (allRes.error) throw allRes.error;
      if (linkedRes.error) throw linkedRes.error;
      return {
        all: (allRes.data ?? []) as TagRow[],
        linked: new Set((linkedRes.data ?? []).map((r: { tag_id: string }) => r.tag_id)),
      };
    },
  });

  async function toggle(tagId: string, selected: boolean) {
    if (selected) {
      const { error } = await supabase
        .from('contact_tags')
        .delete()
        .eq('contact_id', contactId)
        .eq('tag_id', tagId);
      if (error) {
        haptic.warn();
        Alert.alert('Could not update tags', friendlyError(error.message));
        return;
      }
    } else {
      const { error } = await supabase
        .from('contact_tags')
        .insert({ contact_id: contactId, tag_id: tagId });
      if (error) {
        haptic.warn();
        Alert.alert('Could not update tags', friendlyError(error.message));
        return;
      }
    }
    haptic.tap();
    queryClient.invalidateQueries({ queryKey: ['contact-tags', contactId] });
    queryClient.invalidateQueries({ queryKey: ['contacts'] });
  }

  return (
    <View style={{ gap: spacing.sm }}>
      <SectionLabel text="Tags" />
      {!data ? null : data.all.length === 0 ? (
        <Text style={{ fontSize: 12.5, color: colors.textFaint }}>
          No tags created yet — add tags from the web app, then apply them here.
        </Text>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {data.all.map((t) => {
            const selected = data.linked.has(t.id);
            return (
              <Pressable
                key={t.id}
                onPress={() => toggle(t.id, selected)}
                accessibilityRole="button"
                accessibilityLabel={`${selected ? 'Remove' : 'Add'} tag ${t.name}`}
                accessibilityState={{ selected }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 5,
                  paddingHorizontal: 12,
                  paddingVertical: 7,
                  borderRadius: radius.full,
                  backgroundColor: selected ? colors.primarySoft : colors.surface,
                  borderWidth: selected ? 1.5 : StyleSheet.hairlineWidth,
                  borderColor: selected ? colors.primary : colors.border,
                }}
              >
                {t.color ? (
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.color }} />
                ) : null}
                <Text
                  style={{
                    fontSize: 13,
                    fontFamily: f.semibold,
                    color: selected ? colors.primary : colors.textMuted,
                  }}
                >
                  {t.name}
                </Text>
                {selected ? <Ionicons name="checkmark" size={13} color={colors.primary} /> : null}
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

/** Web Agents tab: contact_notes for this contact — add + newest-first list. */
export function AgentNotes({ contactId, title = 'Notes' }: { contactId: string; title?: string }) {
  const { colors } = useTheme();
  const session = useAuthStore((s) => s.session);
  const accountId = useAuthStore((s) => s.profile?.account_id);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  const { data: notes } = useQuery({
    queryKey: ['contact-notes', contactId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contact_notes')
        .select('id, contact_id, note_text, created_at')
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as ContactNote[];
    },
  });

  async function addNote() {
    if (!text.trim() || !session || !accountId) return;
    setSaving(true);
    const { error } = await supabase.from('contact_notes').insert({
      contact_id: contactId,
      user_id: session.user.id,
      account_id: accountId,
      note_text: text.trim(),
    });
    setSaving(false);
    if (error) {
      haptic.warn();
      Alert.alert('Could not add note', friendlyError(error.message));
      return;
    }
    haptic.success();
    setText('');
    queryClient.invalidateQueries({ queryKey: ['contact-notes', contactId] });
  }

  return (
    <View style={{ gap: spacing.sm }}>
      <SectionLabel text={title} />
      <TextField
        placeholder="Add brief details, todo points, tasks…"
        value={text}
        onChangeText={setText}
        multiline
      />
      <PrimaryButton label="Add note" busy={saving} disabled={!text.trim()} onPress={addNote} />
      {(notes ?? []).map((n) => (
        <View
          key={n.id}
          style={[styles.noteCard, { backgroundColor: colors.glass, borderColor: colors.glassBorder }]}
        >
          <Text style={{ fontSize: 13.5, lineHeight: 19, color: colors.text }}>{n.note_text}</Text>
          <Text style={{ fontSize: 11, color: colors.textFaint }}>{chatListTime(n.created_at)}</Text>
        </View>
      ))}
      {notes && notes.length === 0 ? (
        <Text style={{ fontSize: 12.5, color: colors.textFaint, textAlign: 'center' }}>
          No notes recorded yet
        </Text>
      ) : null}
    </View>
  );
}

const EVENT_ICONS: Record<string, React.ComponentProps<typeof Ionicons>['name']> = {
  site_visit: 'location-outline',
  meeting: 'people-outline',
  call: 'call-outline',
  follow_up: 'repeat-outline',
  document: 'document-text-outline',
  other: 'calendar-outline',
};

/**
 * Web Agents tab SCHEDULE: every appointment involving this contact —
 * primary attendee OR in the multi-attendee contact_ids array —
 * upcoming first, recent history below, plus a prefilled Schedule
 * shortcut into the new-appointment form.
 */
export function AgentSchedule({ contact }: { contact: Contact }) {
  const { colors, fonts: f } = useTheme();
  const { data: rows } = useQuery({
    queryKey: ['contact-appointments', contact.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('appointments')
        .select('id, title, start_time, location, status, event_type')
        .or(`contact_id.eq.${contact.id},contact_ids.cs.{${contact.id}}`)
        .order('start_time', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as Appointment[];
    },
  });

  const now = Date.now();
  const upcoming = (rows ?? [])
    .filter((r) => r.status === 'scheduled' && new Date(r.start_time).getTime() >= now)
    .sort((a, b) => a.start_time.localeCompare(b.start_time));
  const history = (rows ?? []).filter((r) => !upcoming.includes(r)).slice(0, 10);

  function statusColor(status: Appointment['status']) {
    if (status === 'completed') return colors.success;
    if (status === 'cancelled') return colors.danger;
    return colors.primary;
  }

  function renderRow(appt: Appointment) {
    const when = new Date(appt.start_time);
    return (
      <View key={appt.id} style={[styles.apptRow, { borderTopColor: colors.border }]}>
        <View style={[styles.apptIcon, { backgroundColor: colors.surfaceSunken }]}>
          <Ionicons
            name={EVENT_ICONS[appt.event_type ?? 'other'] ?? EVENT_ICONS.other}
            size={16}
            color={colors.primary}
          />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text
              style={{ fontSize: 13.5, fontFamily: f.bold, color: colors.text, flexShrink: 1 }}
              numberOfLines={1}
            >
              {appt.title || 'Appointment'}
            </Text>
            <Tag label={appt.status} color={statusColor(appt.status)} />
          </View>
          <Text style={{ fontSize: 12, color: colors.textMuted }} numberOfLines={1}>
            {when.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} ·{' '}
            {when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            {appt.location ? `  ·  ${appt.location}` : ''}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={{ gap: spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <SectionLabel text="Schedule" />
        <Pressable
          onPress={() =>
            router.push(
              `/(app)/appointment-new?contactId=${contact.id}&contactName=${encodeURIComponent(contact.name ?? '')}&contactPhone=${encodeURIComponent(contact.phone)}`
            )
          }
          accessibilityRole="button"
          accessibilityLabel={`Schedule with ${contact.name || contact.phone}`}
          style={[styles.scheduleButton, { backgroundColor: colors.primarySoft }]}
        >
          <Ionicons name="add" size={15} color={colors.primary} />
          <Text style={{ fontSize: 12.5, fontFamily: f.bold, color: colors.primary }}>
            Schedule
          </Text>
        </Pressable>
      </View>
      {rows && rows.length === 0 ? (
        <Text style={{ fontSize: 12.5, color: colors.textFaint }}>
          No appointments with this contact yet.
        </Text>
      ) : (
        <View style={[styles.card, { backgroundColor: colors.glass, borderColor: colors.glassBorder }]}>
          {upcoming.map(renderRow)}
          {history.map(renderRow)}
        </View>
      )}
    </View>
  );
}

/** Web Agents tab: the requirements/brief editor on the detail pane. */
export function AgentRequirements({ agent }: { agent: Contact }) {
  const [text, setText] = useState(agent.requirements ?? '');
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const { error } = await supabase
      .from('contacts')
      .update({ requirements: text.trim() || null, updated_at: new Date().toISOString() })
      .eq('id', agent.id);
    setSaving(false);
    if (error) {
      haptic.warn();
      Alert.alert('Could not save', friendlyError(error.message));
      return;
    }
    haptic.success();
    queryClient.invalidateQueries({ queryKey: ['agents-directory'] });
    queryClient.invalidateQueries({ queryKey: ['contact', agent.id] });
  }

  return (
    <View style={{ gap: spacing.sm }}>
      <SectionLabel text="Requirements & brief" />
      <TextField
        placeholder="Agent focus, target sublocalities, client profile, matching preferences…"
        value={text}
        onChangeText={setText}
        multiline
      />
      <PrimaryButton
        label="Save requirements"
        busy={saving}
        disabled={text === (agent.requirements ?? '')}
        onPress={save}
      />
    </View>
  );
}

/**
 * The right pane of the desktop Agents Directory: profile header with
 * the action row (call / WhatsApp / inbox / journey), the requirements
 * editor, showcase properties and notes — rendered beside the list on
 * wide screens.
 */
export function AgentDetail({ agent }: { agent: Contact }) {
  const { colors, fonts: f } = useTheme();
  const name = agent.name || 'Unnamed Agent';

  const actions = [
    {
      icon: 'call' as const,
      label: 'Call',
      onPress: () => Linking.openURL(`tel:${agent.phone}`),
    },
    {
      icon: 'logo-whatsapp' as const,
      label: 'WhatsApp',
      onPress: () => openWelcomeWhatsApp(agent),
    },
    {
      icon: 'chatbubbles' as const,
      label: 'Inbox',
      onPress: () => openConversation(agent.id),
    },
    {
      icon: 'map-outline' as const,
      label: 'Journey',
      onPress: () => router.push(`/(app)/journey?contactId=${agent.id}`),
    },
  ];

  return (
    <View style={{ gap: spacing.lg }}>
      <View style={styles.header}>
        <Avatar name={agent.name || agent.phone} size={64} />
        <View style={{ flex: 1, gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <Text style={{ fontSize: 20, fontFamily: f.extrabold, color: colors.text, letterSpacing: -0.3 }}>
              {name}
            </Text>
            {agent.name_tag ? <Tag label={agent.name_tag} /> : null}
            <Tag label="Agent" color={colors.readTick} />
          </View>
          <Text style={{ fontSize: 13, color: colors.textMuted }} numberOfLines={1}>
            {[agent.company, agent.phone, agent.email].filter(Boolean).join(' · ')}
          </Text>
        </View>
      </View>

      <View style={styles.actions}>
        {actions.map((a) => (
          <Pressable
            key={a.label}
            onPress={a.onPress}
            accessibilityRole="button"
            accessibilityLabel={a.label}
            style={[styles.actionButton, { backgroundColor: colors.glass, borderColor: colors.glassBorder }]}
          >
            <Ionicons name={a.icon} size={19} color={colors.primary} />
            <Text style={{ fontSize: 12.5, fontFamily: f.semibold, color: colors.text }}>
              {a.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <AgentProperties contactId={agent.id} />
      <AgentRequirements key={`req-${agent.id}`} agent={agent} />
      <AgentSchedule contact={agent} />
      <AgentNotes contactId={agent.id} title="Agent notes" />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  propertyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  propertyThumb: { width: 52, height: 52, borderRadius: radius.sm },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  noteCard: {
    gap: 6,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.md,
  },
  apptRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  apptIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scheduleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: radius.full,
    paddingLeft: 8,
    paddingRight: 12,
    minHeight: 32,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  actionButton: {
    alignItems: 'center',
    gap: 4,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 10,
    width: 92,
  },
});
