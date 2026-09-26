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

type PortfolioSide = 'buyer' | 'owner';

interface PreviewResponse {
  data: {
    sides: PortfolioSide[];
    side: PortfolioSide | null;
    message: string;
    url: string | null;
    phone: string | null;
  };
}

const SIDE_LABELS: Record<PortfolioSide, string> = {
  buyer: 'Buyer Portfolio',
  owner: 'Owner Portfolio',
};

export function PortfolioInviteSheet({
  visible,
  onClose,
  contact,
  onSent,
}: {
  visible: boolean;
  onClose: () => void;
  contact: Pick<Contact, 'id' | 'name' | 'phone'>;
  onSent: () => void;
}) {
  const { colors, fonts: f } = useTheme();
  const [sending, setSending] = useState(false);
  const [sentSide, setSentSide] = useState<PortfolioSide | null>(null);
  const [chosenSide, setChosenSide] = useState<PortfolioSide | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const name = contact.name?.trim() || contact.phone || 'this contact';
  const path = `/api/contacts/${contact.id}/portfolio-invite`;

  const preview = useQuery({
    queryKey: ['portfolio-invite', contact.id, chosenSide],
    enabled: visible,
    queryFn: () =>
      apiFetch<PreviewResponse>(
        chosenSide ? `${path}?side=${chosenSide}` : path
      ),
  });
  const side = preview.data?.data.side ?? null;
  const sides = preview.data?.data.sides ?? [];
  const message = preview.data?.data.message ?? '';

  function closeSheet() {
    setSending(false);
    setSentSide(null);
    setSendError(null);
    onClose();
  }

  async function sendFromBusiness() {
    if (sending || !side) return;
    setSending(true);
    setSendError(null);
    try {
      await apiFetch(path, {
        method: 'POST',
        body: JSON.stringify({ channel: 'business', side }),
      });
      setSentSide(side);
      onSent();
    } catch (reason) {
      haptic.warn();
      setSendError(
        friendlyError(
          reason instanceof Error
            ? reason.message
            : 'Could not send the Portfolio invite'
        )
      );
    } finally {
      setSending(false);
    }
  }

  async function openPersonalWhatsApp() {
    const digits = contact.phone?.replace(/\D/g, '') ?? '';
    if (!digits || !message || !side) return;
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
        body: JSON.stringify({ channel: 'personal', side }),
      });
      onSent();
    } catch {
      // The chat is already open; a missing timeline note is not worth a warning.
    }
  }

  if (sentSide) {
    return (
      <SuccessSheet
        visible={visible}
        onClose={closeSheet}
        title="Portfolio invite sent"
        message={`The ${SIDE_LABELS[sentSide]} invite was sent to ${name} from your business WhatsApp. Their reply lands in your Inbox.`}
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
          : 'Could not prepare the Portfolio invite'
      )
    : sendError;
  const ready = !preview.isLoading && Boolean(side && message);

  return (
    <BottomSheet
      visible={visible}
      onClose={closeSheet}
      title="Portfolio invite"
    >
      <View style={{ paddingHorizontal: spacing.lg, gap: spacing.lg }}>
        <Text style={{ color: colors.textMuted, fontSize: 14, lineHeight: 20 }}>
          {side === 'owner'
            ? `Invite ${name} to their Owner Portfolio to track enquiries, visits and offers on their property and add new listings themselves.`
            : side === 'buyer'
              ? `Invite ${name} to their Portfolio to see matched properties, keep a shortlist and update their requirements.`
              : `Invite ${name} to sign in to their Portfolio with this WhatsApp number.`}
        </Text>

        {sides.length > 1 ? (
          <View style={styles.sides}>
            {sides.map((option) => (
              <Pressable
                key={option}
                onPress={() => {
                  setSendError(null);
                  setChosenSide(option);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: option === side }}
                style={[
                  styles.sideButton,
                  {
                    borderColor:
                      option === side ? colors.primary : colors.glassBorder,
                    backgroundColor:
                      option === side ? colors.surfaceSunken : colors.surface,
                  },
                ]}
              >
                <Text
                  style={{
                    color: option === side ? colors.text : colors.textMuted,
                    fontFamily: f.semibold,
                    fontSize: 13.5,
                  }}
                >
                  {SIDE_LABELS[option]}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}

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
          ) : message ? (
            <Text
              style={{ color: colors.text, fontSize: 13.5, lineHeight: 20 }}
            >
              {message}
            </Text>
          ) : (
            <Text
              style={{
                color: colors.textMuted,
                fontSize: 13.5,
                lineHeight: 20,
              }}
            >
              {`Portfolio is for buyers and owners. Classify ${name} as a Buyer, Owner or Seller, or link them to a listing or enquiry, and the invite will be ready here.`}
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
            Business WhatsApp is sent and tracked in ConvoReal while the 24-hour
            window is open. Personal WhatsApp opens this message in your own app
            and notes the invite on the timeline.
          </Text>
        </View>

        {error ? <Banner kind="error" text={error} /> : null}

        <PrimaryButton
          label="Send from business WhatsApp"
          icon="logo-whatsapp"
          busy={sending}
          disabled={!ready}
          onPress={sendFromBusiness}
          testID="portfolio-invite-business-send"
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
  sides: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  sideButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
