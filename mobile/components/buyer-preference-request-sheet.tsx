import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { BottomSheet } from '@/components/sheet';
import { Banner, PrimaryButton } from '@/components/ui';
import { apiFetch } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
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
  const [error, setError] = useState<string | null>(null);
  const name = contact.name?.trim() || 'the buyer';

  async function sendRequest() {
    setSending(true);
    setError(null);
    try {
      await apiFetch('/api/whatsapp/flows/send', {
        method: 'POST',
        body: JSON.stringify({ contact_id: contact.id }),
      });
      haptic.success();
      onClose();
    } catch (reason) {
      haptic.warn();
      setError(
        friendlyError(reason instanceof Error ? reason.message : 'Could not send the form')
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Ask for buyer requirements">
      <View style={{ paddingHorizontal: spacing.lg, gap: spacing.lg }}>
        <Text style={{ color: colors.textMuted, fontSize: 14, lineHeight: 20 }}>
          Send {name} a WhatsApp form pre-filled with the preferences already on record.
        </Text>

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
            <Text style={{ color: colors.textMuted, fontSize: 13, lineHeight: 19 }}>
              Only their submitted response changes the record. ConvoReal then re-runs
              matching, sends suitable listings and keeps the active requirement available
              to Match Radar for future properties.
            </Text>
          </View>
        </View>

        {error ? <Banner kind="error" text={error} /> : null}
        <PrimaryButton
          label="Send on WhatsApp"
          icon="send"
          busy={sending}
          onPress={sendRequest}
        />
      </View>
    </BottomSheet>
  );
}
