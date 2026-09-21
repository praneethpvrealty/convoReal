import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { BottomSheet } from '@/components/sheet';
import { SuccessSheet } from '@/components/success-sheet';
import { Banner, PrimaryButton } from '@/components/ui';
import { apiFetch } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { openContactChat } from '@/lib/open-chat';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { Contact } from '@/lib/types';

interface PreviewResponse {
  data: { message: string; url: string; phone: string | null };
}

export function PortalInviteSheet({
  visible,
  onClose,
  contact,
  onSent,
}: {
  visible: boolean;
  onClose: () => void;
  contact: Pick<Contact, 'id' | 'name' | 'phone' | 'classification'>;
  onSent: () => void;
}) {
  const { colors, fonts: f } = useTheme();
  const [sending, setSending] = useState(false);
  const [delivery, setDelivery] = useState<'free_text' | 'template' | null>(
    null
  );
  const [sendError, setSendError] = useState<string | null>(null);
  const name = contact.name?.trim() || contact.phone || 'this contact';
  const isAgent = contact.classification === 'Agent';
  const path = `/api/contacts/${contact.id}/portal-invite`;

  const preview = useQuery({
    queryKey: ['portal-invite', contact.id],
    enabled: visible,
    queryFn: () => apiFetch<PreviewResponse>(path),
  });

  function closeSheet() {
    setSending(false);
    setDelivery(null);
    setSendError(null);
    onClose();
  }

  async function sendFromBusiness() {
    if (sending) return;
    setSending(true);
    setSendError(null);
    try {
      const response = await apiFetch<{
        data: { delivery: 'free_text' | 'template' };
      }>(path, {
        method: 'POST',
        body: JSON.stringify({ channel: 'business' }),
      });
      setDelivery(response.data.delivery);
      onSent();
    } catch (reason) {
      haptic.warn();
      setSendError(
        friendlyError(
          reason instanceof Error
            ? reason.message
            : 'Could not send the portal link'
        )
      );
    } finally {
      setSending(false);
    }
  }

  async function openPersonalWhatsApp() {
    const digits = contact.phone?.replace(/\D/g, '') ?? '';
    const message = preview.data?.data.message;
    if (!digits || !message) return;
    haptic.send();
    try {
      await Linking.openURL(
        `https://wa.me/${digits}?text=${encodeURIComponent(message)}`
      );
    } catch {
      haptic.warn();
      setSendError('Could not open WhatsApp on this device.');
      return;
    }
    closeSheet();
    try {
      await apiFetch(path, {
        method: 'POST',
        body: JSON.stringify({ channel: 'personal' }),
      });
      onSent();
    } catch {
      // The chat is already open; a missing timeline note is not worth a warning.
    }
  }

  if (delivery) {
    return (
      <SuccessSheet
        visible={visible}
        onClose={closeSheet}
        title="Portal link sent"
        message={
          delivery === 'template'
            ? `The approved property selection template went to ${name} with a button to the portal. Their reply lands in your Inbox.`
            : `The portal link was sent to ${name} from your business WhatsApp. Their reply lands in your Inbox.`
        }
        confetti={false}
        actions={[
          {
            icon: 'chatbubble-ellipses-outline',
            label: 'Open in Inbox',
            onPress: () => {
              closeSheet();
              void openContactChat(contact);
            },
          },
          { icon: 'checkmark-outline', label: 'Done', onPress: closeSheet },
        ]}
      />
    );
  }

  const error = preview.error
    ? friendlyError(
        preview.error instanceof Error
          ? preview.error.message
          : 'Could not prepare the portal link'
      )
    : sendError;
  const ready = !preview.isLoading && Boolean(preview.data?.data.message);

  return (
    <BottomSheet
      visible={visible}
      onClose={closeSheet}
      title="Share portal link"
    >
      <View style={{ paddingHorizontal: spacing.lg, gap: spacing.lg }}>
        <Text style={{ color: colors.textMuted, fontSize: 14, lineHeight: 20 }}>
          {isAgent
            ? `Send ${name} the full inventory in agent view, so they can browse it for their clients and forward listings with their own share link. Their visit shows up in Pulse.`
            : `Invite ${name} to browse the portal, filter by their requirements and shortlist the properties they like. The link opens on their recorded interests and their visit shows up in Pulse.`}
        </Text>

        <View
          style={[
            styles.preview,
            {
              backgroundColor: colors.surfaceSunken,
              borderColor: colors.glassBorder,
            },
          ]}
        >
          {preview.isLoading ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.primary} />
              <Text style={{ color: colors.textMuted, fontSize: 13 }}>
                Preparing the invite…
              </Text>
            </View>
          ) : (
            <Text
              style={{ color: colors.text, fontSize: 13.5, lineHeight: 20 }}
            >
              {preview.data?.data.message}
            </Text>
          )}
        </View>

        <View
          style={{
            flexDirection: 'row',
            gap: spacing.sm,
            alignItems: 'flex-start',
          }}
        >
          <Ionicons
            name="information-circle-outline"
            size={19}
            color={colors.textMuted}
          />
          <Text
            style={{
              flex: 1,
              color: colors.textMuted,
              fontSize: 12.5,
              lineHeight: 18,
            }}
          >
            Business WhatsApp is sent and tracked in ConvoReal; outside the
            24-hour window it goes out as the approved property selection
            template with a button to the portal. Personal WhatsApp opens this
            message in your own app and notes the share on the timeline.
          </Text>
        </View>

        {error ? <Banner kind="error" text={error} /> : null}

        <PrimaryButton
          label="Send from business WhatsApp"
          icon="logo-whatsapp"
          busy={sending}
          disabled={!ready}
          onPress={sendFromBusiness}
          testID="portal-invite-business-send"
        />

        {contact.phone ? (
          <Pressable
            onPress={openPersonalWhatsApp}
            disabled={!ready}
            accessibilityRole="button"
            accessibilityLabel="Open in personal WhatsApp"
            style={({ pressed }) => [
              styles.personalButton,
              {
                borderColor: colors.glassBorder,
                backgroundColor: colors.surface,
                opacity: !ready ? 0.45 : pressed ? 0.75 : 1,
              },
            ]}
          >
            <Ionicons name="open-outline" size={18} color={colors.primary} />
            <Text
              style={{
                color: colors.text,
                fontFamily: f.semibold,
                fontSize: 14,
              }}
            >
              Open personal WhatsApp
            </Text>
          </Pressable>
        ) : null}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  preview: {
    minHeight: 96,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
  },
  loading: {
    minHeight: 62,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  personalButton: {
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
});
