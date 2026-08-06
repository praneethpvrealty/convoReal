import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { File, Paths } from 'expo-file-system';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useEffect, useMemo, useState } from 'react';
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

import { AppDialog, type DialogAction } from '@/components/app-dialog';
import { ContactPickerSheet } from '@/components/contact-picker-sheet';
import { BottomSheet, sheetScrollArea } from '@/components/sheet';
import { FilterChip, SectionLabel } from '@/components/ui';
import { apiFetch } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { ENV } from '@/lib/env';
import { haptic } from '@/lib/haptics';
import { storagePublicUrl } from '@/lib/storage-url';
import {
  logExternalShare,
  sendPropertyViaEngine,
} from '@/lib/property-share-actions';
import { propertyShareUrl } from '@/lib/property-share-link';
import {
  addRecipientGreeting,
  buildPropertyShareMessage,
  buildShareTargets,
  type ShareAudience,
  type ShareDetailLevel,
  type ShareTone,
} from '@/lib/share-message';
import { fetchShowcaseSubdomain } from '@/lib/showcase-settings';
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
 * "Send from Engine" stays in the conversation thread's template picker.
 *
 * Opened from a contact's linked listing the recipient is already
 * known, so `contact` preselects it: both send paths address that
 * contact directly instead of asking again through the picker.
 */
export function PropertyShareSheet({
  property,
  visible,
  onClose,
  contact = null,
}: {
  property: Property;
  visible: boolean;
  onClose: () => void;
  /** Preselected recipient; when set, neither send path opens the picker. */
  contact?: Contact | null;
}) {
  const { colors, fonts: f } = useTheme();
  const session = useAuthStore((s) => s.session);
  const fullName = useAuthStore((s) => s.profile?.full_name);
  const [audience, setAudience] = useState<ShareAudience>('client');
  const [tone, setTone] = useState<ShareTone>('professional');
  const [detail, setDetail] = useState<ShareDetailLevel>('standard');
  const [message, setMessage] = useState('');
  const [copied, setCopied] = useState<'link' | 'message' | null>(null);
  const [picker, setPicker] = useState<'external' | 'engine' | null>(null);
  const [engineSending, setEngineSending] = useState(false);
  const [sharingPhoto, setSharingPhoto] = useState(false);
  const [dialog, setDialog] = useState<{ title: string; message?: string; actions: DialogAction[] } | null>(null);

  // The account's showcase subdomain, so a link shared from a phone
  // lands on the agency's own showcase like the web dialog's does.
  // Until it resolves, the link falls back to `?ref=<account>` on the
  // shared domain, which still scopes the catalog to this account.
  const accountId = useAuthStore((s) => s.profile?.account_id) ?? null;
  const subdomain = useQuery({
    queryKey: ['showcase-subdomain', accountId],
    queryFn: () => fetchShowcaseSubdomain(accountId),
    enabled: Boolean(accountId),
    staleTime: 5 * 60_000,
  });

  // Client link opens the showcase (inquiry form); co-broker gets the
  // clean view-only page — same URLs the web dialog builds.
  const url = propertyShareUrl({
    siteUrl: ENV.apiBaseUrl,
    subdomain: subdomain.data ?? null,
    accountId,
    property,
    audience,
  });

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

  // External WhatsApp: address the deep link to the picked contact, tag the
  // showcase link so their activity is attributed in Pulse, and log the
  // share on their Engine timeline; "skip" keeps the old behaviour (WhatsApp's
  // own contact chooser, untracked link).
  async function shareExternalWithContact(contact: Contact) {
    setPicker(null);
    haptic.send();
    void logExternalShare(contact, property);
    const phone = contact.phone.replace(/\D/g, '');
    // Tag the link with v=<contactId> so the recipient's opens, swipes and
    // dwell show by name in Showcase Pulse instead of as an Anonymous Guest
    // (v= only attributes events, never filters). `url` already carries
    // ?property_id=, so &v= is a safe append; swap it into the (possibly
    // edited) draft, or append the tracked link if the agent removed it.
    const trackedUrl = `${url}&v=${contact.id}`;
    const linked = message.includes(url)
      ? message.split(url).join(trackedUrl)
      : `${message}\n\n📸 Photos & full details:\n${trackedUrl}`;
    const text = addRecipientGreeting(linked, contact.name);
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
  // message is delivered and logged in the shared inbox thread. The
  // server sends free text inside the 24-hour window and falls back to
  // the pre-approved property template outside it — the dialog below
  // only appears when that template isn't approved yet.
  async function sendViaConvoReal(contact: Contact) {
    setEngineSending(true);
    haptic.send();
    const outcome = await sendPropertyViaEngine(
      contact,
      property,
      addRecipientGreeting(message, contact.name)
    );
    setEngineSending(false);
    setPicker(null);
    if (outcome.sent) {
      haptic.success();
      onClose();
      if (outcome.conversationId) router.push(`/(app)/conversation/${outcome.conversationId}`);
      return;
    }
    if (outcome.templateStatus) {
      haptic.warn();
      const convId = outcome.conversationId;
      const pending = outcome.templateStatus === 'PENDING';
      setDialog({
        title: pending ? 'Template awaiting Meta approval' : 'One-time template setup needed',
        message: pending
          ? `${contact.name || contact.phone} hasn’t messaged in the last 24 hours, so this share needs the approved property template — it’s still under review by Meta (usually minutes to a few hours). Try again once it’s approved, or open the chat to send another approved template.`
          : `${contact.name || contact.phone} hasn’t messaged in the last 24 hours, so WhatsApp requires a pre-approved template. An Org Manager can set up the property template once from Radar on the ConvoReal web app — after Meta approves it, shares like this go out automatically. For now, open the chat to send an approved template.`,
        actions: [
          { label: 'Not now', variant: 'muted', onPress: () => setDialog(null) },
          ...(convId
            ? [
                {
                  label: 'Open chat',
                  variant: 'primary' as const,
                  onPress: () => {
                    setDialog(null);
                    onClose();
                    router.push(`/(app)/conversation/${convId}`);
                  },
                },
              ]
            : []),
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

  // Fan-out for the Engine channel. Each contact gets their own greeting and
  // their own 24-hour-window verdict, so sends are reported per person
  // rather than as one pass/fail — a closed window for one recipient must
  // not read as a failure for the rest.
  async function sendViaConvoRealMany(contacts: Contact[]) {
    if (contacts.length === 0) return;
    // One recipient keeps the richer single-send path, which lands the
    // agent in the conversation thread afterwards.
    if (contacts.length === 1) {
      await sendViaConvoReal(contacts[0]);
      return;
    }
    setEngineSending(true);
    haptic.send();
    const blocked: string[] = [];
    const failed: string[] = [];
    let sent = 0;
    for (const c of contacts) {
      const outcome = await sendPropertyViaEngine(
        c,
        property,
        addRecipientGreeting(message, c.name)
      );
      if (outcome.sent) {
        sent++;
      } else if (outcome.templateStatus) {
        blocked.push(c.name || c.phone);
      } else {
        failed.push(c.name || c.phone);
      }
    }
    setEngineSending(false);
    setPicker(null);

    if (sent === contacts.length) {
      haptic.success();
      onClose();
      return;
    }
    haptic.warn();
    setDialog({
      title: `Sent to ${sent} of ${contacts.length}`,
      message: [
        blocked.length
          ? `No message in the last 24 hours, so WhatsApp needs an approved template for: ${blocked.join(', ')}.`
          : null,
        failed.length ? `Could not send to: ${failed.join(', ')}.` : null,
      ]
        .filter(Boolean)
        .join('\n\n'),
      actions: [{ label: 'OK', variant: 'primary', onPress: () => setDialog(null) }],
    });
  }

  const recipientName = contact ? contact.name || contact.phone : null;

  const channels = [
    {
      key: 'whatsapp',
      icon: 'logo-whatsapp' as const,
      label: 'WhatsApp',
      color: colors.success,
      onPress: () => (contact ? void shareExternalWithContact(contact) : setPicker('external')),
    },
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
        style={sheetScrollArea}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.md, paddingBottom: spacing.sm }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
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
          scrollEnabled={false}
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
          disabled={engineSending}
          onPress={() => (contact ? void sendViaConvoReal(contact) : setPicker('engine'))}
          accessibilityRole="button"
          accessibilityState={{ disabled: engineSending, busy: engineSending }}
          accessibilityLabel={
            recipientName
              ? `Send via ConvoReal WhatsApp to ${recipientName}`
              : 'Send via ConvoReal WhatsApp'
          }
          style={[
            styles.engineButton,
            { backgroundColor: colors.primarySoft, borderColor: colors.primary },
            engineSending && { opacity: 0.6 },
          ]}
        >
          <Ionicons name="logo-whatsapp" size={20} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 14, fontFamily: f.bold, color: colors.primary }}>
              {engineSending
                ? 'Sending from ConvoReal…'
                : recipientName
                  ? `Send to ${recipientName}`
                  : 'Send via ConvoReal WhatsApp'}
            </Text>
            <Text style={{ fontSize: 11.5, color: colors.textMuted }}>
              Delivers from your business number and logs to the chat thread
            </Text>
          </View>
          {engineSending ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Ionicons name="chevron-forward" size={16} color={colors.primary} />
          )}
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
          {recipientName
            ? `Both send to ${recipientName}. ConvoReal WhatsApp delivers from your business number and is tracked in the conversation thread; WhatsApp opens your own app and logs the share on their timeline.`
            : 'Sending via ConvoReal WhatsApp delivers from your business number and is tracked in the conversation thread. Pick a contact on WhatsApp to log the share on their timeline too.'}
        </Text>
      </ScrollView>

      <ContactPickerSheet
        visible={picker === 'external'}
        onClose={() => setPicker(null)}
        onSelect={shareExternalWithContact}
        title="Share on WhatsApp"
        hint="Pick a contact to open WhatsApp addressed to them and log the share on their timeline. WhatsApp opens one chat at a time — to reach several people at once, use Send via ConvoReal WhatsApp above."
        // Tapping leaves the share flow, so it closes the sheet rather
        // than stacking the composer behind it.
        nudge={{
          text: 'Sending to a whole list? A Broadcast reaches everyone in one campaign, with delivery tracking.',
          onPress: () => {
            setPicker(null);
            onClose();
            router.push('/(app)/broadcast-new');
          },
        }}
        skipLabel="Open WhatsApp without a contact"
        onSkip={shareExternalWithoutContact}
      />
      <ContactPickerSheet
        visible={picker === 'engine'}
        onClose={() => setPicker(null)}
        multiSelect
        confirmLabel="Send"
        onSelectMany={sendViaConvoRealMany}
        title="Send via ConvoReal WhatsApp"
        hint="Pick everyone who should receive this listing from your business number. Search again to add more — your picks are kept."
        busy={engineSending}
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
  engineButton: {
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
