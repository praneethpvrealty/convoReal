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
import type { Contact, Property } from '@/lib/types';

interface PreviewResponse {
  data: { message: string; phone: string | null };
}

export function PropertyInterestFollowUpSheet({
  visible,
  onClose,
  contact,
  property,
  onSent,
}: {
  visible: boolean;
  onClose: () => void;
  contact: Contact;
  property: Property;
  onSent: () => void;
}) {
  const { colors, fonts: f } = useTheme();
  const [sending, setSending] = useState(false);
  const [delivery, setDelivery] = useState<'free_text' | 'template' | null>(
    null
  );
  const [sendError, setSendError] = useState<string | null>(null);
  const name = contact.name?.trim() || contact.phone || 'this contact';
  const path = `/api/contacts/${contact.id}/inquiries/${property.id}`;

  const preview = useQuery({
    queryKey: ['property-interest-follow-up', contact.id, property.id],
    enabled: visible,
    queryFn: () => apiFetch<PreviewResponse>(path),
  });

  function closeSheet() {
    setSending(false);
    setDelivery(null);
    setSendError(null);
    onClose();
  }

  async function sendFromEngine() {
    if (sending) return;
    setSending(true);
    setSendError(null);
    try {
      const response = await apiFetch<{
        data: { delivery: 'free_text' | 'template' };
      }>(path, { method: 'POST' });
      setDelivery(response.data.delivery);
      onSent();
    } catch (reason) {
      haptic.warn();
      setSendError(
        friendlyError(
          reason instanceof Error
            ? reason.message
            : 'Could not send the check-in'
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
    haptic.tap();
    try {
      await Linking.openURL(
        `https://wa.me/${digits}?text=${encodeURIComponent(message)}`
      );
      closeSheet();
    } catch {
      haptic.warn();
      setSendError('Could not open WhatsApp on this device.');
    }
  }

  if (delivery) {
    return (
      <SuccessSheet
        visible={visible}
        onClose={closeSheet}
        title="Interest check-in sent"
        message={
          delivery === 'template'
            ? `The approved WhatsApp check-in was sent to ${name}. Their reply will be recorded against this property.`
            : `The check-in was sent to ${name} from your business WhatsApp. Their reply will be recorded against this property.`
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
          : 'Could not prepare the check-in'
      )
    : sendError;

  return (
    <BottomSheet
      visible={visible}
      onClose={closeSheet}
      title="Check latest interest"
    >
      <View style={{ paddingHorizontal: spacing.lg, gap: spacing.lg }}>
        <Text style={{ color: colors.textMuted, fontSize: 14, lineHeight: 20 }}>
          Ask {name} whether they are still considering{' '}
          {property.property_code ? `[${property.property_code}] ` : ''}
          {property.title}.
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
                Preparing property-specific message…
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
            Business WhatsApp is sent and tracked in ConvoReal. Personal
            WhatsApp opens the same message in your own app, so its replies stay
            outside the Engine.
          </Text>
        </View>

        {error ? <Banner kind="error" text={error} /> : null}

        <PrimaryButton
          label="Send from business WhatsApp"
          icon="logo-whatsapp"
          busy={sending}
          disabled={preview.isLoading || !preview.data?.data.message}
          onPress={sendFromEngine}
          testID="property-interest-engine-follow-up"
        />

        {contact.phone ? (
          <Pressable
            onPress={openPersonalWhatsApp}
            disabled={preview.isLoading || !preview.data?.data.message}
            accessibilityRole="button"
            accessibilityLabel="Open in personal WhatsApp"
            style={({ pressed }) => [
              styles.personalButton,
              {
                borderColor: colors.glassBorder,
                backgroundColor: colors.surface,
                opacity:
                  preview.isLoading || !preview.data?.data.message
                    ? 0.45
                    : pressed
                      ? 0.75
                      : 1,
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
