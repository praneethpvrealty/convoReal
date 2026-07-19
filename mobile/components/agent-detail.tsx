import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar, PrimaryButton, SectionLabel, Tag, TextField } from '@/components/ui';
import { useAuthStore } from '@/lib/auth-store';
import { friendlyError } from '@/lib/errors';
import { chatListTime, formatInr } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { queryClient } from '@/lib/query';
import { supabase } from '@/lib/supabase';
import { radius, spacing, useTheme } from '@/lib/theme';
import { openWelcomeWhatsApp } from '@/lib/welcome-message';
import type { Appointment, Contact, ContactNote, Property } from '@/lib/types';

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

/** Web Agents tab: properties linked to this agent (owner_contact_id). */
export function AgentProperties({ contactId }: { contactId: string }) {
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
      <SectionLabel text={`Showcase properties${props ? ` (${props.length})` : ''}`} />
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

/** Web Agents tab: contact_notes for this agent — add + newest-first list. */
export function AgentNotes({ contactId }: { contactId: string }) {
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
      <SectionLabel text="Agent notes" />
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
      <AgentNotes contactId={agent.id} />
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
