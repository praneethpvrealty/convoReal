import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
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
import { supabase } from '@/lib/supabase';
import {
  fetchSharePropertyPreview,
  logExternalShare,
  sendPropertyViaEngine,
  sendPropertyViaEngineMany,
  type SharePropertyPreview,
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
import { storagePublicUrl } from '@/lib/storage-url';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { Contact, Property } from '@/lib/types';
import { contactHandle } from '@/lib/reachability';
import { rankContactSearchResults } from '@/lib/contact-search-rank';

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
 * `contacts` does the same for a set picked off the Matching Contacts
 * list, which the Engine channel then fans out to.
 */
export function PropertyShareSheet({
  property,
  visible,
  onClose,
  contact = null,
  contacts,
  onShared,
}: {
  property: Property;
  visible: boolean;
  onClose: () => void;
  /** Preselected recipient; when set, neither send path opens the picker. */
  contact?: Contact | null;
  /** Preselected recipients. Takes precedence over `contact`. */
  contacts?: Contact[];
  /** Fired with the recipients a share actually reached, so a caller
   *  showing per-contact share state can refresh it. */
  onShared?: (contactIds: string[]) => void;
}) {
  const { colors, fonts: f } = useTheme();
  const session = useAuthStore((s) => s.session);
  const fullName = useAuthStore((s) => s.profile?.full_name);
  const [audience, setAudience] = useState<ShareAudience>('client');
  const [tone, setTone] = useState<ShareTone>('professional');
  const [detail, setDetail] = useState<ShareDetailLevel>('standard');
  const [offerInventoryOnboarding, setOfferInventoryOnboarding] =
    useState(false);
  const [message, setMessage] = useState('');
  const [copied, setCopied] = useState<'link' | 'message' | null>(null);
  const [picker, setPicker] = useState<
    'external' | 'engine' | 'inventory' | null
  >(null);
  const [engineSending, setEngineSending] = useState(false);
  const [engineProgress, setEngineProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [inventorySharing, setInventorySharing] = useState(false);
  const [headerImage, setHeaderImage] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{
    title: string;
    message?: string;
    actions: DialogAction[];
  } | null>(null);

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
    offerInventoryOnboarding,
  });

  // Sign the message with the account's own name (Settings → profile),
  // reactive via the auth store, and fall back to the email handle only
  // until a name is set.
  const emailName = (session?.user.email?.split('@')[0] ?? '').split(
    /[._-]/
  )[0];
  const agentName =
    fullName?.trim() ||
    (emailName
      ? emailName.charAt(0).toUpperCase() + emailName.slice(1)
      : undefined);
  const agentPhone = session?.user.phone
    ? `+${session.user.phone.replace(/^\+/, '')}`
    : undefined;

  const generated = useMemo(() => {
    const base = buildPropertyShareMessage({
      property,
      url,
      audience,
      detail,
      tone,
      agentName,
      agentPhone,
    });
    return offerInventoryOnboarding && audience === 'agent'
      ? `${base}\n\n♻️ Want to share this with your own name or agency? Open the property and tap “Request ConvoReal invite”. Once onboarded, it will be added to your inventory for review.`
      : base;
  }, [
    property,
    url,
    audience,
    detail,
    tone,
    agentName,
    agentPhone,
    offerInventoryOnboarding,
  ]);

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
  // share on their Engine timeline.
  async function shareExternalWithContact(contact: Contact) {
    setPicker(null);
    haptic.send();
    void logExternalShare(contact, property);
    const phone = (contact.phone ?? '').replace(/\D/g, '');
    const trackedUrl = propertyShareUrl({
      siteUrl: ENV.apiBaseUrl,
      subdomain: subdomain.data ?? null,
      accountId,
      property,
      audience,
      offerInventoryOnboarding,
      recipientId: contact.id,
    });
    const linked = message.includes(url)
      ? message.split(url).join(trackedUrl)
      : `${message}\n\n📸 Photos & full details:\n${trackedUrl}`;
    const text = addRecipientGreeting(linked, contact.name);
    Linking.openURL(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`);
    onShared?.([contact.id]);
    onClose();
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
      addRecipientGreeting(message, contact.name),
      leadImage
    );
    setEngineSending(false);
    setPicker(null);
    if (outcome.sent) {
      haptic.success();
      onShared?.([contact.id]);
      onClose();
      if (outcome.conversationId)
        router.push(`/(app)/conversation/${outcome.conversationId}`);
      return;
    }
    if (outcome.templateStatus) {
      haptic.warn();
      const convId = outcome.conversationId;
      const pending = outcome.templateStatus === 'PENDING';
      setDialog({
        title: pending
          ? 'Template awaiting Meta approval'
          : 'One-time template setup needed',
        message: pending
          ? `${contact.name || contact.phone} hasn’t messaged in the last 24 hours, so this share needs the approved property template — it’s still under review by Meta (usually minutes to a few hours). Try again once it’s approved, or open the chat to send another approved template.`
          : `${contact.name || contact.phone} hasn’t messaged in the last 24 hours, so WhatsApp requires a pre-approved template. An Org Manager can set up the property template once from Radar on the ConvoReal web app — after Meta approves it, shares like this go out automatically. For now, open the chat to send an approved template.`,
        actions: [
          {
            label: 'Not now',
            variant: 'muted',
            onPress: () => setDialog(null),
          },
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
      title: outcome.timedOut ? 'Still sending' : 'Could not send',
      message: outcome.timedOut
        ? 'WhatsApp is taking longer than usual to answer. The message may still go out — open the chat in a moment to check before sending it again.'
        : (outcome.error ?? 'Please try again.'),
      actions: [
        { label: 'OK', variant: 'primary', onPress: () => setDialog(null) },
      ],
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
    setEngineProgress({ done: 0, total: contacts.length });
    haptic.send();
    const outcomes = await sendPropertyViaEngineMany(
      contacts,
      property,
      (c) => addRecipientGreeting(message, c.name),
      (done, total) => setEngineProgress({ done, total }),
      leadImage
    );
    const blocked: string[] = [];
    const failed: string[] = [];
    const pending: string[] = [];
    const reached: string[] = [];
    for (const c of contacts) {
      const outcome = outcomes.get(c.id);
      if (outcome?.sent) {
        reached.push(c.id);
      } else if (outcome?.templateStatus) {
        blocked.push(c.name || contactHandle(c));
      } else if (outcome?.timedOut) {
        pending.push(c.name || contactHandle(c));
      } else {
        failed.push(c.name || contactHandle(c));
      }
    }
    const sent = reached.length;
    setEngineSending(false);
    setEngineProgress(null);
    setPicker(null);
    // Report the partial set too — the ones that did land are already
    // on the ledger and must show as shared.
    if (sent > 0) onShared?.(reached);

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
        pending.length
          ? `Still sending — WhatsApp hasn't answered yet, so these may still go out. Check the chats before resending: ${pending.join(', ')}.`
          : null,
        failed.length ? `Could not send to: ${failed.join(', ')}.` : null,
      ]
        .filter(Boolean)
        .join('\n\n'),
      actions: [
        { label: 'OK', variant: 'primary', onPress: () => setDialog(null) },
      ],
    });
  }

  async function shareToInventoryMany(agentContacts: Contact[]) {
    if (agentContacts.length === 0) return;
    setInventorySharing(true);
    haptic.send();
    const shared: string[] = [];
    const failed: string[] = [];
    for (const agentContact of agentContacts) {
      try {
        await apiFetch(
          `/api/properties/${property.id}/share-to-agent-account`,
          {
            method: 'POST',
            body: JSON.stringify({ contact_id: agentContact.id }),
          }
        );
        shared.push(agentContact.name || contactHandle(agentContact));
      } catch (error) {
        failed.push(
          `${agentContact.name || contactHandle(agentContact)}: ${
            error instanceof Error ? error.message : 'failed'
          }`
        );
      }
    }
    setInventorySharing(false);
    setPicker(null);
    if (shared.length > 0) haptic.success();
    else haptic.warn();
    setDialog({
      title:
        failed.length === 0
          ? 'Sent for inventory review'
          : `Shared with ${shared.length} of ${agentContacts.length}`,
      message: [
        shared.length > 0
          ? `${shared.join(', ')} will see this under Listings to review. It enters inventory only after approval.`
          : null,
        failed.length > 0 ? failed.join('\n') : null,
      ]
        .filter(Boolean)
        .join('\n\n'),
      actions: [
        {
          label: 'OK',
          variant: 'primary',
          onPress: () => {
            setDialog(null);
            if (failed.length === 0) onClose();
          },
        },
      ],
    });
  }

  async function searchAgentContacts(query: string): Promise<Contact[]> {
    const term = `%${query}%`;
    const digits = query.replace(/\D/g, '');
    const or =
      digits.length >= 4
        ? `name.ilike.${term},name_tag.ilike.${term},phone.ilike.%${digits}%`
        : `name.ilike.${term},name_tag.ilike.${term}`;
    const columns = 'id, name, name_tag, phone, classification';
    const [exactResult, broadResult] = await Promise.all([
      supabase
        .from('contacts')
        .select(columns)
        .eq('classification', 'Agent')
        .eq('is_merged', false)
        .ilike('name', query)
        .limit(8),
      supabase
        .from('contacts')
        .select(columns)
        .eq('classification', 'Agent')
        .eq('is_merged', false)
        .or(or)
        .limit(50),
    ]);
    if (exactResult.error) throw exactResult.error;
    if (broadResult.error) throw broadResult.error;
    return rankContactSearchResults(
      [...(exactResult.data ?? []), ...(broadResult.data ?? [])] as Contact[],
      query,
      8
    );
  }

  // One list for both props: a single preselected contact is just a
  // one-recipient set, so every send path below reads `recipients` and
  // only falls back to the picker when nothing was preselected.
  const recipients = useMemo(
    () => (contacts?.length ? contacts : contact ? [contact] : []),
    [contacts, contact]
  );
  const recipientName =
    recipients.length === 0
      ? null
      : recipients.length === 1
        ? recipients[0].name || contactHandle(recipients[0])
        : `${recipients.length} contacts`;

  // What lands for a recipient outside the 24-hour window: the server's
  // own template pick, rendered with the same params it will send, so
  // the agent sees the real message rather than the draft above.
  const firstRecipientId = recipients[0]?.id ?? null;
  const enginePreview = useQuery({
    queryKey: ['share-property-preview', property.id, firstRecipientId],
    queryFn: () => fetchSharePropertyPreview(property.id, firstRecipientId),
    enabled: visible,
    staleTime: 60_000,
  });
  const previewImages = enginePreview.data?.images ?? [];
  const leadImage =
    headerImage && previewImages.includes(headerImage)
      ? headerImage
      : (previewImages[0] ?? null);

  const channels = [
    {
      key: 'whatsapp',
      icon: 'logo-whatsapp' as const,
      label: 'WhatsApp',
      color: colors.success,
      // WhatsApp's own deep link opens one chat, so a multi-recipient
      // share falls back to the picker here rather than pretending it
      // can address the whole set at once.
      onPress: () =>
        recipients.length === 1
          ? void shareExternalWithContact(recipients[0])
          : setPicker('external'),
    },
    {
      key: 'telegram',
      icon: 'paper-plane' as const,
      label: 'Telegram',
      color: colors.readTick,
      onPress: () => Linking.openURL(targets.telegram),
    },
    {
      key: 'email',
      icon: 'mail-outline' as const,
      label: 'Email',
      color: colors.primary,
      onPress: () => Linking.openURL(targets.email),
    },
    {
      key: 'sms',
      icon: 'chatbox-outline' as const,
      label: 'SMS',
      color: colors.primary,
      onPress: () => Linking.openURL(targets.sms),
    },
    {
      key: 'copy',
      icon: (copied === 'message' ? 'checkmark' : 'copy-outline') as
        'checkmark' | 'copy-outline',
      label: copied === 'message' ? 'Copied!' : 'Copy message',
      color: colors.primary,
      onPress: () => copy('message'),
    },
  ];

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Share property">
      <ScrollView
        style={sheetScrollArea}
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          gap: spacing.md,
          paddingBottom: spacing.sm,
        }}
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
            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                gap: spacing.sm,
              }}
            >
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

        {audience === 'agent' ? (
          <Pressable
            onPress={() => setOfferInventoryOnboarding((value) => !value)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: offerInventoryOnboarding }}
            style={[
              styles.notice,
              {
                borderColor: offerInventoryOnboarding
                  ? colors.primary
                  : colors.border,
                backgroundColor: offerInventoryOnboarding
                  ? colors.primarySoft
                  : colors.surfaceSunken,
              },
            ]}
          >
            <Ionicons
              name={offerInventoryOnboarding ? 'checkbox' : 'square-outline'}
              size={20}
              color={
                offerInventoryOnboarding ? colors.primary : colors.textMuted
              }
            />
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  fontSize: 12.5,
                  fontFamily: f.bold,
                  color: colors.text,
                }}
              >
                Let them add and re-share this listing
              </Text>
              <Text
                style={{
                  marginTop: 2,
                  fontSize: 11.5,
                  lineHeight: 16,
                  color: colors.textMuted,
                }}
              >
                Adds a ConvoReal invite request. Joining with the same WhatsApp
                number places this listing in Pending Review with your
                attribution.
              </Text>
            </View>
          </Pressable>
        ) : null}

        <SectionLabel text="Message — tap to edit" />
        <TextInput
          multiline
          scrollEnabled={false}
          value={message}
          onChangeText={setMessage}
          accessibilityLabel="Share message"
          style={[
            styles.draft,
            {
              backgroundColor: colors.surfaceRaised,
              borderColor: colors.border,
              color: colors.text,
            },
          ]}
        />

        <Pressable
          onPress={() => copy('link')}
          accessibilityRole="button"
          accessibilityLabel="Copy link"
          style={[styles.linkRow, { backgroundColor: colors.surfaceSunken }]}
        >
          <Text
            style={{ flex: 1, fontSize: 12, color: colors.textMuted }}
            numberOfLines={1}
          >
            {url}
          </Text>
          <Ionicons
            name={copied === 'link' ? 'checkmark' : 'copy-outline'}
            size={15}
            color={copied === 'link' ? colors.success : colors.primary}
          />
        </Pressable>

        {audience === 'agent' ? (
          <Pressable
            disabled={inventorySharing}
            onPress={() => {
              const agents = recipients.filter(
                (row) => row.classification === 'Agent'
              );
              if (agents.length > 0) void shareToInventoryMany(agents);
              else setPicker('inventory');
            }}
            accessibilityRole="button"
            accessibilityState={{
              disabled: inventorySharing,
              busy: inventorySharing,
            }}
            accessibilityLabel="Share to a ConvoReal agent inventory"
            style={[
              styles.engineButton,
              {
                backgroundColor: colors.primarySoft,
                borderColor: colors.primary,
              },
              inventorySharing && { opacity: 0.6 },
            ]}
          >
            <Ionicons
              name="folder-open-outline"
              size={20}
              color={colors.primary}
            />
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  fontSize: 14,
                  fontFamily: f.bold,
                  color: colors.primary,
                }}
              >
                {inventorySharing
                  ? 'Sharing to inventory…'
                  : 'Share to agent inventory'}
              </Text>
              <Text style={{ fontSize: 11.5, color: colors.textMuted }}>
                Sends to their review queue; approval adds the attributed
                listing
              </Text>
            </View>
            {inventorySharing ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Ionicons
                name="chevron-forward"
                size={16}
                color={colors.primary}
              />
            )}
          </Pressable>
        ) : null}

        <SectionLabel text="Send from ConvoReal" />
        <EngineTemplateCard
          preview={enginePreview.data ?? null}
          loading={enginePreview.isPending}
          headerImage={leadImage}
          onPickImage={setHeaderImage}
        />
        <Pressable
          disabled={engineSending}
          onPress={() =>
            recipients.length
              ? void sendViaConvoRealMany(recipients)
              : setPicker('engine')
          }
          accessibilityRole="button"
          accessibilityState={{ disabled: engineSending, busy: engineSending }}
          accessibilityLabel={
            recipientName
              ? `Send via ConvoReal WhatsApp to ${recipientName}`
              : 'Send via ConvoReal WhatsApp'
          }
          style={[
            styles.engineButton,
            {
              backgroundColor: colors.primarySoft,
              borderColor: colors.primary,
            },
            engineSending && { opacity: 0.6 },
          ]}
        >
          <Ionicons name="logo-whatsapp" size={20} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text
              style={{
                fontSize: 14,
                fontFamily: f.bold,
                color: colors.primary,
              }}
            >
              {engineSending
                ? engineProgress && engineProgress.total > 1
                  ? `Sending ${engineProgress.done} of ${engineProgress.total}…`
                  : 'Sending from ConvoReal…'
                : recipientName
                  ? `Send to ${recipientName}`
                  : 'Broadcast this property'}
            </Text>
            <Text style={{ fontSize: 11.5, color: colors.textMuted }}>
              Choose buyers; ConvoReal uses the approved property message
              automatically
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
              style={[
                styles.channel,
                {
                  backgroundColor: colors.glass,
                  borderColor: colors.glassBorder,
                },
              ]}
            >
              <Ionicons name={c.icon} size={17} color={c.color} />
              <Text
                style={{
                  fontSize: 13,
                  fontFamily: f.semibold,
                  color: colors.text,
                }}
              >
                {c.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text
          style={{
            fontSize: 11.5,
            color: colors.textFaint,
            textAlign: 'center',
          }}
        >
          {recipients.length > 1
            ? `Send from ConvoReal reaches all ${recipients.length} from your business number, each with their own greeting and their own 24-hour-window check. WhatsApp opens one chat at a time, so it asks who first.`
            : recipientName
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
        // Keep the property draft in this sheet and switch directly to
        // the multi-recipient Engine picker.
        nudge={{
          text: 'Send this property to several buyers from your business number. ConvoReal chooses the approved property message automatically.',
          onPress: () => setPicker('engine'),
        }}
      />
      <ContactPickerSheet
        visible={picker === 'engine'}
        onClose={() => setPicker(null)}
        multiSelect
        confirmLabel="Broadcast"
        onSelectMany={sendViaConvoRealMany}
        title="Broadcast this property"
        hint="Choose the buyers who should receive this listing. The property stays attached and ConvoReal handles the approved WhatsApp template automatically. Search again to add more — your picks are kept."
        busy={engineSending}
        busyLabel="Sending from ConvoReal…"
      />
      <ContactPickerSheet
        visible={picker === 'inventory'}
        onClose={() => setPicker(null)}
        multiSelect
        confirmLabel="Send for review"
        onSelectMany={shareToInventoryMany}
        title="Share to agent inventory"
        hint="Choose registered agent contacts. Each listing enters their ConvoReal review queue and is added only after approval."
        busy={inventorySharing}
        busyLabel="Sharing to inventory…"
        searchContacts={searchAgentContacts}
        searchKey="agent-inventory-share"
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

function EngineTemplateCard({
  preview,
  loading,
  headerImage,
  onPickImage,
}: {
  preview: SharePropertyPreview | null;
  loading: boolean;
  headerImage: string | null;
  onPickImage: (image: string) => void;
}) {
  const { colors, fonts: f } = useTheme();
  const [expanded, setExpanded] = useState(false);
  if (loading) {
    return (
      <View
        style={[
          styles.templateCard,
          { backgroundColor: colors.surfaceSunken, borderColor: colors.border },
        ]}
      >
        <ActivityIndicator size="small" color={colors.primary} />
        <Text style={{ fontSize: 12, color: colors.textMuted }}>
          Checking the listing template…
        </Text>
      </View>
    );
  }
  if (!preview) return null;
  if (!preview.template) {
    return (
      <View
        style={[
          styles.templateCard,
          { backgroundColor: colors.surfaceSunken, borderColor: colors.border },
        ]}
      >
        <Ionicons name="alert-circle-outline" size={18} color={colors.warning} />
        <Text
          style={{
            flex: 1,
            fontSize: 12,
            lineHeight: 17,
            color: colors.textMuted,
          }}
        >
          Contacts who messaged you in the last 24 hours get your message
          above. {preview.unsent_reason}, so everyone else cannot be reached
          from ConvoReal yet.
        </Text>
      </View>
    );
  }
  const showPhotos = preview.images.length > 0;
  return (
    <View
      style={[
        styles.templateBlock,
        { backgroundColor: colors.surfaceSunken, borderColor: colors.border },
      ]}
    >
      <Text style={{ fontSize: 13.5, fontFamily: f.bold, color: colors.text }}>
        {preview.template.label}
      </Text>
      <Text style={{ fontSize: 11.5, lineHeight: 16, color: colors.textMuted }}>
        Contacts who messaged you in the last 24 hours get your message above
        with the photo. Everyone else can only receive an approved WhatsApp
        template, so this one goes out with their name, the listing, the price
        and the map filled in.
      </Text>
      {showPhotos ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: spacing.sm }}
        >
          {preview.images.map((image, index) => {
            const selected = headerImage === image;
            return (
              <Pressable
                key={image}
                onPress={() => onPickImage(image)}
                accessibilityRole="button"
                accessibilityLabel={`Lead with photo ${index + 1}`}
                accessibilityState={{ selected }}
                style={[
                  styles.templatePhoto,
                  {
                    borderColor: selected ? colors.primary : colors.border,
                    borderWidth: selected ? 2 : StyleSheet.hairlineWidth,
                  },
                ]}
              >
                <Image
                  source={{ uri: storagePublicUrl(image) }}
                  style={{ width: '100%', height: '100%' }}
                  resizeMode="cover"
                />
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}
      {preview.preview ? (
        <Pressable
          onPress={() => setExpanded((value) => !value)}
          accessibilityRole="button"
          accessibilityLabel={
            expanded ? 'Collapse the template preview' : 'Expand the template preview'
          }
        >
          <Text
            numberOfLines={expanded ? undefined : 5}
            style={{
              fontSize: 12.5,
              lineHeight: 18,
              color: colors.text,
            }}
          >
            {preview.preview}
          </Text>
          <Text
            style={{
              marginTop: 4,
              fontSize: 11,
              fontFamily: f.semibold,
              color: colors.primary,
            }}
          >
            {expanded ? 'Show less' : 'Show the full message'}
          </Text>
        </Pressable>
      ) : null}
    </View>
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
      <Text
        style={{
          fontSize: 14,
          fontFamily: f.bold,
          color: active ? colors.primary : colors.text,
        }}
      >
        {title}
      </Text>
      <Text style={{ fontSize: 11.5, color: colors.textMuted }}>
        {subtitle}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.md,
  },
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
  templateCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
  },
  templateBlock: {
    gap: spacing.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
  },
  templatePhoto: {
    width: 56,
    height: 56,
    borderRadius: radius.sm,
    overflow: 'hidden',
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
