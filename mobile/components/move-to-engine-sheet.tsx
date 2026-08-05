import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { BottomSheet, sheetScrollArea } from '@/components/sheet';
import { SectionLabel } from '@/components/ui';
import { apiFetch } from '@/lib/api';
import { buildEngineInvite, type EngineNumber } from '@/lib/engine-invite';
import { friendlyError } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { Contact } from '@/lib/types';

/**
 * Mobile port of the web's Move to Engine dialog.
 *
 * A contact an agent only ever messaged from their personal number is
 * invisible to the Engine: no conversation, no 24-hour window, and the
 * match digest cannot even ask for alert consent without one. Only the
 * contact can fix that by messaging the Engine number once, so this
 * hands them a link that does it — the pre-filled START ALERTS is what
 * the webhook reads on arrival, opening the window and recording
 * consent in the same tap.
 */
export function MoveToEngineSheet({
  visible,
  onClose,
  contact,
}: {
  visible: boolean;
  onClose: () => void;
  contact: Contact;
}) {
  const { colors, fonts: f } = useTheme();

  // Cached across contacts — the connected number rarely changes.
  const engineQuery = useQuery({
    queryKey: ['engine-number'],
    queryFn: () =>
      apiFetch<{ data: EngineNumber }>('/api/whatsapp/engine-number').then((r) => r.data),
    enabled: visible,
    retry: false,
    staleTime: 10 * 60 * 1000,
  });
  const engine = engineQuery.data;

  // Derived draft: an edit overrides it, closing throws the override
  // away so the next contact never inherits this one's name.
  const [draft, setDraft] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const message = draft ?? (engine ? buildEngineInvite(engine, contact.name ?? '') : '');

  function close() {
    setDraft(null);
    setCopied(false);
    onClose();
  }

  function sendOnWhatsApp() {
    const digits = contact.phone.replace(/\D/g, '');
    if (!digits) return;
    haptic.send();
    void Linking.openURL(`https://wa.me/${digits}?text=${encodeURIComponent(message)}`);
    close();
  }

  async function copyInvite() {
    haptic.tap();
    await Clipboard.setStringAsync(message);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <BottomSheet visible={visible} onClose={close} title="Move to Engine WhatsApp">
      {engineQuery.isPending ? (
        <View style={styles.state}>
          <ActivityIndicator color={colors.primary} />
          <Text style={{ fontSize: 12, color: colors.textMuted }}>
            Reading your connected number…
          </Text>
        </View>
      ) : engineQuery.isError ? (
        <View
          style={[
            styles.notice,
            { backgroundColor: colors.surfaceSunken, borderColor: colors.border },
          ]}
        >
          <Ionicons name="warning-outline" size={16} color={colors.warning} />
          <Text style={{ flex: 1, fontSize: 12.5, color: colors.text, lineHeight: 18 }}>
            {friendlyError((engineQuery.error as Error).message)}
          </Text>
        </View>
      ) : (
        <ScrollView
          style={sheetScrollArea}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ gap: spacing.md }}
        >
          <Text style={{ fontSize: 12.5, color: colors.textMuted, lineHeight: 18 }}>
            Send this from wherever you already message {contact.name || 'them'}. One tap opens
            their chat on the Engine number and switches on property alerts.
          </Text>

          <View
            style={[
              styles.numberCard,
              { backgroundColor: colors.surfaceSunken, borderColor: colors.border },
            ]}
          >
            <Text style={{ fontSize: 10.5, color: colors.textMuted, fontFamily: f.semibold }}>
              ENGINE NUMBER
            </Text>
            <Text style={{ fontSize: 15, color: colors.text, fontFamily: f.bold, marginTop: 2 }}>
              {engine?.phone}
            </Text>
            {engine?.sandbox ? (
              <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 4, lineHeight: 16 }}>
                Shared sandbox number — the link carries your {engine.prefix.trim()} code so their
                message reaches this account.
              </Text>
            ) : null}
          </View>

          <SectionLabel text="Invite — tap to edit" />
          <TextInput
            multiline
            scrollEnabled={false}
            value={message}
            onChangeText={setDraft}
            accessibilityLabel="Invite message"
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
            Keep the link intact — the pre-filled text is what turns their alerts on.
          </Text>

          <Pressable
            onPress={sendOnWhatsApp}
            accessibilityRole="button"
            accessibilityLabel={`Send the Engine invite to ${contact.name || 'this contact'} on WhatsApp`}
            style={[
              styles.primary,
              { backgroundColor: colors.primarySoft, borderColor: colors.primary },
            ]}
          >
            <Ionicons name="logo-whatsapp" size={20} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontFamily: f.bold, color: colors.primary }}>
                Send on WhatsApp
              </Text>
              <Text style={{ fontSize: 11.5, color: colors.textMuted }}>
                Opens your own chat with them, message ready to send
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.primary} />
          </Pressable>

          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Pressable
              onPress={copyInvite}
              accessibilityRole="button"
              accessibilityLabel="Copy the invite"
              style={[styles.secondary, { backgroundColor: colors.glass, borderColor: colors.glassBorder }]}
            >
              <Ionicons
                name={copied ? 'checkmark' : 'copy-outline'}
                size={16}
                color={copied ? colors.success : colors.primary}
              />
              <Text style={{ fontSize: 12.5, fontFamily: f.semibold, color: colors.text }}>
                {copied ? 'Copied' : 'Copy'}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                haptic.tap();
                void Share.share({ message });
              }}
              accessibilityRole="button"
              accessibilityLabel="Share the invite with another app"
              style={[styles.secondary, { backgroundColor: colors.glass, borderColor: colors.glassBorder }]}
            >
              <Ionicons name="share-social-outline" size={16} color={colors.primary} />
              <Text style={{ fontSize: 12.5, fontFamily: f.semibold, color: colors.text }}>
                More apps…
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  state: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  notice: {
    flexDirection: 'row',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  numberCard: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  draft: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 13,
    lineHeight: 19,
    minHeight: 132,
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
