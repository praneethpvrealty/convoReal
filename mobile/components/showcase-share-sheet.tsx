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
import { sendTextMessage } from '@/lib/api';
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

  const message = audience === 'agent' ? brokerMessage : clientMessage;
  const setMessage = audience === 'agent' ? setBrokerMessage : setClientMessage;

  const link = useMemo(() => {
    if (!baseUrl.data) return '';
    return applyShowcaseScope(baseUrl.data, {
      scope,
      category,
      search: trimmedSearch,
      ids: picked.map((p) => p.property_code || p.id),
      audience,
    });
  }, [baseUrl.data, scope, category, trimmedSearch, picked, audience]);

  const scopeLabel =
    scope === 'search'
      ? `your search “${trimmedSearch}”`
      : scope === 'pick'
        ? `${picked.length} hand-picked ${picked.length === 1 ? 'listing' : 'listings'}`
        : category === 'All'
          ? 'your whole showcase'
          : `${category} listings`;

  const ready = link.length > 0 && (scope !== 'pick' || picked.length > 0);

  function messageFor(url: string, name?: string | null) {
    const greeting = name?.trim().split(/\s+/)[0];
    const body = message.replaceAll('{portalUrl}', url);
    return greeting ? body.replace(/^Hi!/, `Hi ${greeting}!`) : body;
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
      ids: picked.map((p) => p.property_code || p.id),
      audience,
    });
    await Share.share({ message: messageFor(anonymous), url: anonymous });
  }

  function personalWhatsApp(contacts: Contact[]) {
    const [first, ...rest] = contacts.filter((c) => c.phone);
    if (!first) return;
    haptic.send();
    void logShowcaseShare(first);
    const url = withShowcaseVisitor(link, first.id);
    void Linking.openURL(
      `https://wa.me/${(first.phone ?? '').replace(/\D/g, '')}?text=${encodeURIComponent(messageFor(url, first.name))}`
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
    for (const contact of contacts) {
      try {
        const thread = await findContactThread(contact.id);
        if (!thread) {
          failed.push(contact.name || contact.phone || 'contact');
          continue;
        }
        const url = withShowcaseVisitor(link, contact.id);
        await sendTextMessage(thread, messageFor(url, contact.name));
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

  function chooseChannel(contacts: Contact[]) {
    setRecipients(false);
    if (contacts.length === 0) return;
    show({
      title: `Send to ${contacts.length} ${contacts.length === 1 ? 'contact' : 'contacts'}`,
      message:
        'ConvoReal sends from your business number, so replies land in your Inbox. WhatsApp opens one chat from your personal number.',
      actions: [
        { label: 'Cancel', variant: 'muted', onPress: close },
        {
          label: 'WhatsApp',
          onPress: () => {
            close();
            personalWhatsApp(contacts);
          },
        },
        {
          label: 'ConvoReal',
          variant: 'primary',
          onPress: () => {
            close();
            void sendViaConvoReal(contacts);
          },
        },
      ],
    });
  }

  const rows = properties.data?.data ?? [];

  return (
    <BottomSheet
      visible={visible}
      onClose={closeSheet}
      title="Share showcase"
    >
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
        <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
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
                <View style={{ paddingVertical: spacing.xl, alignItems: 'center' }}>
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
                              style={{ fontSize: 11.5, color: colors.textMuted }}
                            >
                              {[
                                property.location,
                                property.price ? formatInr(property.price) : null,
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
        <TextField
          value={message}
          onChangeText={setMessage}
          multiline
          style={{ minHeight: 120 }}
        />
        <Text style={{ fontSize: 11, color: colors.textFaint }}>
          {'{portalUrl}'} is replaced with the recipient&apos;s own tracked
          link, so their opens show by name in Pulse.
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
            <Text style={{ fontSize: 13, fontFamily: f.bold, color: colors.text }}>
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
            <Text style={{ fontSize: 13, fontFamily: f.bold, color: colors.text }}>
              Share…
            </Text>
          </Pressable>
        </View>

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
