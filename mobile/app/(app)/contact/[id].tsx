import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  AgentNotes,
  AgentProperties,
  AgentRequirements,
  AgentSchedule,
  ContactTags,
  InterestedProperties,
} from '@/components/agent-detail';
import { ApproveCelebration, type ApproveCelebrationState } from '@/components/approve-celebration';
import { ConvoRealLoader } from '@/components/loader';
import { PulseRing } from '@/components/motion';
import { Avatar, Banner, PrimaryButton, Tag, TextField } from '@/components/ui';
import { approveAndSendDetails, type ApproveOutcome } from '@/lib/approve-contact';
import { formatBudgetRange, formatInr } from '@/lib/format';
import { friendlyError } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { queryClient } from '@/lib/query';
import { supabase } from '@/lib/supabase';
import { classificationColors, radius, spacing, useTheme , fonts } from '@/lib/theme';
import { openWelcomeWhatsApp } from '@/lib/welcome-message';
import { CLASSIFICATIONS, type Classification, type Contact } from '@/lib/types';

const PROPERTY_INTEREST_OPTIONS = [
  'Vacant plot',
  'Vacant building',
  'Rental building with some ROI',
  'Old building selling at site rate',
];

const BUYER_PREF_CLASSIFICATIONS: Classification[] = ['Buyer', 'Owner & Buyer', 'Agent'];

function parseAmount(s: string): number | null {
  const n = Number(s.replace(/[^\d.]/g, ''));
  return s.trim() && !Number.isNaN(n) && n > 0 ? n : null;
}

async function fetchContact(id: string): Promise<Contact | null> {
  const { data, error } = await supabase
    .from('contacts')
    .select(
      'id, phone, secondary_phones, name, name_tag, email, company, classification, ' +
        'avatar_url, min_budget, max_budget, no_budget, areas_of_interest, strict_area_match, ' +
        'min_roi, requirements, lead_temp, status, referrer, source, property_interests, ' +
        'last_inquired_property_id'
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
          <ConvoRealLoader />
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
  const [celebration, setCelebration] = useState<ApproveCelebrationState | null>(null);
  const name = contact.name || contact.phone;
  const clsColor = contact.classification
    ? classificationColors[contact.classification]?.[dark ? 'dark' : 'light']
    : undefined;

  const budget = formatBudgetRange(contact.min_budget, contact.max_budget, contact.no_budget);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      {contact.status === 'pending_review' ? (
        <ReviewBanner
          contact={contact}
          onApproved={(outcome) => setCelebration({ contact, outcome })}
        />
      ) : null}
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
          onPress={() => openWelcomeWhatsApp(contact)}
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
            value={
              contact.areas_of_interest.join(', ') +
              (contact.strict_area_match ? ' · strict match' : '')
            }
          />
        ) : null}
        {contact.property_interests?.length ? (
          <InfoRow
            icon="pricetags-outline"
            label="Property interests"
            value={contact.property_interests.join(', ')}
          />
        ) : null}
        {contact.min_roi ? (
          <InfoRow icon="trending-up-outline" label="Min ROI" value={`${contact.min_roi}%`} />
        ) : null}
        {contact.requirements ? (
          <InfoRow icon="list-outline" label="Requirements" value={contact.requirements} />
        ) : null}
      </View>

      {contact.classification &&
      ['Owner', 'Seller', 'Developer', 'Owner & Buyer', 'Agent'].includes(contact.classification) ? (
        <AgentProperties
          contactId={contact.id}
          title={contact.classification === 'Agent' ? 'Showcase properties' : 'Managed properties'}
        />
      ) : null}
      {contact.classification &&
      ['Buyer', 'Agent', 'Owner & Buyer'].includes(contact.classification) ? (
        <InterestedProperties contact={contact} />
      ) : null}
      {contact.classification === 'Agent' ? (
        <>
          <AgentRequirements key={`req-${contact.id}`} agent={contact} />
          <AgentSchedule contact={contact} />
        </>
      ) : null}
      <ContactTags contactId={contact.id} />
      <AgentNotes
        contactId={contact.id}
        title={contact.classification === 'Agent' ? 'Agent notes' : 'Notes'}
      />

      <Text style={{ fontSize: 12, color: colors.textFaint, textAlign: 'center' }}>
        Tap Edit above to update budget, areas and buyer preferences.
      </Text>
    </ScrollView>
    <ApproveCelebration celebration={celebration} onClose={() => setCelebration(null)} />
    </KeyboardAvoidingView>
  );
}

/**
 * Web parity: contacts arriving from portals/imports land as
 * pending_review; approving flips them active and auto-sends the
 * inquired property's details via WhatsApp (contact-detail-view's
 * approveContact + sendPropertyDetailsHelper).
 */
function ReviewBanner({
  contact,
  onApproved,
}: {
  contact: Contact;
  onApproved: (outcome: ApproveOutcome) => void;
}) {
  const { colors, fonts: f } = useTheme();
  const [busy, setBusy] = useState(false);

  async function approve() {
    setBusy(true);
    const result = await approveAndSendDetails(contact);
    setBusy(false);
    if (!result.ok) {
      haptic.warn();
      Alert.alert('Could not approve', friendlyError(result.error ?? 'Try again.'));
      return;
    }
    onApproved(result);
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
      <PulseRing size={26} color={colors.warning}>
        <View
          style={{
            width: 26,
            height: 26,
            borderRadius: 13,
            backgroundColor: colors.warning,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="hourglass-outline" size={14} color="#FFFFFF" />
        </View>
      </PulseRing>
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
  const [minBudget, setMinBudget] = useState(
    contact.min_budget != null ? String(contact.min_budget) : ''
  );
  const [maxBudget, setMaxBudget] = useState(
    contact.max_budget != null ? String(contact.max_budget) : ''
  );
  const [noBudget, setNoBudget] = useState(Boolean(contact.no_budget));
  const [areas, setAreas] = useState<string[]>(contact.areas_of_interest ?? []);
  const [areaInput, setAreaInput] = useState('');
  const [strictArea, setStrictArea] = useState(Boolean(contact.strict_area_match));
  const [propertyInterests, setPropertyInterests] = useState<string[]>(
    contact.property_interests ?? []
  );
  const [minRoi, setMinRoi] = useState(contact.min_roi != null ? String(contact.min_roi) : '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const showPrefs = Boolean(classification && BUYER_PREF_CLASSIFICATIONS.includes(classification));

  function addArea() {
    const v = areaInput.trim();
    if (!v) return;
    if (!areas.some((a) => a.toLowerCase() === v.toLowerCase())) setAreas((prev) => [...prev, v]);
    setAreaInput('');
  }

  function toggleInterest(option: string) {
    setPropertyInterests((prev) =>
      prev.includes(option) ? prev.filter((o) => o !== option) : [...prev, option]
    );
  }

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
        min_budget: noBudget ? null : parseAmount(minBudget),
        max_budget: noBudget ? null : parseAmount(maxBudget),
        no_budget: noBudget,
        areas_of_interest: areas,
        strict_area_match: strictArea,
        property_interests: propertyInterests,
        min_roi: parseAmount(minRoi),
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

        {showPrefs ? (
          <View style={{ gap: spacing.md, marginTop: spacing.sm }}>
            <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>Buyer preferences</Text>

            <CheckRow label="No budget limit" checked={noBudget} onToggle={() => setNoBudget((v) => !v)} />
            {!noBudget ? (
              <View style={{ flexDirection: 'row', gap: spacing.md }}>
                <View style={{ flex: 1, gap: spacing.xs }}>
                  <TextField
                    label="Min budget (₹)"
                    value={minBudget}
                    onChangeText={setMinBudget}
                    placeholder="e.g. 5000000"
                    keyboardType="number-pad"
                  />
                  {parseAmount(minBudget) ? (
                    <Text style={[styles.hint, { color: colors.textFaint }]}>
                      {formatInr(parseAmount(minBudget))}
                    </Text>
                  ) : null}
                </View>
                <View style={{ flex: 1, gap: spacing.xs }}>
                  <TextField
                    label="Max budget (₹)"
                    value={maxBudget}
                    onChangeText={setMaxBudget}
                    placeholder="e.g. 8000000"
                    keyboardType="number-pad"
                  />
                  {parseAmount(maxBudget) ? (
                    <Text style={[styles.hint, { color: colors.textFaint }]}>
                      {formatInr(parseAmount(maxBudget))}
                    </Text>
                  ) : null}
                </View>
              </View>
            ) : null}

            <View style={{ gap: spacing.sm }}>
              <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>Areas of interest</Text>
              {areas.length ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                  {areas.map((a) => (
                    <View
                      key={a}
                      style={[styles.areaChip, { backgroundColor: colors.primarySoft, borderColor: colors.primary }]}
                    >
                      <Text style={{ fontSize: 13, fontFamily: f.semibold, color: colors.primary }}>
                        {a}
                      </Text>
                      <Pressable
                        onPress={() => setAreas((prev) => prev.filter((x) => x !== a))}
                        hitSlop={6}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${a}`}
                      >
                        <Ionicons name="close" size={14} color={colors.primary} />
                      </Pressable>
                    </View>
                  ))}
                </View>
              ) : null}
              <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
                <View style={{ flex: 1 }}>
                  <TextField
                    value={areaInput}
                    onChangeText={setAreaInput}
                    placeholder="Add a locality…"
                    onSubmitEditing={addArea}
                    returnKeyType="done"
                  />
                </View>
                <Pressable
                  onPress={addArea}
                  accessibilityRole="button"
                  accessibilityLabel="Add area"
                  style={[styles.addAreaBtn, { backgroundColor: colors.primarySoft }]}
                >
                  <Ionicons name="add" size={20} color={colors.primary} />
                </Pressable>
              </View>
            </View>

            <CheckRow
              label="Strict area match (within 5 km)"
              checked={strictArea}
              onToggle={() => setStrictArea((v) => !v)}
            />

            <View style={{ gap: spacing.sm }}>
              <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>Property interests</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                {PROPERTY_INTEREST_OPTIONS.map((option) => {
                  const active = propertyInterests.includes(option);
                  return (
                    <Pressable
                      key={option}
                      onPress={() => toggleInterest(option)}
                      accessibilityRole="button"
                      accessibilityLabel={option}
                      accessibilityState={{ selected: active }}
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
                          color: active ? colors.primary : colors.textMuted,
                        }}
                      >
                        {option}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <TextField
              label="Expected min ROI (%)"
              value={minRoi}
              onChangeText={setMinRoi}
              placeholder="e.g. 4"
              keyboardType="decimal-pad"
            />
          </View>
        ) : null}

        <View style={{ marginTop: spacing.sm }}>
          <PrimaryButton label="Save changes" busy={saving} onPress={save} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function CheckRow({
  label,
  checked,
  onToggle,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
}) {
  const { colors, fonts: f } = useTheme();
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}
    >
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: radius.sm,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: checked ? colors.primary : colors.surface,
          borderWidth: checked ? 0 : StyleSheet.hairlineWidth,
          borderColor: colors.border,
        }}
      >
        {checked ? <Ionicons name="checkmark" size={15} color={colors.onPrimary} /> : null}
      </View>
      <Text style={{ fontSize: 14.5, fontFamily: f.medium, color: colors.text }}>{label}</Text>
    </Pressable>
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
  hint: { fontSize: 12, fontFamily: fonts.medium, paddingHorizontal: 2 },
  areaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.full,
    borderWidth: 1,
    paddingLeft: 12,
    paddingRight: 8,
    paddingVertical: 6,
  },
  addAreaBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
