import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { BottomSheet } from '@/components/sheet';
import { SuccessSheet } from '@/components/success-sheet';
import { Banner, PrimaryButton } from '@/components/ui';
import { apiFetch } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { openContactChat } from '@/lib/open-chat';
import { spacing, useTheme } from '@/lib/theme';
import type { Contact } from '@/lib/types';

export function BuyerPreferenceRequestSheet({
  visible,
  onClose,
  contact,
}: {
  visible: boolean;
  onClose: () => void;
  contact: Contact;
}) {
  const { colors, fonts: f } = useTheme();
  const [sending, setSending] = useState(false);
  const [delivery, setDelivery] = useState<'flow' | 'template' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const name = contact.name?.trim() || 'the buyer';

  function closeSheet() {
    setSending(false);
    setDelivery(null);
    setError(null);
    onClose();
  }

  async function sendRequest() {
    if (sending) return;
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

  function openInbox() {
    closeSheet();
    void openContactChat(contact);
  }

  if (delivery) {
    return (
      <SuccessSheet
        visible={visible}
        onClose={closeSheet}
        title={
          delivery === 'flow'
            ? 'Requirement form sent'
            : 'Requirement request sent'
        }
        message={
          delivery === 'flow'
            ? `The pre-filled form was sent to ${name} and recorded in Inbox. Their submitted response will update the requirement and Match Radar.`
            : `A WhatsApp template was sent to ${name} because the 24-hour window was closed. When they tap Update my preferences, the pre-filled form opens and their response updates Match Radar.`
        }
        confetti={false}
        actions={[
          {
            icon: 'chatbubble-ellipses-outline',
            label: 'Open in Inbox',
            onPress: openInbox,
          },
          { icon: 'checkmark-outline', label: 'Done', onPress: closeSheet },
        ]}
      />
    );
  }

  return (
    <BottomSheet
      visible={visible}
      onClose={closeSheet}
      title="Ask for buyer requirements"
    >
      <View style={{ paddingHorizontal: spacing.lg, gap: spacing.lg }}>
        <Text style={{ color: colors.textMuted, fontSize: 14, lineHeight: 20 }}>
          Send {name} a WhatsApp form pre-filled with the preferences already on
          record.
        </Text>

        <View
          style={{
            flexDirection: 'row',
            gap: spacing.sm,
            alignItems: 'flex-start',
          }}
        >
          <Ionicons name="logo-whatsapp" size={19} color={colors.success} />
          <Text
            style={{
              flex: 1,
              color: colors.textMuted,
              fontSize: 13,
              lineHeight: 19,
            }}
          >
            Sent directly from your connected ConvoReal WhatsApp number and
            tracked in Inbox. This will not open your personal WhatsApp.
          </Text>
        </View>

        <View
          style={{
            flexDirection: 'row',
            gap: spacing.md,
            padding: spacing.lg,
            borderRadius: 14,
            backgroundColor: colors.primarySoft,
          }}
        >
          <Ionicons name="radio-outline" size={21} color={colors.primary} />
          <View style={{ flex: 1, gap: spacing.sm }}>
            <Text style={{ color: colors.text, fontFamily: f.semibold }}>
              Built for future matching
            </Text>
            <Text
              style={{ color: colors.textMuted, fontSize: 13, lineHeight: 19 }}
            >
              Only their submitted response changes the record. ConvoReal then
              re-runs matching, sends suitable listings and keeps the active
              requirement available to Match Radar for future properties.
            </Text>
          </View>
        </View>

        {error ? <Banner kind="error" text={error} /> : null}
        {sending ? (
          <Text
            accessibilityLiveRegion="polite"
            style={{
              color: colors.textMuted,
              fontSize: 13,
              textAlign: 'center',
            }}
          >
            Sending through your ConvoReal WhatsApp number…
          </Text>
        ) : null}
        <PrimaryButton
          label="Send from Engine"
          icon="send"
          busy={sending}
          onPress={sendRequest}
          testID="buyer-requirement-send"
        />
      </View>
    </BottomSheet>
  );
}
