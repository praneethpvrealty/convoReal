import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { fetchPropertyPage } from '@/app/(app)/(tabs)/properties';
import { AppDialog, useAppDialog } from '@/components/app-dialog';
import { ContactPickerSheet } from '@/components/contact-picker-sheet';
import { BottomSheet } from '@/components/sheet';
import {
  EmptyState,
  FilterChip,
  PrimaryButton,
  SearchBar,
  SectionLabel,
  TextField,
} from '@/components/ui';
import { apiFetch, sendTextMessage } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/lib/auth-store';
import { friendlyError } from '@/lib/errors';
import { formatInr } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { findContactThread } from '@/lib/open-chat';
import {
  anonymousShowcaseShareUrl,
  applyShowcaseScope,
  logShowcaseShare,
  type ShareCategory,
  type ShareScope,
  withShowcaseVisitor,
} from '@/lib/showcase-share';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { Contact, Property } from '@/lib/types';
import { useDebounced } from '@/lib/use-debounced';
import { getShowcaseUrl } from '@/lib/welcome-message';

interface EngineTemplate {
  name: string;
  language: string | null;
  status: string;
  buttons: { type: string; url?: string }[] | null;
}

interface PersonalizedShareSummary {
  summary: string;
  template_params: [string, string, string];
  match_count: number;
}

interface ShareSummaryData {
  summary: string;
  count: number;
  template_params: [string, string, string];
  personalized: Record<string, PersonalizedShareSummary>;
}

const MAX_PICKED = 25;
const CATEGORIES: ShareCategory[] = [
  'All',
  'Residential',
  'Commercial',
  'Agricultural',
];

const CLIENT_MESSAGE = `Hi! 👋

I've curated an exclusive property showcase just for you. Browse through handpicked listings and find the one that feels right.

Explore the showcase here:
{portalUrl}

Happy to help with details, a site visit, or the best price on any of them.`;

const BROKER_MESSAGE = `Hi! 🤝

Sharing our current inventory — the link opens the complete catalog with full specs, photos, and map locations, so you can evaluate and present to your clients directly:

{portalUrl}

Open to co-broking on all of these. Ping me for commission terms, documents, or site visits.`;

/**
 * The phone's half of the web share dialog (Who → What → How):
 * the audience decides how much a link reveals, one scope decides which
 * listings it opens, and the message and recipients follow from both.
 * Link building is `applyShowcaseScope`, the port of the web rule, so a
 * link built here opens exactly what the same choices open on desktop.
 */
export function ShowcaseShareSheet({
  visible,
  onClose,
  activeSearch = '',
}: {
  visible: boolean;
  onClose: () => void;
  /** The Properties tab's current query, offered as a share scope. */
  activeSearch?: string;
}) {
  const { colors, fonts: f } = useTheme();
  const { show, close, dialogProps } = useAppDialog();
  const trimmedSearch = activeSearch.trim();

  const [audience, setAudience] = useState<'client' | 'agent'>('client');
  const [scope, setScope] = useState<ShareScope>(
    trimmedSearch ? 'search' : 'all'
  );
  const [category, setCategory] = useState<ShareCategory>('All');
  const [picked, setPicked] = useState<Property[]>([]);
  const [pickerSearch, setPickerSearch] = useState('');
  const [clientMessage, setClientMessage] = useState(CLIENT_MESSAGE);
  const [brokerMessage, setBrokerMessage] = useState(BROKER_MESSAGE);
  const [recipients, setRecipients] = useState(false);
  const [sending, setSending] = useState(false);
  const [messageMode, setMessageMode] = useState<'pitch' | 'list'>('pitch');
  const [digestDraft, setDigestDraft] = useState<{
    base: string;
    text: string;
  } | null>(null);

  const pickedKeys = useMemo(
    () => picked.map((p) => p.property_code || p.id),
    [picked]
  );
  const pickedIds = pickedKeys.join(',');
  const debounced = useDebounced(pickerSearch.trim());
  const baseUrl = useQuery({
    queryKey: ['showcase-url'],
    enabled: visible,
    staleTime: 5 * 60_000,
    queryFn: getShowcaseUrl,
  });
  const properties = useQuery({
    queryKey: ['showcase-share-picker', debounced],
    enabled: visible && scope === 'pick',
    queryFn: () => fetchPropertyPage(0, debounced, 'All', null, false),
  });

  const pitch = audience === 'agent' ? brokerMessage : clientMessage;
  const setPitch = audience === 'agent' ? setBrokerMessage : setClientMessage;

  const link = useMemo(() => {
    if (!baseUrl.data) return '';
    return applyShowcaseScope(baseUrl.data, {
      scope,
      category,
      search: trimmedSearch,
      ids: pickedKeys,
      audience,
    });
  }, [baseUrl.data, scope, category, trimmedSearch, pickedKeys, audience]);

  // The digest is a business rule, so the phone asks the server for it
  // rather than carrying a second copy of the builder (AGENTS.md §2.8).
  const digest = useQuery({
    queryKey: [
      'inventory-share-summary',
      scope,
      category,
      trimmedSearch,
      pickedIds,
      link,
    ],
    // Fetched for both modes: the Engine send needs the template's body
    // params even when the agent is looking at the short pitch.
    enabled: visible && link.length > 0,
    queryFn: () =>
      apiFetch<{
        data: ShareSummaryData;
      }>(
        `/api/inventory/share-summary?${new URLSearchParams({
          scope,
          category,
          search: trimmedSearch,
          ids: pickedIds,
          portal_url: link,
        }).toString()}`
      ).then((response) => response.data),
  });

  // The Engine channel: the inventory_update template goes out from the
  // account's WhatsApp Business number, which reaches a contact whose
  // 24-hour window is shut — the free-form ConvoReal channel cannot.
  const accountId = useAuthStore((state) => state.profile?.account_id);
  const template = useQuery({
    queryKey: ['inventory-update-template', accountId],
    enabled: visible && Boolean(accountId),
    queryFn: async () => {
      const { data } = await supabase
        .from('message_templates')
        .select('name, language, status, buttons')
        .eq('account_id', accountId)
        .eq('name', 'inventory_update')
        .order('last_submitted_at', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      return (data ?? null) as EngineTemplate | null;
    },
  });
  const templateApproved = template.data?.status === 'APPROVED';

  // Manual edits survive until an input changes the generated text, the
  // same rule the web preview uses.
  const autoDigest = digest.data?.summary ?? '';
  const digestText =
    digestDraft?.base === autoDigest ? digestDraft.text : autoDigest;
  const hasCustomDigest = digestDraft?.base === autoDigest;
  const message = messageMode === 'list' ? digestText : pitch;

  const scopeLabel =
    scope === 'search'
      ? `your search “${trimmedSearch}”`
      : scope === 'pick'
        ? `${picked.length} hand-picked ${picked.length === 1 ? 'listing' : 'listings'}`
        : category === 'All'
          ? 'your whole showcase'
          : `${category} listings`;

  const ready = link.length > 0 && (scope !== 'pick' || picked.length > 0);

  /** The template's URL button appends this to the app origin, so the
   *  suffix must carry the scope as well as the contact. */
  function trackedQuery(contactId: string) {
    const tracked = withShowcaseVisitor(link, contactId);
    const query = tracked.slice(tracked.indexOf('?'));
    return tracked.includes('?') ? query : `?v=${contactId}`;
  }

  function messageFor(
    url: string,
    name?: string | null,
    sourceMessage = message
  ) {
    const greeting = name?.trim().split(/\s+/)[0];
    // The digest already carries the scoped link; swap it for the
    // recipient's tracked one rather than appending a second copy.
    const body =
      messageMode === 'list'
        ? sourceMessage.replaceAll(link, url)
        : sourceMessage.replaceAll('{portalUrl}', url);
    return greeting
      ? body
          .replace(/^Hi!/, `Hi ${greeting}!`)
          .replace('Hi there!', `Hi ${greeting}!`)
      : body;
  }

  async function loadShareSummaries(contactIds: string[]) {
    return apiFetch<{ data: ShareSummaryData }>(
      `/api/inventory/share-summary?${new URLSearchParams({
        scope,
        category,
        search: trimmedSearch,
        ids: pickedIds,
        portal_url: link,
        contact_ids: contactIds.join(','),
      }).toString()}`
    ).then((response) => response.data);
  }

  function closeSheet() {
    setPickerSearch('');
    setRecipients(false);
    onClose();
  }

  function togglePicked(property: Property) {
    haptic.tap();
    setPicked((current) => {
      if (current.some((item) => item.id === property.id)) {
        return current.filter((item) => item.id !== property.id);
      }
      if (current.length >= MAX_PICKED) {
        show({
          title: 'Selection limit',
          message: `Choose no more than ${MAX_PICKED} listings for one link.`,
          actions: [{ label: 'OK', variant: 'primary', onPress: close }],
        });
        return current;
      }
      return [...current, property];
    });
  }

  async function copyLink() {
    haptic.tap();
    await Clipboard.setStringAsync(link);
    show({
      title: 'Link copied',
      message: `It opens ${scopeLabel}.`,
      actions: [{ label: 'OK', variant: 'primary', onPress: close }],
    });
  }

  /** Untracked-by-name share for groups and status posts: the ?s= token
   *  still lets Pulse count the visits it brings in. */
  async function shareAnywhere() {
    haptic.tap();
    const anonymous = applyShowcaseScope(await anonymousShowcaseShareUrl(), {
      scope,
      category,
      search: trimmedSearch,
      ids: pickedKeys,
      audience,
    });
    await Share.share({ message: messageFor(anonymous), url: anonymous });
  }

  async function personalWhatsApp(contacts: Contact[]) {
    const [first, ...rest] = contacts.filter((c) => c.phone);
    if (!first) return;
    haptic.send();
    void logShowcaseShare(first);
    const url = withShowcaseVisitor(link, first.id);
    let personalized: PersonalizedShareSummary | undefined;
    if (messageMode === 'list' && !hasCustomDigest) {
      try {
        personalized = (await loadShareSummaries([first.id])).personalized[
          first.id
        ];
      } catch {
        // The generic digest is already loaded and remains safe to send.
      }
    }
    void Linking.openURL(
      `https://wa.me/${(first.phone ?? '').replace(/\D/g, '')}?text=${encodeURIComponent(messageFor(url, first.name, personalized?.summary))}`
    );
    if (rest.length > 0) {
      show({
        title: 'One chat at a time',
        message:
          'Personal WhatsApp opens a single chat. Use ConvoReal to reach everyone selected in one go.',
        actions: [{ label: 'OK', variant: 'primary', onPress: close }],
      });
    }
  }

  /** Business-number fan-out: each contact gets their own tracked link,
   *  and their own 24-hour-window verdict, so a closed window for one
   *  recipient is not reported as a failure for the rest. */
  async function sendViaConvoReal(contacts: Contact[]) {
    setSending(true);
    const failed: string[] = [];
    let sent = 0;
    let personalized: Record<string, PersonalizedShareSummary> = {};
    if (messageMode === 'list' && !hasCustomDigest) {
      try {
        personalized = (
          await loadShareSummaries(contacts.map((contact) => contact.id))
        ).personalized;
      } catch {
        // Continue with the generic digest rather than blocking the send.
      }
    }
    for (const contact of contacts) {
      try {
        const thread = await findContactThread(contact.id);
        if (!thread) {
          failed.push(contact.name || contact.phone || 'contact');
          continue;
        }
        const url = withShowcaseVisitor(link, contact.id);
        await sendTextMessage(
          thread,
          messageFor(url, contact.name, personalized[contact.id]?.summary)
        );
        sent += 1;
      } catch (error) {
        failed.push(
          `${contact.name || contact.phone}${
            error instanceof Error ? ` (${friendlyError(error.message)})` : ''
          }`
        );
      }
    }
    setSending(false);
    haptic[sent > 0 ? 'success' : 'warn']();
    show({
      title: sent > 0 ? `Sent to ${sent}` : 'Nothing sent',
      message:
        failed.length > 0
          ? `Could not reach: ${failed.join(', ')}. A contact with no open 24-hour window needs a template instead.`
          : `The showcase link went out from your business number — replies land in your Inbox.`,
      actions: [{ label: 'OK', variant: 'primary', onPress: close }],
    });
    if (sent > 0) closeSheet();
  }

  /** Template fan-out from the business number. Unlike the free-form
   *  channel this opens a conversation with a contact who has none, so
   *  it is the one path that reaches a shut 24-hour window. */
  async function sendViaEngine(contacts: Contact[]) {
    const engine = template.data;
    const fallbackParams = digest.data?.template_params;
    if (!engine || !fallbackParams) {
      show({
        title: 'Still preparing',
        message:
          'The inventory snapshot is still loading — try again in a moment.',
        actions: [{ label: 'OK', variant: 'primary', onPress: close }],
      });
      return;
    }
    setSending(true);
    const failed: string[] = [];
    let sent = 0;
    let summaries: ShareSummaryData | null = null;
    try {
      summaries = await loadShareSummaries(
        contacts.map((contact) => contact.id)
      );
    } catch {
      // Use the already-loaded generic parameters if ranking is unavailable.
    }
    for (const contact of contacts) {
      if (!contact.phone) {
        failed.push(contact.name || 'contact with no number');
        continue;
      }
      try {
        const params =
          summaries?.personalized[contact.id]?.template_params ??
          fallbackParams;
        // Dynamic URL-button suffix → a tracked, personalised open.
        const buttonParams: Record<number, string> = {};
        (engine.buttons ?? []).forEach((button, index) => {
          if (button.type === 'URL' && button.url?.includes('{{1}}')) {
            buttonParams[index] = trackedQuery(contact.id);
          }
        });
        const response = await apiFetch<{
          results?: { status?: string; error?: string }[];
        }>('/api/whatsapp/broadcast', {
          method: 'POST',
          body: JSON.stringify({
            recipients: [
              {
                phone: contact.phone,
                params: [
                  contact.name?.trim().split(/\s+/)[0] || 'there',
                  ...params,
                ],
                ...(Object.keys(buttonParams).length > 0
                  ? { messageParams: { buttonParams } }
                  : {}),
              },
            ],
            template_name: engine.name,
            template_language: engine.language || 'en_US',
          }),
        });
        const result = response.results?.[0];
        if (result?.status === 'failed') {
          throw new Error(result.error || 'Delivery failure');
        }
        sent += 1;
      } catch (error) {
        failed.push(
          `${contact.name || contact.phone}${
            error instanceof Error ? ` (${friendlyError(error.message)})` : ''
          }`
        );
      }
    }
    setSending(false);
    haptic[sent > 0 ? 'success' : 'warn']();
    show({
      title: sent > 0 ? `Sent to ${sent}` : 'Nothing sent',
      message:
        failed.length > 0
          ? `Could not reach: ${failed.join(', ')}.`
          : 'The inventory update went out from your business number — replies land in your Inbox.',
      actions: [{ label: 'OK', variant: 'primary', onPress: close }],
    });
    if (sent > 0) closeSheet();
  }

  /** One-time setup: the definition comes from the server so both
   *  surfaces register the same template under this reserved name. */
  async function submitTemplate() {
    setSending(true);
    try {
      const payload = await apiFetch<{ data: unknown }>(
        '/api/inventory/update-template'
      );
      await apiFetch('/api/whatsapp/templates/submit', {
        method: 'POST',
        body: JSON.stringify(payload.data),
      });
      await template.refetch();
      show({
        title: 'Template submitted',
        message:
          'Meta usually reviews it within minutes to a few hours. Engine sending unlocks automatically once approved.',
        actions: [{ label: 'OK', variant: 'primary', onPress: close }],
      });
    } catch (error) {
      show({
        title: 'Could not submit the template',
        message: friendlyError(
          error instanceof Error ? error.message : 'Please try again.'
        ),
        actions: [{ label: 'OK', variant: 'primary', onPress: close }],
      });
    } finally {
      setSending(false);
    }
  }

  function chooseChannel(contacts: Contact[]) {
    setRecipients(false);
    if (contacts.length === 0) return;
    show({
      title: `Send to ${contacts.length} ${contacts.length === 1 ? 'contact' : 'contacts'}`,
      message: templateApproved
        ? 'Engine sends the approved inventory update from your business number and reaches contacts whose 24-hour window has closed. ConvoReal sends this exact message into open threads only. WhatsApp opens one chat from your personal number.'
        : 'ConvoReal sends from your business number, so replies land in your Inbox. WhatsApp opens one chat from your personal number.',
      actions: [
        { label: 'Cancel', variant: 'muted', onPress: close },
        {
          label: 'WhatsApp',
          onPress: () => {
            close();
            void personalWhatsApp(contacts);
          },
        },
        {
          label: 'ConvoReal',
          variant: templateApproved ? undefined : 'primary',
          onPress: () => {
            close();
            void sendViaConvoReal(contacts);
          },
        },
        ...(templateApproved
          ? [
              {
                label: 'Engine',
                variant: 'primary' as const,
                onPress: () => {
                  close();
                  void sendViaEngine(contacts);
                },
              },
            ]
          : []),
      ],
    });
  }

  const rows = properties.data?.data ?? [];

  return (
    <BottomSheet visible={visible} onClose={closeSheet} title="Share showcase">
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          paddingBottom: spacing.lg,
          gap: spacing.md,
        }}
      >
        <SectionLabel text="1 · Who is it for" />
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <FilterChip
            label="Clients"
            active={audience === 'client'}
            onPress={() => setAudience('client')}
          />
          <FilterChip
            label="Co-brokers"
            active={audience === 'agent'}
            onPress={() => setAudience('agent')}
          />
        </View>
        <Text style={{ fontSize: 12, color: colors.textMuted, lineHeight: 17 }}>
          {audience === 'agent'
            ? 'Co-broker links open the complete catalog — full specs, photos and map, without inquiry forms.'
            : 'Client links open the teaser showcase — exact addresses stay masked until they inquire.'}
        </Text>

        <SectionLabel text="2 · What they see" />
        <View
          style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}
        >
          <FilterChip
            label="Whole showcase"
            active={scope === 'all'}
            onPress={() => setScope('all')}
          />
          {trimmedSearch ? (
            <FilterChip
              label="Search results"
              active={scope === 'search'}
              onPress={() => setScope('search')}
            />
          ) : null}
          <FilterChip
            label="Hand-picked"
            active={scope === 'pick'}
            onPress={() => setScope('pick')}
          />
        </View>

        {scope === 'all' ? (
          <View
            style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}
          >
            {CATEGORIES.map((value) => (
              <FilterChip
                key={value}
                label={value === 'All' ? 'All properties' : value}
                active={category === value}
                onPress={() => setCategory(value)}
              />
            ))}
          </View>
        ) : null}

        {scope === 'pick' ? (
          <View style={{ gap: spacing.sm }}>
            <SearchBar
              value={pickerSearch}
              onChangeText={setPickerSearch}
              placeholder="Search your published listings"
            />
            <View style={{ maxHeight: 260 }}>
              {properties.isPending ? (
                <View
                  style={{ paddingVertical: spacing.xl, alignItems: 'center' }}
                >
                  <ActivityIndicator color={colors.primary} />
                </View>
              ) : properties.isError ? (
                <Text style={{ fontSize: 12, color: colors.danger }}>
                  Could not load inventory — try again.
                </Text>
              ) : rows.length === 0 ? (
                <EmptyState
                  icon="home-outline"
                  title="No listings match"
                  subtitle="Try another search."
                />
              ) : (
                <ScrollView
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                  nestedScrollEnabled
                >
                  <View style={{ gap: spacing.sm }}>
                    {rows.map((property) => {
                      const checked = picked.some(
                        (item) => item.id === property.id
                      );
                      return (
                        <Pressable
                          key={property.id}
                          onPress={() => togglePicked(property)}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked }}
                          style={[
                            styles.row,
                            {
                              borderColor: checked
                                ? colors.primary
                                : colors.glassBorder,
                              backgroundColor: checked
                                ? colors.primarySoft
                                : colors.glass,
                            },
                          ]}
                        >
                          <Ionicons
                            name={checked ? 'checkbox' : 'square-outline'}
                            size={20}
                            color={checked ? colors.primary : colors.textFaint}
                          />
                          <View style={{ flex: 1 }}>
                            <Text
                              numberOfLines={1}
                              style={{
                                fontSize: 13.5,
                                fontFamily: f.bold,
                                color: colors.text,
                              }}
                            >
                              {property.title}
                            </Text>
                            <Text
                              numberOfLines={1}
                              style={{
                                fontSize: 11.5,
                                color: colors.textMuted,
                              }}
                            >
                              {[
                                property.location,
                                property.price
                                  ? formatInr(property.price)
                                  : null,
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </Text>
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                </ScrollView>
              )}
            </View>
          </View>
        ) : null}

        <Text style={{ fontSize: 12, color: colors.textMuted, lineHeight: 17 }}>
          This link opens{' '}
          <Text style={{ fontFamily: f.bold, color: colors.text }}>
            {scopeLabel}
          </Text>
          .
        </Text>

        <SectionLabel text="3 · How it goes out" />
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <FilterChip
            label="Short pitch"
            active={messageMode === 'pitch'}
            onPress={() => setMessageMode('pitch')}
          />
          <FilterChip
            label="Full list"
            active={messageMode === 'list'}
            onPress={() => setMessageMode('list')}
          />
        </View>
        {messageMode === 'list' && digest.isPending ? (
          <View style={{ paddingVertical: spacing.lg, alignItems: 'center' }}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : messageMode === 'list' && digest.isError ? (
          <Text style={{ fontSize: 12, color: colors.danger }}>
            Could not build the list — try again, or send the short pitch.
          </Text>
        ) : messageMode === 'list' && !digestText ? (
          <Text style={{ fontSize: 12, color: colors.textMuted }}>
            Nothing to list in this selection yet.
          </Text>
        ) : (
          <TextField
            value={message}
            onChangeText={(text) =>
              messageMode === 'list'
                ? setDigestDraft({ base: autoDigest, text })
                : setPitch(text)
            }
            multiline
            style={{ minHeight: messageMode === 'list' ? 180 : 120 }}
          />
        )}
        <Text style={{ fontSize: 11, color: colors.textFaint }}>
          {messageMode === 'list'
            ? `A WhatsApp-ready digest of the ${digest.data?.count ?? 0} listings this link opens, grouped by category.`
            : `{portalUrl} is replaced with the recipient's own tracked link, so their opens show by name in Pulse.`}
        </Text>

        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Pressable
            onPress={() => void copyLink()}
            disabled={!ready}
            accessibilityRole="button"
            accessibilityLabel="Copy showcase link"
            style={[
              styles.secondary,
              { borderColor: colors.glassBorder, opacity: ready ? 1 : 0.5 },
            ]}
          >
            <Ionicons name="link-outline" size={16} color={colors.text} />
            <Text
              style={{ fontSize: 13, fontFamily: f.bold, color: colors.text }}
            >
              Copy link
            </Text>
          </Pressable>
          <Pressable
            onPress={() => void shareAnywhere()}
            disabled={!ready}
            accessibilityRole="button"
            accessibilityLabel="Share showcase anywhere"
            style={[
              styles.secondary,
              { borderColor: colors.glassBorder, opacity: ready ? 1 : 0.5 },
            ]}
          >
            <Ionicons name="share-outline" size={16} color={colors.text} />
            <Text
              style={{ fontSize: 13, fontFamily: f.bold, color: colors.text }}
            >
              Share…
            </Text>
          </Pressable>
        </View>

        {template.data && !templateApproved ? (
          <View
            style={[
              styles.notice,
              {
                borderColor: colors.primary,
                backgroundColor: colors.primarySoft,
              },
            ]}
          >
            <Ionicons
              name="sparkles-outline"
              size={16}
              color={colors.primary}
            />
            <Text
              style={{
                flex: 1,
                fontSize: 11.5,
                color: colors.text,
                lineHeight: 16,
              }}
            >
              {template.data.status === 'PENDING'
                ? 'Inventory update template submitted — Engine sending unlocks once Meta approves it.'
                : `Meta rejected the inventory update template. Resubmit to send from your business number.`}
            </Text>
          </View>
        ) : null}
        {!template.isPending &&
        (!template.data || template.data.status === 'REJECTED') ? (
          <Pressable
            onPress={() => void submitTemplate()}
            disabled={sending}
            accessibilityRole="button"
            accessibilityLabel="Create and submit the inventory update template"
            style={[
              styles.secondary,
              { borderColor: colors.primary, opacity: sending ? 0.5 : 1 },
            ]}
          >
            <Ionicons name="send-outline" size={16} color={colors.primary} />
            <Text
              style={{
                fontSize: 13,
                fontFamily: f.bold,
                color: colors.primary,
              }}
            >
              {template.data ? 'Resubmit template' : 'Set up Engine sending'}
            </Text>
          </Pressable>
        ) : null}

        <PrimaryButton
          label="Send to contacts"
          icon="people-outline"
          busy={sending}
          disabled={!ready}
          onPress={() => {
            haptic.tap();
            setRecipients(true);
          }}
        />
      </ScrollView>

      <ContactPickerSheet
        visible={recipients}
        onClose={() => setRecipients(false)}
        onSelect={(contact) => chooseChannel([contact])}
        onSelectMany={chooseChannel}
        multiSelect
        confirmLabel="Choose channel"
        title="Send showcase to"
      />
      <AppDialog {...dialogProps} />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  secondary: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
  },
});
