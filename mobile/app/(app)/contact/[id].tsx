import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Avatar, Banner, PrimaryButton, SectionLabel, Tag, TextField } from '@/components/ui';
import { useAuthStore } from '@/lib/auth-store';
import { chatListTime, formatInr } from '@/lib/format';
import { friendlyError } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { queryClient } from '@/lib/query';
import { supabase } from '@/lib/supabase';
import { classificationColors, radius, spacing, useTheme , fonts } from '@/lib/theme';
import {
  CLASSIFICATIONS,
  type Classification,
  type Contact,
  type ContactNote,
  type Property,
} from '@/lib/types';

async function fetchContact(id: string): Promise<Contact | null> {
  const { data, error } = await supabase
    .from('contacts')
    .select(
      'id, phone, secondary_phones, name, name_tag, email, company, classification, ' +
        'avatar_url, min_budget, max_budget, no_budget, areas_of_interest, requirements, ' +
        'lead_temp, status, referrer, source'
    )
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data as Contact | null;
}

export default function ContactDetailScreen() {
  const { colors, fonts: f } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [editing, setEditing] = useState(false);

  const { data: contact, isLoading } = useQuery({
    queryKey: ['contact', id],
    queryFn: () => fetchContact(id),
    enabled: Boolean(id),
    // Keep the previous contact (and the agent strip) rendered while
    // the switcher swaps the route param.
    placeholderData: (prev: Contact | null | undefined) => prev,
  });

  // Agent switcher strip: from one agent's screen, hop straight to
  // another agent without going back through the contacts list.
  const isAgent = contact?.classification === 'Agent';
  const { data: agentPeers } = useQuery({
    queryKey: ['agent-peers'],
    enabled: isAgent,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contacts')
        .select('id, name, phone')
        .eq('classification', 'Agent')
        .order('name');
      if (error) throw error;
      return (data ?? []) as Pick<Contact, 'id' | 'name' | 'phone'>[];
    },
  });

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: contact?.name || contact?.phone || 'Contact',
          headerRight: () =>
            contact ? (
              <Pressable onPress={() => setEditing((e) => !e)} hitSlop={8}>
                <Text style={{ color: colors.primary, fontSize: 15.5, fontFamily: f.bold }}>
                  {editing ? 'Cancel' : 'Edit'}
                </Text>
              </Pressable>
            ) : null,
        }}
      />
      {isLoading || !contact ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <>
          {!editing && isAgent && (agentPeers?.length ?? 0) > 1 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ flexGrow: 0 }}
              contentContainerStyle={styles.agentStrip}
            >
              {agentPeers!.map((a) => {
                const active = a.id === contact.id;
                return (
                  <Pressable
                    key={a.id}
                    onPress={() => {
                      if (!active) router.setParams({ id: a.id });
                    }}
                    style={[
                      styles.agentChip,
                      {
                        backgroundColor: active ? colors.primarySoft : colors.glass,
                        borderColor: active ? colors.primary : colors.glassBorder,
                      },
                    ]}
                  >
                    <Avatar name={a.name || a.phone} size={20} />
                    <Text
                      style={{
                        fontSize: 12,
                        fontFamily: f.semibold,
                        color: active ? colors.primary : colors.textMuted,
                      }}
                    >
                      {(a.name || a.phone).split(' ')[0]}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}
          {editing ? (
            <ContactEditor contact={contact} onDone={() => setEditing(false)} />
          ) : (
            <ContactCard contact={contact} />
          )}
        </>
      )}
    </View>
  );
}

function ContactCard({ contact }: { contact: Contact }) {
  const { colors, dark, fonts: f } = useTheme();
  const name = contact.name || contact.phone;
  const clsColor = contact.classification
    ? classificationColors[contact.classification]?.[dark ? 'dark' : 'light']
    : undefined;

  const budget =
    contact.no_budget
      ? 'No budget constraint'
      : contact.min_budget || contact.max_budget
        ? `${formatInr(contact.min_budget)} – ${formatInr(contact.max_budget)}`
        : null;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      {contact.status === 'pending_review' ? <ReviewBanner contact={contact} /> : null}
      <View style={styles.identity}>
        <Avatar name={name} size={72} />
        <Text style={[styles.name, { color: colors.text, fontFamily: f.extrabold }]}>{name}</Text>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
          {contact.classification ? (
            <Tag label={contact.classification} color={clsColor} />
          ) : null}
          {contact.name_tag ? <Tag label={contact.name_tag} /> : null}
          {contact.lead_temp ? (
            <Tag
              label={contact.lead_temp}
              color={contact.lead_temp === 'HOT' ? colors.danger : colors.textMuted}
            />
          ) : null}
        </View>
      </View>

      <View style={styles.actions}>
        <ActionButton
          icon="call"
          label="Call"
          onPress={() => Linking.openURL(`tel:${contact.phone}`)}
        />
        <ActionButton
          icon="logo-whatsapp"
          label="WhatsApp"
          onPress={() =>
            Linking.openURL(`https://wa.me/${contact.phone.replace(/\D/g, '')}`)
          }
        />
        <ActionButton icon="chatbubbles" label="Inbox" onPress={() => openConversation(contact.id)} />
        {contact.classification === 'Agent' ? (
          <ActionButton
            icon="map-outline"
            label="Journey"
            onPress={() => router.push(`/(app)/journey?contactId=${contact.id}`)}
          />
        ) : null}
      </View>

      <View style={[styles.card, { backgroundColor: colors.glass, borderColor: colors.glassBorder }]}>
        <InfoRow icon="call-outline" label="Phone" value={contact.phone} />
        {contact.secondary_phones?.length ? (
          <InfoRow
            icon="call-outline"
            label="Other phones"
            value={contact.secondary_phones.join(', ')}
          />
        ) : null}
        {contact.email ? (
          <InfoRow icon="mail-outline" label="Email" value={contact.email} />
        ) : null}
        {contact.company ? (
          <InfoRow icon="business-outline" label="Company" value={contact.company} />
        ) : null}
        {budget ? <InfoRow icon="cash-outline" label="Budget" value={budget} /> : null}
        {contact.areas_of_interest?.length ? (
          <InfoRow
            icon="location-outline"
            label="Areas of interest"
            value={contact.areas_of_interest.join(', ')}
          />
        ) : null}
        {contact.requirements ? (
          <InfoRow icon="list-outline" label="Requirements" value={contact.requirements} />
        ) : null}
      </View>

      {contact.classification === 'Agent' ? (
        <>
          <AgentProperties contactId={contact.id} />
          <AgentNotes contactId={contact.id} />
        </>
      ) : null}

      <Text style={{ fontSize: 12, color: colors.textFaint, textAlign: 'center' }}>
        Budgets, areas and deeper profile fields are edited on the web for now.
      </Text>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

/**
 * Web parity: contacts arriving from portals/imports land as
 * pending_review; approving flips them active (contact-detail-view's
 * approveContact). Sending property details on approve stays in the
 * conversation thread.
 */
function ReviewBanner({ contact }: { contact: Contact }) {
  const { colors, fonts: f } = useTheme();
  const [busy, setBusy] = useState(false);

  async function approve() {
    setBusy(true);
    const { error } = await supabase
      .from('contacts')
      .update({ status: 'active', updated_at: new Date().toISOString() })
      .eq('id', contact.id);
    setBusy(false);
    if (error) {
      haptic.warn();
      Alert.alert('Could not approve', friendlyError(error.message));
      return;
    }
    haptic.success();
    queryClient.invalidateQueries({ queryKey: ['contact', contact.id] });
    queryClient.invalidateQueries({ queryKey: ['contacts'] });
    queryClient.invalidateQueries({ queryKey: ['contact-counts'] });
  }

  return (
    <View
      style={[
        styles.reviewBanner,
        { backgroundColor: colors.warningSoft, borderColor: colors.warning },
      ]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontSize: 13.5, fontFamily: f.bold, color: colors.warning }}>
          Needs review
        </Text>
        <Text style={{ fontSize: 12, color: colors.textMuted }} numberOfLines={2}>
          From {contact.referrer || contact.source || 'an external source'} — approve to move it
          into your active contacts.
        </Text>
      </View>
      <Pressable
        onPress={approve}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="Approve contact"
        style={[styles.approveButton, { backgroundColor: colors.warning, opacity: busy ? 0.6 : 1 }]}
      >
        {busy ? (
          <ActivityIndicator size="small" color="#FFFFFF" />
        ) : (
          <>
            <Ionicons name="checkmark" size={16} color="#FFFFFF" />
            <Text style={{ fontSize: 13.5, fontFamily: f.bold, color: '#FFFFFF' }}>Approve</Text>
          </>
        )}
      </Pressable>
    </View>
  );
}

/** Web Agents tab: properties linked to this agent (owner_contact_id). */
function AgentProperties({ contactId }: { contactId: string }) {
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
function AgentNotes({ contactId }: { contactId: string }) {
  const { colors, fonts: f } = useTheme();
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

async function openConversation(contactId: string) {
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

function ContactEditor({ contact, onDone }: { contact: Contact; onDone: () => void }) {
  const { colors, dark, fonts: f } = useTheme();
  const [name, setName] = useState(contact.name ?? '');
  const [nameTag, setNameTag] = useState(contact.name_tag ?? '');
  const [email, setEmail] = useState(contact.email ?? '');
  const [company, setCompany] = useState(contact.company ?? '');
  const [requirements, setRequirements] = useState(contact.requirements ?? '');
  const [classification, setClassification] = useState<Classification | undefined>(
    contact.classification
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    const cleanEmail = email.trim();
    if (cleanEmail && !/^\S+@\S+\.\S+$/.test(cleanEmail)) {
      setError('That email address doesn\u2019t look right \u2014 check it and try again.');
      return;
    }
    setSaving(true);
    setError(null);
    const { error: updateError } = await supabase
      .from('contacts')
      .update({
        name: name.trim() || null,
        name_tag: nameTag.trim() || null,
        email: email.trim() || null,
        company: company.trim() || null,
        requirements: requirements.trim() || null,
        classification: classification ?? null,
      })
      .eq('id', contact.id);
    setSaving(false);
    if (updateError) {
      haptic.warn();
      setError(friendlyError(updateError.message));
      return;
    }
    haptic.success();
    queryClient.invalidateQueries({ queryKey: ['contact', contact.id] });
    queryClient.invalidateQueries({ queryKey: ['contacts'] });
    queryClient.invalidateQueries({ queryKey: ['conversations'] });
    onDone();
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {error ? <Banner kind="error" text={error} /> : null}

        <TextField label="Name" value={name} onChangeText={setName} placeholder="Full name" />
        <TextField
          label="Name Tag"
          value={nameTag}
          onChangeText={setNameTag}
          placeholder='Short qualifier, e.g. "Bank DSA"'
        />
        <TextField
          label="Email"
          value={email}
          onChangeText={setEmail}
          placeholder="email@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
        />
        <TextField label="Company" value={company} onChangeText={setCompany} placeholder="Company" />
        <TextField
          label="Requirements"
          value={requirements}
          onChangeText={setRequirements}
          placeholder="What are they looking for?"
          multiline
        />

        <View style={{ gap: spacing.sm }}>
          <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>Classification</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {CLASSIFICATIONS.map((c) => {
              const active = classification === c;
              const hue = classificationColors[c]?.[dark ? 'dark' : 'light'];
              return (
                <Pressable
                  key={c}
                  onPress={() => setClassification(active ? undefined : c)}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 7,
                    borderRadius: radius.full,
                    backgroundColor: active ? colors.primarySoft : colors.surface,
                    borderWidth: active ? 1.5 : StyleSheet.hairlineWidth,
                    borderColor: active ? colors.primary : colors.border,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 13,
                      fontFamily: f.semibold,
                      color: active ? colors.primary : (hue ?? colors.textMuted),
                    }}
                  >
                    {c}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={{ marginTop: spacing.sm }}>
          <PrimaryButton label="Save changes" busy={saving} onPress={save} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function ActionButton({
  icon,
  label,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
}) {
  const { colors, fonts: f } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[styles.actionButton, { backgroundColor: colors.glass, borderColor: colors.glassBorder }]}
    >
      <Ionicons name={icon} size={20} color={colors.primary} />
      <Text style={{ fontSize: 12.5, fontFamily: f.semibold, color: colors.text }}>{label}</Text>
    </Pressable>
  );
}

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: string;
}) {
  const { colors, fonts: f } = useTheme();
  return (
    <View style={[styles.infoRow, { borderTopColor: colors.border }]}>
      <Ionicons name={icon} size={17} color={colors.textMuted} style={{ marginTop: 2 }} />
      <View style={{ flex: 1, gap: 1 }}>
        <Text style={{ fontSize: 12, color: colors.textFaint }}>{label}</Text>
        <Text style={{ fontSize: 14.5, fontFamily: f.medium, color: colors.text }}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.lg },
  identity: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  name: { fontSize: 22, fontFamily: fonts.extrabold, textAlign: 'center' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, justifyContent: 'center' },
  actionButton: {
    alignItems: 'center',
    gap: 4,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 10,
    width: 92,
  },
  card: {
    borderWidth: 1,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  infoRow: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  fieldLabel: { fontSize: 12.5, fontFamily: fonts.bold, textTransform: 'uppercase', letterSpacing: 0.4 },
  reviewBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.md,
  },
  approveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: radius.full,
    paddingHorizontal: 14,
    minHeight: 38,
    minWidth: 104,
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
  agentStrip: {
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  agentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.full,
    borderWidth: 1,
    paddingLeft: 4,
    paddingRight: 12,
    paddingVertical: 4,
  },
});
