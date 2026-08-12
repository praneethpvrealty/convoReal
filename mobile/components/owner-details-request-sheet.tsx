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
  OWNER_DETAILS_SECTIONS,
  OWNER_DETAILS_SECTION_TITLES,
  buildOwnerDetailsRequestMessage,
  defaultOwnerDetailsSections,
  ownerPropertyLabel,
  type OwnerDetailsSection,
} from '@/lib/owner-details-request';
import { supabase } from '@/lib/supabase';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { Contact } from '@/lib/types';

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
 * The seller intake request: everything a listing needs, and the
 * promise of what this number sends back once it is live. It is an
 * Engine template rather than a Meta one, so it goes through the
 * business number while the contact's 24-hour window is open and falls
 * back to the agent's own WhatsApp when it is not — the same two routes
 * the web dialog offers, against the same API route.
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

  const properties = propertiesQuery.data ?? [];
  const [chosenId, setChosenId] = useState<string | null | undefined>();
  const [omitted, setOmitted] = useState<OwnerDetailsSection[]>([]);
  const [draft, setDraft] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const propertyId =
    chosenId === undefined ? (properties[0]?.id ?? null) : chosenId;
  const property = properties.find((p) => p.id === propertyId) ?? null;

  const available = useMemo(
    () => defaultOwnerDetailsSections(property?.type),
    [property?.type]
  );
  const sections = available.filter((s) => !omitted.includes(s));

  const composed = useMemo(
    () =>
      buildOwnerDetailsRequestMessage({
        ownerName: contact.name,
        propertyLabel: ownerPropertyLabel(property),
        propertyType: property?.type,
        sections: available.filter((s) => !omitted.includes(s)),
        agentName: identityQuery.data?.full_name ?? profile?.full_name,
        agentPhone: identityQuery.data?.phone,
        brandName: identityQuery.data?.account?.name,
        now: new Date(),
      }),
    [contact.name, property, available, omitted, identityQuery.data, profile]
  );
  const message = draft ?? composed;

  function close() {
    setDraft(null);
    setOmitted([]);
    setChosenId(undefined);
    setCopied(false);
    setError(null);
    setSending(false);
    onClose();
  }

  function pickProperty(id: string | null) {
    haptic.tap();
    setDraft(null);
    setOmitted([]);
    setChosenId(id);
  }

  function toggleSection(section: OwnerDetailsSection) {
    haptic.tap();
    setDraft(null);
    setOmitted((prev) =>
      prev.includes(section)
        ? prev.filter((s) => s !== section)
        : [...prev, section]
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
          One message that asks {contact.name || 'the owner'} for everything a
          listing needs, and tells them what this number will send back —
          enquiries, shortlisted buyers, site visits and offers.
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
          {OWNER_DETAILS_SECTIONS.filter((s) => available.includes(s)).map(
            (section) => (
              <Chip
                key={section}
                label={OWNER_DETAILS_SECTION_TITLES[section]}
                active={sections.includes(section)}
                onPress={() => toggleSection(section)}
              />
            )
          )}
        </View>
        <Text style={{ fontSize: 11, color: colors.textMuted }}>
          {property?.type
            ? `Tuned for a ${property.type.toLowerCase()} — tap to drop anything you already have.`
            : 'Tap to drop anything you already have.'}
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
          Keep the STOP UPDATES line — it is how they turn the updates off
          without calling you.
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
          onPress={sendFromEngine}
          disabled={sending || !message.trim()}
          accessibilityRole="button"
          accessibilityLabel="Send the details request from the Engine number"
          accessibilityState={{ disabled: sending, busy: sending }}
          style={[
            styles.primary,
            {
              backgroundColor: colors.primarySoft,
              borderColor: colors.primary,
            },
          ]}
        >
          {sending ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <Ionicons name="send" size={18} color={colors.primary} />
          )}
          <View style={{ flex: 1 }}>
            <Text
              style={{
                fontSize: 14,
                fontFamily: f.bold,
                color: colors.primary,
              }}
            >
              Send from the Engine number
            </Text>
            <Text style={{ fontSize: 11.5, color: colors.textMuted }}>
              Lands in the inbox thread, so their reply comes back to the team
            </Text>
          </View>
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
            onPress={openWhatsApp}
            accessibilityRole="button"
            accessibilityLabel="Send the request from my own WhatsApp"
            style={[
              styles.secondary,
              {
                backgroundColor: colors.glass,
                borderColor: colors.glassBorder,
              },
            ]}
          >
            <Ionicons name="logo-whatsapp" size={16} color={colors.primary} />
            <Text
              style={{
                fontSize: 12.5,
                fontFamily: f.semibold,
                color: colors.text,
              }}
            >
              My WhatsApp
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
