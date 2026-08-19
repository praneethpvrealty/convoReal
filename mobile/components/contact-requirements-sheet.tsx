import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { BottomSheet, sheetScrollArea } from '@/components/sheet';
import { SuccessSheet } from '@/components/success-sheet';
import { Banner, PrimaryButton, TextField } from '@/components/ui';
import { apiFetch } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { openContactChat } from '@/lib/open-chat';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { Contact, ContactRequirementProfile } from '@/lib/types';

interface RequirementResult {
  data: {
    profile: ContactRequirementProfile | null;
    duplicate?: boolean;
    match_count: number;
    alerts_active: boolean;
  };
}

type ViewMode = 'overview' | 'add' | 'ask';

function inr(value: number): string {
  if (value >= 10_000_000) {
    return `₹${(value / 10_000_000).toFixed(2).replace(/\.00$/, '')} Cr`;
  }
  if (value >= 100_000) {
    return `₹${(value / 100_000).toFixed(2).replace(/\.00$/, '')} L`;
  }
  return `₹${value.toLocaleString('en-IN')}`;
}

function primarySummary(contact: Contact): string {
  const types = contact.pref_property_types?.length
    ? contact.pref_property_types
    : contact.property_interests || [];
  const areas = [
    ...new Set([
      ...(contact.areas_of_interest || []),
      ...(contact.pref_areas || []),
    ]),
  ];
  const min = contact.pref_budget_min ?? contact.min_budget ?? null;
  const max = contact.pref_budget_max ?? contact.max_budget ?? null;
  const budget = contact.no_budget
    ? 'No fixed budget'
    : min && max
      ? `${inr(min)}–${inr(max)}`
      : max
        ? `Up to ${inr(max)}`
        : min
          ? `Above ${inr(min)}`
          : null;
  return [types.slice(0, 2).join(' / '), areas.slice(0, 3).join(', '), budget]
    .filter(Boolean)
    .join(' · ');
}

function ActionCard({
  icon,
  label,
  detail,
  disabled = false,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  detail: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const { colors, fonts: f } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        flex: 1,
        minWidth: 145,
        gap: spacing.xs,
        padding: spacing.md,
        borderRadius: radius.lg,
        backgroundColor: colors.primarySoft,
        borderWidth: 1,
        borderColor: colors.glassBorder,
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <Ionicons name={icon} size={21} color={colors.primary} />
      <Text style={{ color: colors.text, fontFamily: f.bold, fontSize: 13.5 }}>
        {label}
      </Text>
      <Text style={{ color: colors.textMuted, fontSize: 11.5, lineHeight: 16 }}>
        {detail}
      </Text>
    </Pressable>
  );
}

export function ContactRequirementsSheet({
  visible,
  onClose,
  contact,
  onChanged,
}: {
  visible: boolean;
  onClose: () => void;
  contact: Contact;
  onChanged: () => void;
}) {
  const { colors, fonts: f } = useTheme();
  const [view, setView] = useState<ViewMode>('overview');
  const profiles = contact.requirement_profiles || [];
  const [primaryText, setPrimaryText] = useState(
    () => contact.requirements?.trim() || primarySummary(contact)
  );
  const [profileDrafts, setProfileDrafts] = useState<Record<string, string>>(
    () =>
      Object.fromEntries(
        profiles.map((profile) => [profile.id, profile.raw_text])
      )
  );
  const [addText, setAddText] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [delivery, setDelivery] = useState<'flow' | 'template' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const name = contact.name?.trim() || 'this buyer';

  function closeSheet() {
    if (saving || sending) return;
    onClose();
  }

  async function saveRequirement(
    target: 'primary' | 'profile',
    text: string,
    profileId?: string
  ) {
    const key = target === 'primary' ? 'primary' : profileId || 'profile';
    if (!text.trim() || saving) return;
    setSaving(key);
    setError(null);
    try {
      await apiFetch<RequirementResult>(
        `/api/contacts/${contact.id}/requirements`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            target,
            profile_id: profileId,
            text,
          }),
        }
      );
      haptic.success();
      onChanged();
      onClose();
    } catch (reason) {
      haptic.warn();
      setError(
        friendlyError(
          reason instanceof Error
            ? reason.message
            : 'Could not save the requirement'
        )
      );
    } finally {
      setSaving(null);
    }
  }

  async function addRequirement() {
    if (!addText.trim() || saving) return;
    setSaving('add');
    setError(null);
    try {
      await apiFetch<RequirementResult>(
        `/api/contacts/${contact.id}/requirements`,
        {
          method: 'POST',
          body: JSON.stringify({
            text: addText,
            source: 'personal_whatsapp',
          }),
        }
      );
      haptic.success();
      onChanged();
      onClose();
    } catch (reason) {
      haptic.warn();
      setError(
        friendlyError(
          reason instanceof Error
            ? reason.message
            : 'Could not save the requirement'
        )
      );
    } finally {
      setSaving(null);
    }
  }

  async function askBuyer() {
    if (sending || !contact.phone) return;
    setSending(true);
    setError(null);
    try {
      const result = await apiFetch<{
        success: boolean;
        delivery: 'flow' | 'template';
      }>('/api/whatsapp/flows/send', {
        method: 'POST',
        body: JSON.stringify({ contact_id: contact.id }),
      });
      haptic.success();
      setDelivery(result.delivery);
    } catch (reason) {
      haptic.warn();
      setError(
        friendlyError(
          reason instanceof Error ? reason.message : 'Could not send the form'
        )
      );
    } finally {
      setSending(false);
    }
  }

  const title =
    view === 'overview'
      ? 'Requirements'
      : view === 'add'
        ? 'Add another requirement'
        : 'Ask for requirements and budget';

  function finishDelivery() {
    setDelivery(null);
    onClose();
  }

  if (delivery) {
    return (
      <SuccessSheet
        visible={visible}
        onClose={finishDelivery}
        title={
          delivery === 'flow'
            ? 'Requirement form sent'
            : 'Requirement request sent'
        }
        message={
          delivery === 'flow'
            ? `The pre-filled form was sent to ${name} and recorded in Inbox. Their submitted response will update the requirement and Match Radar.`
            : `A WhatsApp template was sent to ${name} because the 24-hour window was closed. Their tap opens the pre-filled form, and the submitted response updates Match Radar.`
        }
        confetti={false}
        actions={[
          {
            icon: 'chatbubble-ellipses-outline',
            label: 'Open in Inbox',
            onPress: () => {
              finishDelivery();
              void openContactChat(contact);
            },
          },
          {
            icon: 'checkmark-outline',
            label: 'Done',
            onPress: finishDelivery,
          },
        ]}
      />
    );
  }

  return (
    <BottomSheet visible={visible} onClose={closeSheet} title={title}>
      <ScrollView
        style={sheetScrollArea}
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          paddingBottom: spacing.md,
          gap: spacing.lg,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {view !== 'overview' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to requirements"
            onPress={() => {
              setError(null);
              setView('overview');
            }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
          >
            <Ionicons name="arrow-back" size={17} color={colors.primary} />
            <Text style={{ color: colors.primary, fontFamily: f.semibold }}>
              All requirements
            </Text>
          </Pressable>
        ) : null}

        {error ? <Banner kind="error" text={error} /> : null}

        {view === 'overview' ? (
          <>
            <Text
              style={{ color: colors.textMuted, fontSize: 13, lineHeight: 19 }}
            >
              Review every active brief for {name}, add one received personally,
              or ask the buyer to confirm requirements and budget.
            </Text>

            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                gap: spacing.sm,
              }}
            >
              <ActionCard
                icon="add-circle-outline"
                label="Add requirement"
                detail="Paste a personal WhatsApp message"
                onPress={() => setView('add')}
              />
              <ActionCard
                icon="send-outline"
                label="Ask buyer"
                detail="Send the pre-filled form from Engine"
                disabled={!contact.phone}
                onPress={() => setView('ask')}
              />
            </View>

            <View
              style={{
                gap: spacing.md,
                padding: spacing.lg,
                borderRadius: radius.lg,
                backgroundColor: colors.glass,
                borderWidth: 1,
                borderColor: colors.glassBorder,
              }}
            >
              <View style={{ gap: 3 }}>
                <Text style={{ color: colors.text, fontFamily: f.bold }}>
                  Primary requirement
                </Text>
                <Text
                  style={{
                    color: colors.textFaint,
                    fontSize: 11.5,
                    lineHeight: 16,
                  }}
                >
                  Editing re-reads the text into structured Match Radar fields.
                </Text>
              </View>
              <TextField
                label="REQUIREMENT"
                value={primaryText}
                onChangeText={setPrimaryText}
                placeholder="Property type, location, size, budget and must-haves"
                multiline
                maxLength={4000}
                style={{ minHeight: 105 }}
              />
              {primarySummary(contact) ? (
                <Text
                  style={{
                    color: colors.textFaint,
                    fontSize: 11.5,
                    lineHeight: 16,
                  }}
                >
                  Structured now: {primarySummary(contact)}
                </Text>
              ) : null}
              <PrimaryButton
                label="Save primary requirement"
                icon="save-outline"
                busy={saving === 'primary'}
                disabled={!primaryText.trim() || saving !== null}
                onPress={() => saveRequirement('primary', primaryText)}
              />
            </View>

            <View style={{ gap: spacing.sm }}>
              <Text style={{ color: colors.text, fontFamily: f.bold }}>
                Additional requirements
              </Text>
              <Text
                style={{
                  color: colors.textFaint,
                  fontSize: 11.5,
                  lineHeight: 16,
                }}
              >
                Each brief is matched independently, so unrelated locations,
                sizes and budgets never mix.
              </Text>
            </View>

            {profiles.length ? (
              profiles.map((profile) => (
                <View
                  key={profile.id}
                  style={{
                    gap: spacing.md,
                    padding: spacing.lg,
                    borderRadius: radius.lg,
                    backgroundColor: colors.glass,
                    borderWidth: 1,
                    borderColor: colors.glassBorder,
                  }}
                >
                  <View style={{ gap: 3 }}>
                    <Text
                      style={{ color: colors.text, fontFamily: f.semibold }}
                    >
                      {profile.title}
                    </Text>
                    <Text style={{ color: colors.primary, fontSize: 11.5 }}>
                      Separate brief
                    </Text>
                  </View>
                  <TextField
                    label="REQUIREMENT"
                    value={profileDrafts[profile.id] ?? profile.raw_text}
                    onChangeText={(value) =>
                      setProfileDrafts((current) => ({
                        ...current,
                        [profile.id]: value,
                      }))
                    }
                    multiline
                    maxLength={4000}
                    style={{ minHeight: 90 }}
                  />
                  <PrimaryButton
                    label="Save changes"
                    icon="save-outline"
                    busy={saving === profile.id}
                    disabled={
                      !(profileDrafts[profile.id] ?? profile.raw_text).trim() ||
                      saving !== null
                    }
                    onPress={() =>
                      saveRequirement(
                        'profile',
                        profileDrafts[profile.id] ?? profile.raw_text,
                        profile.id
                      )
                    }
                  />
                </View>
              ))
            ) : (
              <Text style={{ color: colors.textFaint, textAlign: 'center' }}>
                No additional requirements yet.
              </Text>
            )}

            <View
              style={{
                flexDirection: 'row',
                gap: spacing.md,
                padding: spacing.lg,
                borderRadius: radius.lg,
                backgroundColor: colors.primarySoft,
              }}
            >
              <Ionicons name="radio-outline" size={21} color={colors.primary} />
              <Text
                style={{
                  flex: 1,
                  color: colors.textMuted,
                  fontSize: 12.5,
                  lineHeight: 18,
                }}
              >
                {contact.buyer_alerts_consent === 'granted'
                  ? 'Match Radar is watching. New matches can be sent from the connected business WhatsApp.'
                  : 'Match Radar is watching. WhatsApp delivery starts after buyer alert consent is granted.'}
              </Text>
            </View>
          </>
        ) : view === 'add' ? (
          <>
            <Text
              style={{ color: colors.textMuted, fontSize: 13, lineHeight: 19 }}
            >
              Paste what {name} sent on your personal WhatsApp. It is saved
              separately and will not overwrite the primary search.
            </Text>
            <TextField
              label="REQUIREMENT MESSAGE"
              value={addText}
              onChangeText={setAddText}
              placeholder="For Dabaspete, 2–3 acres, for cold storage / warehouse on or close to STRR"
              multiline
              maxLength={4000}
              autoFocus
              style={{ minHeight: 120 }}
            />
            <PrimaryButton
              label="Save to Engine"
              icon="add-circle-outline"
              busy={saving === 'add'}
              disabled={!addText.trim() || saving !== null}
              onPress={addRequirement}
            />
          </>
        ) : (
          <>
            <Text
              style={{ color: colors.textMuted, fontSize: 13, lineHeight: 19 }}
            >
              Send {name} a WhatsApp form pre-filled with the preferences
              already on record.
            </Text>
            <View
              style={{
                gap: spacing.md,
                padding: spacing.lg,
                borderRadius: radius.lg,
                backgroundColor: colors.primarySoft,
              }}
            >
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <Ionicons
                  name="logo-whatsapp"
                  size={19}
                  color={colors.success}
                />
                <Text
                  style={{
                    flex: 1,
                    color: colors.textMuted,
                    fontSize: 12.5,
                    lineHeight: 18,
                  }}
                >
                  Sent from your connected business number and recorded in
                  Inbox—not from personal WhatsApp.
                </Text>
              </View>
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <Ionicons
                  name="radio-outline"
                  size={19}
                  color={colors.primary}
                />
                <Text
                  style={{
                    flex: 1,
                    color: colors.textMuted,
                    fontSize: 12.5,
                    lineHeight: 18,
                  }}
                >
                  Only their submitted response updates the primary brief,
                  re-runs matching and keeps it active in Match Radar.
                </Text>
              </View>
            </View>
            {!contact.phone ? (
              <Banner
                kind="info"
                text="Add a phone number before sending the form."
              />
            ) : null}
            <PrimaryButton
              label="Send from Engine"
              icon="send"
              busy={sending}
              disabled={!contact.phone}
              onPress={askBuyer}
            />
          </>
        )}
      </ScrollView>
    </BottomSheet>
  );
}
