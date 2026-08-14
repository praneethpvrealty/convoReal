import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { BottomSheet, sheetScrollArea } from '@/components/sheet';
import { SectionLabel } from '@/components/ui';
import { ApiError, apiFetch } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { friendlyError } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import {
  OWNER_DETAILS_SECTION_TITLES,
  availableOwnerDetailsSections,
  buildOwnerDetailsRequestMessage,
  defaultOwnerDetailsSections,
  ownerHandoverLink,
  ownerPropertyLabel,
  type OwnerDetailsSection,
} from '@/lib/owner-details-request';
import { supabase } from '@/lib/supabase';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { Contact } from '@/lib/types';

interface EngineNumber {
  phone: string;
  prefix: string;
  sandbox: boolean;
}

interface DetailsRequestSettings {
  sections: OwnerDetailsSection[];
  body_template: string | null;
  /** The account's public /list page, or null when no public number is
   *  set up to verify a submission. */
  listing_link: string | null;
}

interface OwnedProperty {
  id: string;
  title: string | null;
  type: string | null;
  sublocality: string | null;
  city: string | null;
}

/**
 * Mobile port of the web's Ask for property details dialog.
 *
 * The first message an agent sends a seller. It goes from the agent's
 * OWN WhatsApp — first contact with an owner happens on the phone they
 * already answer, and there is no open 24-hour window on the business
 * number until the owner writes to it. So the message carries a one-tap
 * link that moves them there, and the primary action here opens the
 * agent's own WhatsApp with it.
 *
 * Sending through the office number stays available for an owner
 * already inside the window; outside it the route answers 409 and this
 * falls back to the same hand-off rather than dead-ending.
 */
export function OwnerDetailsRequestSheet({
  visible,
  onClose,
  contact,
}: {
  visible: boolean;
  onClose: () => void;
  contact: Contact;
}) {
  const { colors, fonts: f } = useTheme();
  const profile = useAuthStore((s) => s.profile);
  const userId = useAuthStore((s) => s.session?.user.id);

  const propertiesQuery = useQuery({
    queryKey: ['owned-properties', contact.id],
    enabled: visible,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from('properties')
        .select('id, title, type, sublocality, city')
        .eq('owner_contact_id', contact.id)
        .order('created_at', { ascending: false });
      return (data ?? []) as OwnedProperty[];
    },
  });

  // Name, phone and brokerage as they appear in the sign-off. The
  // account name is not on the cached profile row, so it is read here
  // rather than left off the mobile copy of the message.
  const identityQuery = useQuery({
    queryKey: ['agent-identity', userId],
    enabled: visible && Boolean(userId),
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from('profiles')
        .select('full_name, phone, account:accounts!inner(name)')
        .eq('user_id', userId)
        .maybeSingle();
      return (data ?? null) as {
        full_name: string | null;
        phone: string | null;
        account: { name: string | null } | null;
      } | null;
    },
  });

  // The connected number, cached across contacts. A failure is not
  // fatal: the message drops the hand-off link and asks the owner to
  // reply where they are.
  const engineQuery = useQuery({
    queryKey: ['engine-number'],
    enabled: visible,
    retry: false,
    staleTime: 10 * 60_000,
    queryFn: () =>
      apiFetch<{ data: EngineNumber }>('/api/whatsapp/engine-number').then(
        (r) => r.data
      ),
  });

  const settingsQuery = useQuery({
    queryKey: ['owner-details-request-settings'],
    enabled: visible,
    retry: false,
    staleTime: 5 * 60_000,
    queryFn: () =>
      apiFetch<{ data: DetailsRequestSettings }>(
        '/api/owners/details-request/settings'
      ).then((r) => r.data),
  });

  const properties = propertiesQuery.data ?? [];
  const [chosenId, setChosenId] = useState<string | null | undefined>();
  const [selection, setSelection] = useState<OwnerDetailsSection[] | null>(
    null
  );
  const [draft, setDraft] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const propertyId =
    chosenId === undefined ? (properties[0]?.id ?? null) : chosenId;
  const property = properties.find((p) => p.id === propertyId) ?? null;

  const offered = useMemo(
    () => availableOwnerDetailsSections(property?.type),
    [property?.type]
  );
  // The account's saved selection stands in for the built-in default;
  // the agent's toggles override both, for this send only.
  const sections = useMemo(() => {
    const saved = settingsQuery.data?.sections ?? [];
    const base =
      selection ??
      (saved.length > 0 ? saved : defaultOwnerDetailsSections(property?.type));
    return offered.filter((s) => base.includes(s));
  }, [selection, settingsQuery.data, property?.type, offered]);

  const engineLink = engineQuery.data
    ? ownerHandoverLink(engineQuery.data)
    : null;

  const composed = useMemo(
    () =>
      buildOwnerDetailsRequestMessage({
        ownerName: contact.name,
        propertyLabel: ownerPropertyLabel(property),
        propertyType: property?.type,
        sections,
        agentName: identityQuery.data?.full_name ?? profile?.full_name,
        agentPhone: identityQuery.data?.phone,
        brandName: identityQuery.data?.account?.name,
        engineLink,
        listingLink: settingsQuery.data?.listing_link,
        bodyTemplate: settingsQuery.data?.body_template,
        now: new Date(),
      }),
    [
      contact.name,
      property,
      sections,
      identityQuery.data,
      profile,
      engineLink,
      settingsQuery.data,
    ]
  );
  const message = draft ?? composed;

  function close() {
    setDraft(null);
    setSelection(null);
    setChosenId(undefined);
    setCopied(false);
    setError(null);
    setSending(false);
    onClose();
  }

  function pickProperty(id: string | null) {
    haptic.tap();
    setDraft(null);
    setSelection(null);
    setChosenId(id);
  }

  function toggleSection(section: OwnerDetailsSection) {
    haptic.tap();
    setDraft(null);
    setSelection(
      sections.includes(section)
        ? sections.filter((s) => s !== section)
        : offered.filter((s) => sections.includes(s) || s === section)
    );
  }

  function openWhatsApp() {
    const digits = (contact.phone ?? '').replace(/\D/g, '');
    if (!digits) return;
    haptic.send();
    void Linking.openURL(
      `https://wa.me/${digits}?text=${encodeURIComponent(message)}`
    );
    close();
  }

  async function copyMessage() {
    haptic.tap();
    await Clipboard.setStringAsync(message);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function sendFromEngine() {
    if (sending) return;
    setSending(true);
    setError(null);
    try {
      await apiFetch('/api/owners/details-request', {
        method: 'POST',
        body: JSON.stringify({
          contact_id: contact.id,
          ...(propertyId ? { property_id: propertyId } : {}),
          message,
        }),
      });
      haptic.success();
      close();
    } catch (err) {
      // 409 is the closed 24-hour window, not a failure: the same text
      // still goes out, from the agent's own WhatsApp.
      if (err instanceof ApiError && err.status === 409) {
        openWhatsApp();
        return;
      }
      haptic.warn();
      setError(
        friendlyError(err instanceof Error ? err.message : 'Could not send')
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <BottomSheet
      visible={visible}
      onClose={close}
      title="Ask for property details"
    >
      <ScrollView
        style={sheetScrollArea}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: spacing.md }}
      >
        <Text
          style={{ fontSize: 12.5, color: colors.textMuted, lineHeight: 18 }}
        >
          Send this from your own WhatsApp, where you already message{' '}
          {contact.name || 'them'}. It asks for the basics — no documents — and
          moves them onto the office number, which is what starts their updates
          on buyers, visits and offers.
        </Text>

        {properties.length > 0 ? (
          <>
            <SectionLabel text="Which property" />
            <View style={styles.chips}>
              {properties.map((p) => (
                <Chip
                  key={p.id}
                  label={p.title || 'Untitled listing'}
                  active={propertyId === p.id}
                  onPress={() => pickProperty(p.id)}
                />
              ))}
              <Chip
                label="Not listed yet"
                active={propertyId === null}
                onPress={() => pickProperty(null)}
              />
            </View>
          </>
        ) : null}

        <SectionLabel text="What to ask for" />
        <View style={styles.chips}>
          {offered.map((section) => (
            <Chip
              key={section}
              label={OWNER_DETAILS_SECTION_TITLES[section]}
              active={sections.includes(section)}
              onPress={() => toggleSection(section)}
            />
          ))}
        </View>
        <Text style={{ fontSize: 11, color: colors.textMuted }}>
          Papers and ownership are off for a first ask — turn them on once a
          buyer is finalised and the token is paid.
        </Text>

        <SectionLabel text="Message — tap to edit" />
        <TextInput
          multiline
          scrollEnabled={false}
          value={message}
          onChangeText={setDraft}
          accessibilityLabel="Property details request"
          style={[
            styles.draft,
            {
              backgroundColor: colors.surfaceRaised,
              borderColor: colors.border,
              color: colors.text,
            },
          ]}
        />
        <Text style={{ fontSize: 11, color: colors.textMuted }}>
          {engineLink
            ? 'Keep the office WhatsApp link — their tap on it is what opens the thread and switches their updates on.'
            : 'No number is connected yet, so the message asks them to reply where they are.'}
        </Text>

        {error ? (
          <View
            style={[
              styles.notice,
              {
                backgroundColor: colors.surfaceSunken,
                borderColor: colors.border,
              },
            ]}
          >
            <Ionicons name="warning-outline" size={16} color={colors.warning} />
            <Text
              style={{
                flex: 1,
                fontSize: 12.5,
                color: colors.text,
                lineHeight: 18,
              }}
            >
              {error}
            </Text>
          </View>
        ) : null}

        <Pressable
          onPress={openWhatsApp}
          accessibilityRole="button"
          accessibilityLabel={`Send the request to ${contact.name || 'this contact'} from my own WhatsApp`}
          style={[
            styles.primary,
            {
              backgroundColor: colors.primarySoft,
              borderColor: colors.primary,
            },
          ]}
        >
          <Ionicons name="logo-whatsapp" size={20} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text
              style={{
                fontSize: 14,
                fontFamily: f.bold,
                color: colors.primary,
              }}
            >
              Send from my WhatsApp
            </Text>
            <Text style={{ fontSize: 11.5, color: colors.textMuted }}>
              Opens your own chat with them, message ready to send
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.primary} />
        </Pressable>

        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Pressable
            onPress={copyMessage}
            accessibilityRole="button"
            accessibilityLabel="Copy the request"
            style={[
              styles.secondary,
              {
                backgroundColor: colors.glass,
                borderColor: colors.glassBorder,
              },
            ]}
          >
            <Ionicons
              name={copied ? 'checkmark' : 'copy-outline'}
              size={16}
              color={copied ? colors.success : colors.primary}
            />
            <Text
              style={{
                fontSize: 12.5,
                fontFamily: f.semibold,
                color: colors.text,
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </Text>
          </Pressable>
          <Pressable
            onPress={sendFromEngine}
            disabled={sending || !message.trim()}
            accessibilityRole="button"
            accessibilityLabel="Send the request from the office number instead"
            accessibilityState={{ disabled: sending, busy: sending }}
            style={[
              styles.secondary,
              {
                backgroundColor: colors.glass,
                borderColor: colors.glassBorder,
              },
            ]}
          >
            {sending ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <Ionicons name="send" size={16} color={colors.primary} />
            )}
            <Text
              style={{
                fontSize: 12.5,
                fontFamily: f.semibold,
                color: colors.text,
              }}
            >
              From office
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </BottomSheet>
  );
}

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const { colors, fonts: f } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[
        styles.chip,
        {
          backgroundColor: active ? colors.primarySoft : colors.glass,
          borderColor: active ? colors.primary : colors.glassBorder,
        },
      ]}
    >
      <Text
        style={{
          fontSize: 12,
          fontFamily: f.semibold,
          color: active ? colors.primary : colors.textMuted,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  notice: {
    flexDirection: 'row',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  draft: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 13,
    lineHeight: 19,
    minHeight: 220,
    textAlignVertical: 'top',
  },
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  secondary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
  },
});
