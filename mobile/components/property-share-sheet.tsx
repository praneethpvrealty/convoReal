import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { File, Paths } from 'expo-file-system';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AppDialog, type DialogAction } from '@/components/app-dialog';
import { ContactPickerSheet } from '@/components/contact-picker-sheet';
import { BottomSheet } from '@/components/sheet';
import { FilterChip, SectionLabel } from '@/components/ui';
import { apiFetch } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { ENV } from '@/lib/env';
import { haptic } from '@/lib/haptics';
import { storagePublicUrl } from '@/lib/storage-url';
import {
  logExternalShare,
  sendPropertyViaCrm,
} from '@/lib/property-share-actions';
import {
  addRecipientGreeting,
  buildPropertyShareMessage,
  buildShareTargets,
  type ShareAudience,
  type ShareDetailLevel,
  type ShareTone,
} from '@/lib/share-message';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { Contact, Property } from '@/lib/types';

const TONES: { value: ShareTone; label: string }[] = [
  { value: 'professional', label: '💼 Professional' },
  { value: 'casual', label: '👋 Casual' },
  { value: 'friendly', label: '😊 Friendly' },
];

const DETAILS: { value: ShareDetailLevel; label: string }[] = [
  { value: 'quick', label: 'Quick' },
  { value: 'standard', label: 'Standard' },
  { value: 'complete', label: 'Complete' },
];

/**
 * Mobile port of the web share dialog: audience, tone and detail
 * pickers over the same message builder (lib/share-message mirrors
 * the web module 1:1), an editable draft, and channel buttons.
 * "Send from CRM" stays in the conversation thread's template picker.
 */
export function PropertyShareSheet({
  property,
  visible,
  onClose,
}: {
  property: Property;
  visible: boolean;
  onClose: () => void;
}) {
  const { colors, fonts: f } = useTheme();
  const session = useAuthStore((s) => s.session);
  const fullName = useAuthStore((s) => s.profile?.full_name);
  const [audience, setAudience] = useState<ShareAudience>('client');
  const [tone, setTone] = useState<ShareTone>('professional');
  const [detail, setDetail] = useState<ShareDetailLevel>('standard');
  const [message, setMessage] = useState('');
  const [copied, setCopied] = useState<'link' | 'message' | null>(null);
  const [picker, setPicker] = useState<'external' | 'crm' | null>(null);
  const [crmSending, setCrmSending] = useState(false);
  const [sharingPhoto, setSharingPhoto] = useState(false);
  const [dialog, setDialog] = useState<{ title: string; message?: string; actions: DialogAction[] } | null>(null);

  // Client link opens the showcase (inquiry form); co-broker gets the
  // clean view-only page — same URLs the web dialog builds.
  const url = `${ENV.apiBaseUrl}/?property_id=${property.id}${audience === 'agent' ? '&mode=view' : ''}`;

  // Sign the message with the account's own name (Settings → profile),
  // reactive via the auth store, and fall back to the email handle only
  // until a name is set.
  const emailName = (session?.user.email?.split('@')[0] ?? '').split(/[._-]/)[0];
  const agentName =
    fullName?.trim() ||
    (emailName ? emailName.charAt(0).toUpperCase() + emailName.slice(1) : undefined);
  const agentPhone = session?.user.phone ? `+${session.user.phone.replace(/^\+/, '')}` : undefined;

  const generated = useMemo(
    () =>
      buildPropertyShareMessage({
        property,
        url,
        audience,
        detail,
        tone,
        agentName,
        agentPhone,
      }),
    [property, url, audience, detail, tone, agentName, agentPhone]
  );

  // Picker changes re-draft (discarding edits, same as the web dialog).
  useEffect(() => {
    setMessage(generated);
  }, [generated]);

  const targets = buildShareTargets(message, url, property.title);

  async function copy(kind: 'link' | 'message') {
    haptic.tap();
    await Clipboard.setStringAsync(kind === 'link' ? url : message);
    setCopied(kind);
    setTimeout(() => setCopied(null), 1500);
  }

  // External WhatsApp: address the deep link to the picked contact and
  // log the share on their timeline so it's tracked; "skip" keeps the
  // old behaviour (WhatsApp's own contact chooser, untracked).
  async function shareExternalWithContact(contact: Contact) {
    setPicker(null);
    haptic.send();
    void logExternalShare(contact, property);
    const phone = contact.phone.replace(/\D/g, '');
    const text = addRecipientGreeting(message, contact.name);
    Linking.openURL(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`);
    onClose();
  }

  function shareExternalWithoutContact() {
    setPicker(null);
    haptic.send();
    Linking.openURL(targets.whatsapp);
  }

  // Share the cover photo itself as an image attachment. Uses the listing's
  // first photo; when it has none (common for land/plots), renders a branded
  // flyer server-side and shares that — so a photoless listing still sends a
  // real image, mirroring the web dialog's cover-photo behaviour.
  async function sharePhoto() {
    if (sharingPhoto) return;
    setSharingPhoto(true);
    haptic.tap();
    try {
      if (!(await Sharing.isAvailableAsync())) {
        throw new Error('Sharing is not available on this device.');
      }

      let bytes: Uint8Array;
      let ext = 'jpg';
      let mimeType = 'image/jpeg';

      const firstImage = property.images?.find((u) => u && u.trim().length > 0);
      if (firstImage) {
        const res = await fetch(storagePublicUrl(firstImage));
        if (!res.ok) throw new Error('Could not load the listing photo.');
        bytes = new Uint8Array(await res.arrayBuffer());
        const ct = res.headers.get('content-type');
        if (ct?.startsWith('image/')) {
          mimeType = ct;
          ext = ct.split('/')[1] || 'jpg';
        }
      } else {
        const flyer = await apiFetch<{ data: { image: string } }>(
          `/api/properties/${property.id}/flyer`,
          { method: 'POST', body: JSON.stringify({ size: 1080 }) },
        );
        const dataUrl = flyer.data.image;
        const b64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
        const bin = atob(b64);
        bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        ext = 'png';
        mimeType = 'image/png';
      }

      const file = new File(Paths.cache, `property-${property.id}-${Date.now()}.${ext}`);
      file.create();
      file.write(bytes);

      await Sharing.shareAsync(file.uri, {
        mimeType,
        dialogTitle: property.title || 'Property',
      });
      haptic.success();
    } catch (err) {
      haptic.warn();
      setDialog({
        title: 'Could not share the photo',
        message: err instanceof Error ? err.message : 'Please try again.',
        actions: [{ label: 'OK', variant: 'primary', onPress: () => setDialog(null) }],
      });
    } finally {
      setSharingPhoto(false);
    }
  }

  // ConvoReal WhatsApp: send from the account's business number so the
  // message is delivered and logged in the shared inbox thread.
  async function sendViaConvoReal(contact: Contact) {
    setCrmSending(true);
    haptic.send();
    const outcome = await sendPropertyViaCrm(contact, addRecipientGreeting(message, contact.name));
    setCrmSending(false);
    setPicker(null);
    if (outcome.sent) {
      haptic.success();
      onClose();
      if (outcome.conversationId) router.push(`/(app)/conversation/${outcome.conversationId}`);
      return;
    }
    if (outcome.reengage && outcome.conversationId) {
      haptic.warn();
      const convId = outcome.conversationId;
      setDialog({
        title: 'Outside the 24-hour window',
        message: `${contact.name || contact.phone} hasn’t messaged in the last 24 hours, so WhatsApp only allows an approved template. Open the chat to send one.`,
        actions: [
          { label: 'Not now', variant: 'muted', onPress: () => setDialog(null) },
          {
            label: 'Open chat',
            variant: 'primary',
            onPress: () => {
              setDialog(null);
              onClose();
              router.push(`/(app)/conversation/${convId}`);
            },
          },
        ],
      });
      return;
    }
    haptic.warn();
    setDialog({
      title: 'Could not send',
      message: outcome.error ?? 'Please try again.',
      actions: [{ label: 'OK', variant: 'primary', onPress: () => setDialog(null) }],
    });
  }

  const channels = [
    { key: 'whatsapp', icon: 'logo-whatsapp' as const, label: 'WhatsApp', color: colors.success, onPress: () => setPicker('external') },
    { key: 'telegram', icon: 'paper-plane' as const, label: 'Telegram', color: colors.readTick, onPress: () => Linking.openURL(targets.telegram) },
    { key: 'email', icon: 'mail-outline' as const, label: 'Email', color: colors.primary, onPress: () => Linking.openURL(targets.email) },
    { key: 'sms', icon: 'chatbox-outline' as const, label: 'SMS', color: colors.primary, onPress: () => Linking.openURL(targets.sms) },
    { key: 'copy', icon: (copied === 'message' ? 'checkmark' : 'copy-outline') as 'checkmark' | 'copy-outline', label: copied === 'message' ? 'Copied!' : 'Copy message', color: colors.primary, onPress: () => copy('message') },
    { key: 'photo', icon: (sharingPhoto ? 'hourglass-outline' : 'image-outline') as 'hourglass-outline' | 'image-outline', label: sharingPhoto ? 'Preparing…' : 'Share photo', color: colors.primary, onPress: sharePhoto },
    { key: 'more', icon: 'share-social-outline' as const, label: 'More apps…', color: colors.primary, onPress: () => Share.share({ message }) },
  ];

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Share property">
      <ScrollView
        style={{ flexShrink: 1 }}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.md, paddingBottom: spacing.sm }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <AudienceCard
            title="To Client"
            subtitle="Showcase page with inquiry form"
            active={audience === 'client'}
            onPress={() => setAudience('client')}
          />
          <AudienceCard
            title="To Co-Broker"
            subtitle="Clean page, no inquiry forms"
            active={audience === 'agent'}
            onPress={() => setAudience('agent')}
          />
        </View>

        {audience === 'client' ? (
          <>
            <SectionLabel text="Tone" />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              {TONES.map((t) => (
                <FilterChip
                  key={t.value}
                  label={t.label}
                  active={tone === t.value}
                  onPress={() => setTone(t.value)}
                />
              ))}
            </View>
          </>
        ) : null}

        <SectionLabel text="How much detail?" />
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          {DETAILS.map((d) => (
            <FilterChip
              key={d.value}
              label={d.label}
              active={detail === d.value}
              onPress={() => setDetail(d.value)}
            />
          ))}
        </View>

        <SectionLabel text="Message — tap to edit" />
        <TextInput
          multiline
          value={message}
          onChangeText={setMessage}
          accessibilityLabel="Share message"
          style={[
            styles.draft,
            { backgroundColor: colors.surfaceRaised, borderColor: colors.border, color: colors.text },
          ]}
        />

        <Pressable
          onPress={() => copy('link')}
          accessibilityRole="button"
          accessibilityLabel="Copy link"
          style={[styles.linkRow, { backgroundColor: colors.surfaceSunken }]}
        >
          <Text style={{ flex: 1, fontSize: 12, color: colors.textMuted }} numberOfLines={1}>
            {url}
          </Text>
          <Ionicons
            name={copied === 'link' ? 'checkmark' : 'copy-outline'}
            size={15}
            color={copied === 'link' ? colors.success : colors.primary}
          />
        </Pressable>

        <SectionLabel text="Send from ConvoReal" />
        <Pressable
          onPress={() => setPicker('crm')}
          accessibilityRole="button"
          accessibilityLabel="Send via ConvoReal WhatsApp"
          style={[styles.crmButton, { backgroundColor: colors.primarySoft, borderColor: colors.primary }]}
        >
          <Ionicons name="logo-whatsapp" size={20} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 14, fontFamily: f.bold, color: colors.primary }}>
              Send via ConvoReal WhatsApp
            </Text>
            <Text style={{ fontSize: 11.5, color: colors.textMuted }}>
              Delivers from your business number and logs to the chat thread
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.primary} />
        </Pressable>

        <SectionLabel text="Send via" />
        <View style={styles.channelGrid}>
          {channels.map((c) => (
            <Pressable
              key={c.key}
              onPress={c.onPress}
              accessibilityRole="button"
              accessibilityLabel={c.label}
              style={[styles.channel, { backgroundColor: colors.glass, borderColor: colors.glassBorder }]}
            >
              <Ionicons name={c.icon} size={17} color={c.color} />
              <Text style={{ fontSize: 13, fontFamily: f.semibold, color: colors.text }}>
                {c.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={{ fontSize: 11.5, color: colors.textFaint, textAlign: 'center' }}>
          Sending via ConvoReal WhatsApp delivers from your business number and is
          tracked in the conversation thread. Pick a contact on WhatsApp to log the
          share on their timeline too.
        </Text>
      </ScrollView>

      <ContactPickerSheet
        visible={picker === 'external'}
        onClose={() => setPicker(null)}
        onSelect={shareExternalWithContact}
        title="Share on WhatsApp"
        hint="Pick a contact to open WhatsApp addressed to them and log the share on their timeline."
        skipLabel="Open WhatsApp without a contact"
        onSkip={shareExternalWithoutContact}
      />
      <ContactPickerSheet
        visible={picker === 'crm'}
        onClose={() => setPicker(null)}
        onSelect={sendViaConvoReal}
        title="Send via ConvoReal WhatsApp"
        hint="Choose who receives this listing from your business number."
        busy={crmSending}
        busyLabel="Sending from ConvoReal…"
      />
      <AppDialog
        visible={dialog !== null}
        onClose={() => setDialog(null)}
        title={dialog?.title ?? ''}
        message={dialog?.message}
        actions={dialog?.actions ?? []}
      />
    </BottomSheet>
  );
}

function AudienceCard({
  title,
  subtitle,
  active,
  onPress,
}: {
  title: string;
  subtitle: string;
  active: boolean;
  onPress: () => void;
}) {
  const { colors, fonts: f } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ selected: active }}
      style={[
        styles.audience,
        {
          backgroundColor: active ? colors.primarySoft : colors.glass,
          borderColor: active ? colors.primary : colors.glassBorder,
        },
      ]}
    >
      <Text style={{ fontSize: 14, fontFamily: f.bold, color: active ? colors.primary : colors.text }}>
        {title}
      </Text>
      <Text style={{ fontSize: 11.5, color: colors.textMuted }}>{subtitle}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  audience: {
    flex: 1,
    gap: 3,
    borderRadius: radius.md,
    borderWidth: 1.5,
    padding: spacing.md,
  },
  draft: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 13.5,
    lineHeight: 19,
    minHeight: 140,
    maxHeight: 220,
    textAlignVertical: 'top',
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
  },
  crmButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  channelGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  channel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: 14,
    minHeight: 42,
  },
});
