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

type PortfolioSide = 'buyer' | 'owner' | 'agent';

interface PreviewResponse {
  data: {
    sides: PortfolioSide[];
    side: PortfolioSide | null;
    message: string;
    url: string | null;
    phone: string | null;
    agentRegistered?: boolean;
  };
}

const SIDE_LABELS: Record<PortfolioSide, string> = {
  buyer: 'Buyer Portfolio',
  owner: 'Owner Portfolio',
  agent: 'Agent Invite',
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
  const [sent, setSent] = useState<{
    side: PortfolioSide;
    delivery: 'free_text' | 'template';
  } | null>(null);
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
  const agentSide = side === 'agent';
  const agentRegistered = preview.data?.data.agentRegistered === true;

  function closeSheet() {
    setSending(false);
    setSent(null);
    setSendError(null);
    onClose();
  }

  async function sendFromBusiness() {
    if (sending || !side) return;
    setSending(true);
    setSendError(null);
    try {
      const response = await apiFetch<{
        data: { delivery: 'free_text' | 'template' };
      }>(path, {
        method: 'POST',
        body: JSON.stringify({ channel: 'business', side }),
      });
      setSent({ side, delivery: response.data.delivery });
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

  async function openAgentInvite() {
    const digits = contact.phone?.replace(/\D/g, '') ?? '';
    if (!digits || sending) return;
    setSending(true);
    setSendError(null);
    let shareMessage: string;
    try {
      const invite = await apiFetch<{ shareMessage: string }>(
        '/api/beta-invites',
        {
          method: 'POST',
          body: JSON.stringify({
            label: contact.name?.trim() || null,
            invitee_phone: contact.phone,
          }),
        }
      );
      shareMessage = invite.shareMessage;
    } catch (reason) {
      haptic.warn();
      setSendError(
        friendlyError(
          reason instanceof Error
            ? reason.message
            : 'Could not create the ConvoReal invite'
        )
      );
      setSending(false);
      return;
    }
    haptic.send();
    try {
      await Linking.openURL(
        `https://wa.me/${digits}?text=${encodeURIComponent(shareMessage)}`
      );
    } catch {
      haptic.warn();
      setSending(false);
      setSendError('Could not open WhatsApp on this device.');
      return;
    }
    closeSheet();
    try {
      await apiFetch(path, {
        method: 'POST',
        body: JSON.stringify({ channel: 'personal', side: 'agent' }),
      });
      onSent();
    } catch {
      // The chat is already open; a missing timeline note is not worth a warning.
    }
  }

  async function openPersonalWhatsApp() {
    if (agentSide) return openAgentInvite();
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

  if (sent) {
    return (
      <SuccessSheet
        visible={visible}
        onClose={closeSheet}
        title="Portfolio invite sent"
        message={
          sent.delivery === 'template'
            ? `The approved Portfolio access template went to ${name} with a button to sign in to their ${SIDE_LABELS[sent.side]}. Their reply lands in your Inbox.`
            : `The ${SIDE_LABELS[sent.side]} invite was sent to ${name} from your business WhatsApp. Their reply lands in your Inbox.`
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
          : 'Could not prepare the Portfolio invite'
      )
    : sendError;
  const ready =
    !preview.isLoading &&
    (agentSide ? !agentRegistered : Boolean(side && message));

  return (
    <BottomSheet
      visible={visible}
      onClose={closeSheet}
      title="Portfolio invite"
    >
      <View style={{ paddingHorizontal: spacing.lg, gap: spacing.lg }}>
        <Text style={{ color: colors.textMuted, fontSize: 14, lineHeight: 20 }}>
          {agentSide
            ? `Invite ${name} to ConvoReal to run their own inventory, so you can share listings and requirements with them directly.`
            : side === 'owner'
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
                  numberOfLines={2}
                  style={{
                    color: option === side ? colors.text : colors.textMuted,
                    fontFamily: f.semibold,
                    fontSize: 13.5,
                    textAlign: 'center',
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
          ) : agentSide ? (
            <Text
              style={{ color: colors.text, fontSize: 13.5, lineHeight: 20 }}
            >
              {agentRegistered
                ? `${name} already uses ConvoReal. Use Share Inventory to send listings straight to their Pending Review queue.`
                : `Personal WhatsApp creates a ConvoReal invite link for ${name}, using one of your invite seats, and opens it ready to send from your own WhatsApp.`}
            </Text>
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
              {`Portfolio is for buyers and owners. Classify ${name} as a Buyer, Owner or Seller, or link them to a listing or enquiry, and the invite will be ready here. Classify an agent as Agent to invite them to ConvoReal.`}
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
            {agentSide
              ? 'A ConvoReal invite is a personal note from you to another agent, so it goes from your own WhatsApp, never the business number. The invite is noted on the timeline.'
              : 'Business WhatsApp is sent and tracked in ConvoReal; outside the 24-hour window it goes out as the approved Portfolio access template with a sign-in button. Personal WhatsApp opens this message in your own app and notes the invite on the timeline.'}
          </Text>
        </View>

        {error ? <Banner kind="error" text={error} /> : null}

        {agentSide ? (
          <PrimaryButton
            label="Open personal WhatsApp"
            icon="logo-whatsapp"
            busy={sending}
            disabled={!ready || !contact.phone}
            onPress={openAgentInvite}
            testID="portfolio-invite-agent-send"
          />
        ) : (
          <PrimaryButton
            label="Send from business WhatsApp"
            icon="logo-whatsapp"
            busy={sending}
            disabled={!ready}
            onPress={sendFromBusiness}
            testID="portfolio-invite-business-send"
          />
        )}

        {contact.phone && !agentSide ? (
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
    paddingHorizontal: spacing.xs,
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
