import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  AgentNotes,
  AgentProperties,
  AgentSchedule,
  ContactTags,
  InterestedProperties,
  PropertyPicker,
} from '@/components/agent-detail';
import { AppDialog, useAppDialog } from '@/components/app-dialog';
import {
  ApproveCelebration,
  type ApproveCelebrationState,
} from '@/components/approve-celebration';
import { AreasOfInterestInput } from '@/components/areas-of-interest-input';
import { ConvoRealLoader } from '@/components/loader';
import { MoveToEngineSheet } from '@/components/move-to-engine-sheet';
import { OwnerDetailsRequestSheet } from '@/components/owner-details-request-sheet';
import { PulseRing } from '@/components/motion';
import {
  Avatar,
  Banner,
  PrimaryButton,
  SectionLabel,
  Tag,
  TextField,
} from '@/components/ui';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { useCallLog } from '@/lib/use-call-log';
import {
  approveAndSendDetails,
  type ApproveOutcome,
} from '@/lib/approve-contact';
import { contactFullName } from '@/lib/contact-name';
import { storagePublicUrl } from '@/lib/storage-url';
import { cleanPhoneInput, formatBudgetRange, formatInr } from '@/lib/format';
import { friendlyError } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { queryClient } from '@/lib/query';
import { supabase } from '@/lib/supabase';
import {
  classificationColors,
  radius,
  spacing,
  useTheme,
  fonts,
} from '@/lib/theme';
import { openWelcomeWhatsApp } from '@/lib/welcome-message';
import { contactHandle, hasPhone } from '@/lib/reachability';
import {
  CLASSIFICATIONS,
  type AreaOfInterestGeo,
  type Classification,
  type Contact,
  type Property,
} from '@/lib/types';

// Mirrors src/lib/property-interests.ts on the web — the same strings
// land in contacts.property_interests and are read by the shared
// matching engine, so the two lists must not drift.
const PROPERTY_INTEREST_OPTIONS = [
  'Flat/ Apartment',
  'Villa',
  'Residential House',
  'Residential Land/ Plot',
  'Commercial Office Space',
  'Commercial Shop',
  'Agricultural Land',
  'Vacant plot',
  'Vacant building',
  'Rental building with some ROI',
  'Old building selling at site rate',
  'Builder Floor Apartment',
  'Penthouse',
  'Studio Apartment',
  'Residential Plot',
  'Residential Land',
  'Residential PG building',
  'PG/ Hostel',
  'Farm House',
  'Office in IT Park/ SEZ',
  'Commercial Showroom',
  'Commercial Building',
  'Commercial Land',
  'Warehouse/ Godown',
  'Industrial Land',
  'Industrial Building',
  'Industrial Shed',
];

/** Who gets the budget/areas/interests block. An agent's own brief is
 *  free text in Requirements — they aren't shopping to a budget. */
const BUYER_PREF_CLASSIFICATIONS: Classification[] = ['Buyer', 'Owner & Buyer'];

type UpdateChannelValue = 'whatsapp_text' | 'whatsapp_audio' | 'voice_call';
const UPDATE_CHANNEL_OPTIONS: { value: UpdateChannelValue; label: string }[] = [
  { value: 'whatsapp_text', label: '💬 Text' },
  { value: 'whatsapp_audio', label: '🎙️ Voice note' },
  { value: 'voice_call', label: '📞 Call' },
];

function parseAmount(s: string): number | null {
  const n = Number(s.replace(/[^\d.]/g, ''));
  return s.trim() && !Number.isNaN(n) && n > 0 ? n : null;
}

async function fetchContact(id: string): Promise<Contact | null> {
  const { data, error } = await supabase
    .from('contacts')
    .select(
      'id, phone, secondary_phones, name, name_tag, email, company, classification, ' +
        'avatar_url, min_budget, max_budget, no_budget, areas_of_interest, areas_of_interest_geo, ' +
        'strict_area_match, min_roi, requirements, lead_temp, status, referrer, source, ' +
        'preferred_update_channel, ' +
        'property_interests, last_inquired_property_id, lead_portal, lead_portal_listing_id, ' +
        'is_favorite, user_id'
    )
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data as Contact | null;
}

export default function ContactDetailScreen() {
  const { colors, fonts: f } = useTheme();
  // `edit=1` opens straight in the editor — the phone import lands here
  // so a freshly created contact can be filled in without a second tap.
  const { id, edit } = useLocalSearchParams<{ id: string; edit?: string }>();
  const [editing, setEditing] = useState(edit === '1');

  const { data: contact, isLoading } = useQuery({
    queryKey: ['contact', id],
    queryFn: () => fetchContact(id),
    enabled: Boolean(id),
    // Keep the previous contact (and the agent strip) rendered while
    // the switcher swaps the route param.
    placeholderData: (prev: Contact | null | undefined) => prev,
  });

  // Agent switcher strip: from one agent's screen, hop straight to
  // another agent without going back through the contacts list.
  const isAgent = contact?.classification === 'Agent';
  const { data: agentPeers } = useQuery({
    queryKey: ['agent-peers'],
    enabled: isAgent,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contacts')
        .select('id, name, phone')
        .eq('classification', 'Agent')
        .eq('is_merged', false)
        .order('name');
      if (error) throw error;
      return (data ?? []) as Pick<Contact, 'id' | 'name' | 'phone'>[];
    },
  });

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          headerShown: true,
          title:
            (contact ? contactFullName(contact) : '') ||
            contact?.phone ||
            'Contact',
          headerRight: () =>
            contact ? (
              <Pressable onPress={() => setEditing((e) => !e)} hitSlop={8}>
                <Text
                  style={{
                    color: colors.primary,
                    fontSize: 15.5,
                    fontFamily: f.bold,
                  }}
                >
                  {editing ? 'Cancel' : 'Edit'}
                </Text>
              </Pressable>
            ) : null,
        }}
      />
      {isLoading || !contact ? (
        <View
          style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
        >
          <ConvoRealLoader />
        </View>
      ) : (
        <>
          {!editing && isAgent && (agentPeers?.length ?? 0) > 1 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ flexGrow: 0 }}
              contentContainerStyle={styles.agentStrip}
            >
              {agentPeers!.map((a) => {
                const active = a.id === contact.id;
                return (
                  <Pressable
                    key={a.id}
                    onPress={() => {
                      if (!active) router.setParams({ id: a.id });
                    }}
                    style={[
                      styles.agentChip,
                      {
                        backgroundColor: active
                          ? colors.primarySoft
                          : colors.glass,
                        borderColor: active
                          ? colors.primary
                          : colors.glassBorder,
                      },
                    ]}
                  >
                    <Avatar name={a.name || contactHandle(a)} size={20} />
                    <Text
                      style={{
                        fontSize: 12,
                        fontFamily: f.semibold,
                        color: active ? colors.primary : colors.textMuted,
                      }}
                    >
                      {(a.name || contactHandle(a)).split(' ')[0]}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}
          {editing ? (
            <ContactEditor contact={contact} onDone={() => setEditing(false)} />
          ) : (
            <ContactCard contact={contact} />
          )}
        </>
      )}
    </View>
  );
}

function ContactCard({ contact }: { contact: Contact }) {
  const { colors, dark, fonts: f } = useTheme();
  const [celebration, setCelebration] =
    useState<ApproveCelebrationState | null>(null);
  const [moveToEngineOpen, setMoveToEngineOpen] = useState(false);
  const [detailsRequestOpen, setDetailsRequestOpen] = useState(false);
  const [favoriting, setFavoriting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const {
    show: showDialog,
    close: closeDialog,
    dialogProps: screenDialogProps,
  } = useAppDialog();
  const { startCall, callLogProps } = useCallLog();
  const name = contact.name || contactHandle(contact);
  // Mirrors the contacts_delete RLS policy (migration 205): a manager may
  // delete anything in the account, everyone else only what they saved.
  const isManager = useAuthStore((s) => s.profile?.org_role) === 'org_manager';
  const myUserId = useAuthStore((s) => s.session?.user.id);
  const canDelete = isManager || (!!myUserId && contact.user_id === myUserId);

  // Only needed to name the colleague in the refusal, so it stays off
  // until we already know this contact is not the caller's to delete.
  const { data: savedBy } = useQuery({
    queryKey: ['contact-owner', contact.user_id],
    enabled: !canDelete && Boolean(contact.user_id),
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('user_id', contact.user_id)
        .maybeSingle();
      return (data?.full_name as string | null) ?? null;
    },
  });

  // Web parity: the star also sits on the contacts list row, but the
  // detail screen is where an agent decides a contact matters.
  async function toggleFavorite() {
    if (favoriting) return;
    const next = !contact.is_favorite;
    haptic.tap();
    setFavoriting(true);
    try {
      await apiFetch(`/api/contacts/${contact.id}/favorite`, {
        method: 'PATCH',
        body: JSON.stringify({ is_favorite: next }),
      });
      haptic.success();
      queryClient.invalidateQueries({ queryKey: ['contact', contact.id] });
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      queryClient.invalidateQueries({ queryKey: ['contact-counts'] });
    } catch (err) {
      haptic.warn();
      showDialog({
        title: 'Could not update favourite',
        message: friendlyError(
          err instanceof Error ? err.message : 'Try again.'
        ),
      });
    } finally {
      setFavoriting(false);
    }
  }
  function explainCannotDelete() {
    haptic.tap();
    showDialog({
      title: 'This one is not yours to delete',
      message: savedBy
        ? `${savedBy} saved ${name}, so it stays on their list. Ask them or your manager to remove it — everything else here is still yours to edit.`
        : `A teammate saved ${name}, so it stays on their list. Ask them or your manager to remove it — everything else here is still yours to edit.`,
    });
  }

  function confirmDelete() {
    showDialog({
      title: `Delete ${name}?`,
      message:
        'This permanently removes the contact, their tags, notes and interest links. Past broadcasts and deals are kept but lose their link to this contact. This cannot be undone.',
      actions: [
        { label: 'Cancel', variant: 'muted', onPress: closeDialog },
        {
          label: 'Delete',
          variant: 'destructive',
          onPress: () => {
            closeDialog();
            doDelete();
          },
        },
      ],
    });
  }

  async function doDelete() {
    if (deleting) return;
    setDeleting(true);
    try {
      await apiFetch(`/api/contacts/${contact.id}`, { method: 'DELETE' });
      haptic.success();
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      queryClient.invalidateQueries({ queryKey: ['contact-counts'] });
      queryClient.removeQueries({ queryKey: ['contact', contact.id] });
      router.back();
    } catch (err) {
      haptic.warn();
      setDeleting(false);
      showDialog({
        title: 'Could not delete',
        message: friendlyError(
          err instanceof Error ? err.message : 'Try again.'
        ),
      });
    }
  }

  const clsColor = contact.classification
    ? classificationColors[contact.classification]?.[dark ? 'dark' : 'light']
    : undefined;

  const budget = formatBudgetRange(
    contact.min_budget,
    contact.max_budget,
    contact.no_budget
  );

  return (
    <KeyboardAvoidingView
      testID="contact-detail-screen"
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {contact.status === 'pending_review' ? (
          <ReviewBanner
            contact={contact}
            onApproved={(outcome) => setCelebration({ contact, outcome })}
          />
        ) : null}
        <View style={styles.identity}>
          <Avatar name={name} size={72} />
          <View style={styles.nameRow}>
            <Text
              style={[
                styles.name,
                { color: colors.text, fontFamily: f.extrabold },
              ]}
            >
              {name}
            </Text>
            <Pressable
              hitSlop={10}
              onPress={toggleFavorite}
              disabled={favoriting}
              accessibilityRole="button"
              accessibilityLabel={
                contact.is_favorite
                  ? `Remove ${name} from favourites`
                  : `Add ${name} to favourites`
              }
              accessibilityState={{ disabled: favoriting, busy: favoriting }}
            >
              <Ionicons
                name={contact.is_favorite ? 'star' : 'star-outline'}
                size={22}
                color={contact.is_favorite ? colors.warning : colors.textFaint}
              />
            </Pressable>
          </View>
          <View
            style={{
              flexDirection: 'row',
              gap: 6,
              flexWrap: 'wrap',
              justifyContent: 'center',
            }}
          >
            {contact.classification ? (
              <Tag label={contact.classification} color={clsColor} />
            ) : null}
            {contact.name_tag ? <Tag label={contact.name_tag} /> : null}
            {contact.lead_temp ? (
              <Tag
                label={contact.lead_temp}
                color={
                  contact.lead_temp === 'HOT' ? colors.danger : colors.textMuted
                }
              />
            ) : null}
          </View>
        </View>

        <View style={styles.actions}>
          {hasPhone(contact) ? (
            <>
              <ActionButton
                icon="call"
                label="Call"
                onPress={() => startCall(contact)}
              />
              <ActionButton
                icon="logo-whatsapp"
                label="WhatsApp"
                onPress={() => openWelcomeWhatsApp(contact)}
              />
              <ActionButton
                icon="chatbubbles"
                label="Inbox"
                onPress={() => openConversation(contact.id)}
              />
              <ActionButton
                icon="swap-horizontal"
                label="To Engine"
                onPress={() => setMoveToEngineOpen(true)}
              />
              <ActionButton
                icon="clipboard-outline"
                label="Ask Details"
                onPress={() => setDetailsRequestOpen(true)}
              />
            </>
          ) : null}
          {contact.classification === 'Agent' ? (
            <ActionButton
              icon="map-outline"
              label="Journey"
              onPress={() =>
                router.push(`/(app)/journey?contactId=${contact.id}`)
              }
            />
          ) : null}
        </View>

        <View
          style={[
            styles.card,
            { backgroundColor: colors.glass, borderColor: colors.glassBorder },
          ]}
        >
          {contact.phone ? (
            <InfoRow icon="call-outline" label="Phone" value={contact.phone} />
          ) : null}
          {contact.secondary_phones?.length ? (
            <InfoRow
              icon="call-outline"
              label="Other phones"
              value={contact.secondary_phones.join(', ')}
            />
          ) : null}
          {contact.email ? (
            <InfoRow icon="mail-outline" label="Email" value={contact.email} />
          ) : null}
          {contact.company ? (
            <InfoRow
              icon="business-outline"
              label="Company"
              value={contact.company}
            />
          ) : null}
          {budget ? (
            <InfoRow icon="cash-outline" label="Budget" value={budget} />
          ) : null}
          {contact.areas_of_interest?.length ? (
            <InfoRow
              icon="location-outline"
              label="Areas of interest"
              value={
                contact.areas_of_interest.join(', ') +
                (contact.strict_area_match ? ' · strict match' : '')
              }
            />
          ) : null}
          {contact.property_interests?.length ? (
            <InfoRow
              icon="pricetags-outline"
              label="Property interests"
              value={contact.property_interests.join(', ')}
            />
          ) : null}
          {contact.min_roi ? (
            <InfoRow
              icon="trending-up-outline"
              label="Min ROI"
              value={`${contact.min_roi}%`}
            />
          ) : null}
          {contact.requirements ? (
            <InfoRow
              icon="list-outline"
              label="Requirements"
              value={contact.requirements}
            />
          ) : null}
        </View>

        {contact.classification &&
        ['Owner', 'Seller', 'Developer', 'Owner & Buyer', 'Agent'].includes(
          contact.classification
        ) ? (
          <AgentProperties
            contactId={contact.id}
            title={
              contact.classification === 'Agent'
                ? 'Showcase properties'
                : 'Managed properties'
            }
          />
        ) : null}
        {contact.classification &&
        ['Buyer', 'Agent', 'Owner & Buyer'].includes(contact.classification) ? (
          <InterestedProperties contact={contact} />
        ) : null}
        {contact.classification === 'Agent' ? (
          <AgentSchedule contact={contact} />
        ) : null}
        <ContactTags contactId={contact.id} />
        <AgentNotes
          contactId={contact.id}
          title={contact.classification === 'Agent' ? 'Agent notes' : 'Notes'}
        />

        <Text
          style={{ fontSize: 12, color: colors.textFaint, textAlign: 'center' }}
        >
          {contact.classification === 'Agent'
            ? 'Tap Edit above to update their details and requirements.'
            : 'Tap Edit above to update budget, areas and buyer preferences.'}
        </Text>

        <Pressable
          onPress={canDelete ? confirmDelete : explainCannotDelete}
          disabled={deleting}
          accessibilityRole="button"
          accessibilityLabel={
            canDelete ? `Delete ${name}` : `Why ${name} cannot be deleted`
          }
          accessibilityState={{ disabled: deleting, busy: deleting }}
          style={({ pressed }) => [
            styles.deleteContact,
            {
              backgroundColor: canDelete ? colors.dangerSoft : colors.glass,
              borderColor: canDelete ? colors.danger : colors.glassBorder,
              opacity: deleting ? 0.55 : pressed ? 0.85 : 1,
            },
          ]}
        >
          <Ionicons
            name="trash-outline"
            size={16}
            color={canDelete ? colors.danger : colors.textFaint}
          />
          <Text
            style={{
              fontSize: 14,
              fontFamily: f.bold,
              color: canDelete ? colors.danger : colors.textFaint,
            }}
          >
            {deleting ? 'Deleting…' : 'Delete contact'}
          </Text>
        </Pressable>
      </ScrollView>
      <ApproveCelebration
        celebration={celebration}
        onClose={() => setCelebration(null)}
      />
      <MoveToEngineSheet
        visible={moveToEngineOpen}
        onClose={() => setMoveToEngineOpen(false)}
        contact={contact}
      />
      <OwnerDetailsRequestSheet
        visible={detailsRequestOpen}
        onClose={() => setDetailsRequestOpen(false)}
        contact={contact}
      />
      <AppDialog {...screenDialogProps} />
      <AppDialog {...callLogProps} />
    </KeyboardAvoidingView>
  );
}

/**
 * Web parity: contacts arriving from portals/imports land as
 * pending_review; approving flips them active and auto-sends the
 * inquired property's details via WhatsApp (contact-detail-view's
 * approveContact + sendPropertyDetailsHelper).
 */
function ReviewBanner({
  contact,
  onApproved,
}: {
  contact: Contact;
  onApproved: (outcome: ApproveOutcome) => void;
}) {
  const { colors, fonts: f } = useTheme();
  const [busy, setBusy] = useState(false);
  const { show, close, dialogProps } = useAppDialog();

  // Portal leads are matched by scoring the enquiry against inventory
  // when the ad itself isn't mapped yet, and a scorer can be wrong. This
  // is how the agent says so before approving sends the lead the details
  // of a listing they never asked about.
  function confirmWrongListing(propertyId: string) {
    show({
      title: 'Not this listing?',
      message:
        'The listing will be un-tagged from this lead. Map the portal ad below to the right one and every future enquiry on it lands correctly.',
      actions: [
        { label: 'Keep it', variant: 'muted', onPress: close },
        {
          label: 'Un-tag',
          variant: 'destructive',
          onPress: async () => {
            close();
            try {
              await apiFetch(
                `/api/contacts/${contact.id}/inquiries/${propertyId}`,
                {
                  method: 'DELETE',
                }
              );
              haptic.success();
              queryClient.invalidateQueries({
                queryKey: ['contact', contact.id],
              });
              queryClient.invalidateQueries({
                queryKey: ['interested-properties', contact.id],
              });
              queryClient.invalidateQueries({ queryKey: ['contacts'] });
            } catch (e) {
              haptic.warn();
              show({
                title: 'Could not un-tag',
                message: friendlyError(
                  e instanceof ApiError ? e.message : 'Try again.'
                ),
              });
            }
          },
        },
      ],
    });
  }

  async function approve() {
    setBusy(true);
    const result = await approveAndSendDetails(contact);
    setBusy(false);
    if (!result.ok) {
      haptic.warn();
      show({
        title: 'Could not approve',
        message: friendlyError(result.error ?? 'Try again.'),
      });
      return;
    }
    onApproved(result);
    queryClient.invalidateQueries({ queryKey: ['contact', contact.id] });
    queryClient.invalidateQueries({ queryKey: ['contacts'] });
    queryClient.invalidateQueries({ queryKey: ['contact-counts'] });
  }

  return (
    <View
      style={[
        styles.reviewBanner,
        { backgroundColor: colors.warningSoft, borderColor: colors.warning },
      ]}
    >
      <View style={styles.reviewTop}>
        <PulseRing size={26} color={colors.warning}>
          <View
            style={{
              width: 26,
              height: 26,
              borderRadius: 13,
              backgroundColor: colors.warning,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons
              name="hourglass-outline"
              size={14}
              color={colors.onWarning}
            />
          </View>
        </PulseRing>
        <View style={{ flex: 1, gap: 2 }}>
          <Text
            style={{
              fontSize: 13.5,
              fontFamily: f.bold,
              color: colors.warning,
            }}
          >
            Needs review
          </Text>
          <Text
            style={{ fontSize: 12, color: colors.textMuted }}
            numberOfLines={2}
          >
            From {contact.referrer || contact.source || 'an external source'} —
            approve to move it into your active contacts
            {contact.last_inquired_property_id
              ? ' and send them the details below'
              : ''}
            .
          </Text>
        </View>
        <Pressable
          onPress={approve}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Approve contact"
          style={[
            styles.approveButton,
            { backgroundColor: colors.warning, opacity: busy ? 0.6 : 1 },
          ]}
        >
          {busy ? (
            <ActivityIndicator size="small" color={colors.onWarning} />
          ) : (
            <>
              <Ionicons name="checkmark" size={16} color={colors.onWarning} />
              <Text
                style={{
                  fontSize: 13.5,
                  fontFamily: f.bold,
                  color: colors.onWarning,
                }}
              >
                Approve
              </Text>
            </>
          )}
        </Pressable>
      </View>
      {contact.last_inquired_property_id ? (
        <ContactedProperty
          propertyId={contact.last_inquired_property_id}
          onWrongListing={() =>
            confirmWrongListing(contact.last_inquired_property_id!)
          }
        />
      ) : null}
      <PortalAdMapping contact={contact} />
      <AppDialog {...dialogProps} />
    </View>
  );
}

/**
 * The portal ad this lead quoted, and the agent's one-time assertion of
 * which listing it is. Until that pair exists in property_portal_listings
 * the webhook can only score the enquiry against inventory; once it does,
 * every later lead on the same ad resolves exactly — and asserting it
 * settles the ones already waiting.
 */
function PortalAdMapping({ contact }: { contact: Contact }) {
  const { colors, fonts: f } = useTheme();
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const { show, dialogProps } = useAppDialog();
  const portal = contact.lead_portal;
  const listingId = contact.lead_portal_listing_id;

  const { data: mapped } = useQuery({
    queryKey: ['portal-ad-link', portal, listingId],
    enabled: Boolean(portal && listingId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('property_portal_listings')
        .select('property_id, properties(title)')
        .eq('portal', portal!)
        .eq('portal_listing_id', listingId!)
        .maybeSingle();
      if (error) throw error;
      return data as {
        property_id: string;
        properties: { title: string } | null;
      } | null;
    },
  });

  if (!portal || !listingId) return null;

  const portalLabel = contact.source || portal;

  async function mapTo(propertyId: string) {
    setPicking(false);
    setBusy(true);
    try {
      const { data } = await apiFetch<{
        data: { propertyTitle: string; taggedContacts: number };
      }>(`/api/contacts/${contact.id}/portal-link`, {
        method: 'POST',
        body: JSON.stringify({ propertyId }),
      });
      haptic.success();
      const others = data.taggedContacts - 1;
      show({
        title: 'Ad mapped',
        message:
          `${portalLabel} ad ${listingId} is now "${data.propertyTitle}". New enquiries on it match ` +
          `automatically.` +
          (others > 0
            ? ` ${others} lead${others === 1 ? '' : 's'} already waiting moved across too.`
            : ''),
      });
      queryClient.invalidateQueries({ queryKey: ['contact', contact.id] });
      queryClient.invalidateQueries({
        queryKey: ['portal-ad-link', portal, listingId],
      });
      queryClient.invalidateQueries({
        queryKey: ['interested-properties', contact.id],
      });
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
    } catch (e) {
      haptic.warn();
      show({
        title: 'Could not map the ad',
        message: friendlyError(
          e instanceof ApiError ? e.message : 'Try again.'
        ),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <View
      style={[
        styles.portalAdRow,
        {
          backgroundColor: colors.surfaceRaised,
          borderColor: colors.glassBorder,
        },
      ]}
    >
      <Ionicons
        name={mapped ? 'link' : 'help-circle-outline'}
        size={16}
        color={mapped ? colors.success : colors.warning}
      />
      <View style={{ flex: 1, gap: 2 }}>
        <Text
          style={{ fontSize: 12.5, fontFamily: f.bold, color: colors.text }}
          numberOfLines={1}
        >
          {portalLabel} ad {listingId}
        </Text>
        <Text style={{ fontSize: 11.5, color: colors.textMuted }}>
          {mapped
            ? `Mapped to ${mapped.properties?.title ?? 'a listing'} — enquiries on it match automatically.`
            : 'Not mapped yet. Say which listing this ad is and every future enquiry on it matches exactly.'}
        </Text>
      </View>
      {mapped ? null : (
        <Pressable
          onPress={() => {
            haptic.tap();
            setPicking(true);
          }}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={`Map ${portalLabel} ad ${listingId} to a listing`}
          style={[
            styles.mapAdButton,
            { borderColor: colors.primary, opacity: busy ? 0.6 : 1 },
          ]}
        >
          {busy ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Text
              style={{
                fontSize: 12,
                fontFamily: f.bold,
                color: colors.primary,
              }}
            >
              Map
            </Text>
          )}
        </Pressable>
      )}
      <PropertyPicker
        visible={picking}
        excludeIds={[]}
        onClose={() => setPicking(false)}
        onSelect={mapTo}
      />
      <AppDialog {...dialogProps} />
    </View>
  );
}

/** The listing the lead contacted about — shown in the review banner so
 *  the agent sees the inquiry before approving (web parity). */
function ContactedProperty({
  propertyId,
  onWrongListing,
}: {
  propertyId: string;
  onWrongListing: () => void;
}) {
  const { colors, fonts: f } = useTheme();
  const { data: property } = useQuery({
    queryKey: ['contacted-property', propertyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('properties')
        .select('id, title, location, images')
        .eq('id', propertyId)
        .maybeSingle();
      if (error) throw error;
      return data as Pick<
        Property,
        'id' | 'title' | 'location' | 'images'
      > | null;
    },
  });
  if (!property) return null;

  return (
    <Pressable
      onPress={() => router.push(`/(app)/property/${property.id}`)}
      accessibilityRole="button"
      accessibilityLabel={`Contacted about ${property.title}`}
      style={[
        styles.contactedProperty,
        {
          backgroundColor: colors.surfaceRaised,
          borderColor: colors.glassBorder,
        },
      ]}
    >
      {property.images?.[0] ? (
        <Image
          source={{ uri: storagePublicUrl(property.images[0]) }}
          style={styles.contactedThumb}
        />
      ) : (
        <View
          style={[
            styles.contactedThumb,
            {
              backgroundColor: colors.surfaceSunken,
              alignItems: 'center',
              justifyContent: 'center',
            },
          ]}
        >
          <Ionicons name="home-outline" size={18} color={colors.textFaint} />
        </View>
      )}
      <View style={{ flex: 1, gap: 2 }}>
        <Text
          style={{
            fontSize: 10.5,
            fontFamily: f.bold,
            color: colors.warning,
            letterSpacing: 0.3,
          }}
        >
          CONTACTED ABOUT
        </Text>
        <Text
          style={{ fontSize: 13.5, fontFamily: f.bold, color: colors.text }}
          numberOfLines={1}
        >
          {property.title}
        </Text>
        {property.location ? (
          <Text
            style={{ fontSize: 12, color: colors.textMuted }}
            numberOfLines={1}
          >
            {property.location}
          </Text>
        ) : null}
        <Pressable
          onPress={onWrongListing}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="This is the wrong listing — un-tag it"
          style={{ alignSelf: 'flex-start' }}
        >
          <Text
            style={{ fontSize: 11.5, fontFamily: f.bold, color: colors.danger }}
          >
            Wrong listing?
          </Text>
        </Pressable>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
    </Pressable>
  );
}

async function openConversation(contactId: string) {
  const { data } = await supabase
    .from('conversations')
    .select('id')
    .eq('contact_id', contactId)
    .order('last_message_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (data?.id) {
    router.push(`/(app)/conversation/${data.id}`);
  }
}

function ContactEditor({
  contact,
  onDone,
}: {
  contact: Contact;
  onDone: () => void;
}) {
  const { colors, dark, fonts: f } = useTheme();
  const [name, setName] = useState(contact.name ?? '');
  const [secondName, setSecondName] = useState(contact.second_name ?? '');
  const [nameTag, setNameTag] = useState(contact.name_tag ?? '');
  const [secondaryPhones, setSecondaryPhones] = useState<string[]>(
    contact.secondary_phones ?? []
  );
  const [email, setEmail] = useState(contact.email ?? '');
  const [company, setCompany] = useState(contact.company ?? '');
  const [requirements, setRequirements] = useState(contact.requirements ?? '');
  const [classification, setClassification] = useState<
    Classification | undefined
  >(contact.classification);
  const [minBudget, setMinBudget] = useState(
    contact.min_budget != null ? String(contact.min_budget) : ''
  );
  const [maxBudget, setMaxBudget] = useState(
    contact.max_budget != null ? String(contact.max_budget) : ''
  );
  const [noBudget, setNoBudget] = useState(Boolean(contact.no_budget));
  const [areas, setAreas] = useState<string[]>(contact.areas_of_interest ?? []);
  const [areasGeo, setAreasGeo] = useState<AreaOfInterestGeo[]>(
    contact.areas_of_interest_geo ?? []
  );
  const [strictArea, setStrictArea] = useState(
    Boolean(contact.strict_area_match)
  );
  const [propertyInterests, setPropertyInterests] = useState<string[]>(
    contact.property_interests ?? []
  );
  const [minRoi, setMinRoi] = useState(
    contact.min_roi != null ? String(contact.min_roi) : ''
  );
  const [updateChannel, setUpdateChannel] = useState<UpdateChannelValue | null>(
    contact.preferred_update_channel ?? null
  );
  const [askedChannel, setAskedChannel] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const showPrefs = Boolean(
    classification && BUYER_PREF_CLASSIFICATIONS.includes(classification)
  );

  function toggleInterest(option: string) {
    setPropertyInterests((prev) =>
      prev.includes(option)
        ? prev.filter((o) => o !== option)
        : [...prev, option]
    );
  }

  async function save() {
    const cleanEmail = email.trim();
    if (cleanEmail && !/^\S+@\S+\.\S+$/.test(cleanEmail)) {
      setError(
        'That email address doesn\u2019t look right \u2014 check it and try again.'
      );
      return;
    }
    // Blank rows are just an unused "Add another number" tap, so they drop
    // silently; anything actually typed has to be a usable number, since a
    // half-entered one would be saved and later messaged.
    const typedPhones = secondaryPhones.map((p) => p.trim()).filter(Boolean);
    const normalizedPhones: string[] = [];
    for (const entry of typedPhones) {
      const normalized = cleanPhoneInput(entry);
      if (!normalized) {
        setError(
          `"${entry}" doesn\u2019t look like a phone number \u2014 use 10 digits, or include the country code.`
        );
        return;
      }
      if (normalized === contact.phone || normalizedPhones.includes(normalized))
        continue;
      normalizedPhones.push(normalized);
    }
    setSaving(true);
    setError(null);
    const { data: saved, error: updateError } = await supabase
      .from('contacts')
      .update({
        name: name.trim() || null,
        second_name: secondName.trim() || null,
        name_tag: nameTag.trim() || null,
        secondary_phones: normalizedPhones,
        email: email.trim() || null,
        company: company.trim() || null,
        requirements: requirements.trim() || null,
        classification: classification ?? null,
        min_budget: noBudget ? null : parseAmount(minBudget),
        max_budget: noBudget ? null : parseAmount(maxBudget),
        no_budget: noBudget,
        areas_of_interest: areas,
        // Drop coordinates for any area no longer in the list (web parity).
        areas_of_interest_geo: areasGeo.filter((g) =>
          areas.some(
            (a) => a.trim().toLowerCase() === g.name.trim().toLowerCase()
          )
        ),
        strict_area_match: strictArea,
        property_interests: propertyInterests,
        min_roi: parseAmount(minRoi),
        preferred_update_channel: updateChannel,
      })
      .eq('id', contact.id)
      .select('id');
    setSaving(false);
    if (updateError || !saved?.length) {
      haptic.warn();
      setError(
        updateError
          ? friendlyError(updateError.message)
          : 'That contact is no longer there. Go back and reopen it.'
      );
      return;
    }
    haptic.success();
    queryClient.invalidateQueries({ queryKey: ['contact', contact.id] });
    queryClient.invalidateQueries({ queryKey: ['contacts'] });
    queryClient.invalidateQueries({ queryKey: ['conversations'] });
    queryClient.invalidateQueries({ queryKey: ['agents-directory'] });
    onDone();
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {error ? <Banner kind="error" text={error} /> : null}

        <TextField
          label="Name"
          value={name}
          onChangeText={setName}
          placeholder="First name"
        />
        <TextField
          label="Second Name"
          value={secondName}
          onChangeText={setSecondName}
          placeholder="Surname"
        />
        <TextField
          label="Name Tag"
          value={nameTag}
          onChangeText={setNameTag}
          placeholder='Short qualifier, e.g. "Bank DSA"'
        />
        {/* Primary number is set at creation and stays put — these are the
            extra numbers (a second mobile, a WhatsApp-only number). */}
        <View style={{ gap: spacing.sm }}>
          <SectionLabel
            text="Other numbers"
            style={{ color: colors.textMuted }}
          />
          <Text
            style={{
              fontSize: 11.5,
              color: colors.textFaint,
              marginTop: -spacing.xs,
            }}
          >
            Primary: {contact.phone}
          </Text>
          {secondaryPhones.map((value, idx) => (
            <View
              key={idx}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.sm,
              }}
            >
              <View style={{ flex: 1 }}>
                <TextField
                  value={value}
                  onChangeText={(next) =>
                    setSecondaryPhones((prev) =>
                      prev.map((p, i) => (i === idx ? next : p))
                    )
                  }
                  placeholder="+91 98765 43210"
                  keyboardType="phone-pad"
                  autoCapitalize="none"
                />
              </View>
              <Pressable
                hitSlop={10}
                onPress={() => {
                  haptic.tap();
                  setSecondaryPhones((prev) =>
                    prev.filter((_, i) => i !== idx)
                  );
                }}
                accessibilityRole="button"
                accessibilityLabel={`Remove number ${idx + 1}`}
              >
                <Ionicons
                  name="close-circle-outline"
                  size={22}
                  color={colors.textMuted}
                />
              </Pressable>
            </View>
          ))}
          <Pressable
            onPress={() => {
              haptic.tap();
              setSecondaryPhones((prev) => [...prev, '']);
            }}
            accessibilityRole="button"
            accessibilityLabel="Add another number"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
          >
            <Ionicons
              name="add-circle-outline"
              size={18}
              color={colors.primary}
            />
            <Text
              style={{
                fontSize: 13.5,
                fontFamily: f.semibold,
                color: colors.primary,
              }}
            >
              Add another number
            </Text>
          </Pressable>
        </View>

        <TextField
          label="Email"
          value={email}
          onChangeText={setEmail}
          placeholder="email@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
        />
        <TextField
          label="Company"
          value={company}
          onChangeText={setCompany}
          placeholder="Company"
        />
        <TextField
          label="Requirements"
          value={requirements}
          onChangeText={setRequirements}
          placeholder="What are they looking for?"
          multiline
        />

        <View style={{ gap: spacing.sm }}>
          <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>
            Classification
          </Text>
          <View
            style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}
          >
            {CLASSIFICATIONS.map((c) => {
              const active = classification === c;
              const hue = classificationColors[c]?.[dark ? 'dark' : 'light'];
              return (
                <Pressable
                  key={c}
                  onPress={() => setClassification(active ? undefined : c)}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 7,
                    borderRadius: radius.full,
                    backgroundColor: active
                      ? colors.primarySoft
                      : colors.surface,
                    borderWidth: active ? 1.5 : StyleSheet.hairlineWidth,
                    borderColor: active ? colors.primary : colors.border,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 13,
                      fontFamily: f.semibold,
                      color: active
                        ? colors.primary
                        : (hue ?? colors.textMuted),
                    }}
                  >
                    {c}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={{ gap: spacing.sm }}>
          <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>
            Preferred update channel
          </Text>
          <View
            style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}
          >
            {UPDATE_CHANNEL_OPTIONS.map((opt) => {
              const active = updateChannel === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => setUpdateChannel(active ? null : opt.value)}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 7,
                    borderRadius: radius.full,
                    backgroundColor: active
                      ? colors.primarySoft
                      : colors.surface,
                    borderWidth: active ? 1.5 : StyleSheet.hairlineWidth,
                    borderColor: active ? colors.primary : colors.border,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 13,
                      fontFamily: f.semibold,
                      color: active ? colors.primary : colors.textMuted,
                    }}
                  >
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={[styles.hint, { color: colors.textFaint }]}>
            How announcements and reminders reach them. Nothing selected lets
            each send pick its own default.
          </Text>
          <Pressable
            onPress={async () => {
              try {
                await apiFetch(
                  `/api/contacts/${contact.id}/ask-update-channel`,
                  {
                    method: 'POST',
                  }
                );
                haptic.success();
                setAskedChannel(true);
                setError(null);
              } catch (err) {
                haptic.warn();
                setError(
                  err instanceof Error
                    ? friendlyError(err.message)
                    : 'Failed to send'
                );
              }
            }}
            accessibilityRole="button"
            accessibilityLabel="Ask them on WhatsApp"
          >
            <Text
              style={{
                fontSize: 12.5,
                fontFamily: f.semibold,
                color: colors.primary,
              }}
            >
              {askedChannel
                ? 'Asked ✓ — their tap sets it automatically'
                : 'Ask them on WhatsApp instead →'}
            </Text>
          </Pressable>
        </View>

        {showPrefs ? (
          <View style={{ gap: spacing.md, marginTop: spacing.sm }}>
            <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>
              Buyer preferences
            </Text>

            <CheckRow
              label="No budget limit"
              checked={noBudget}
              onToggle={() => setNoBudget((v) => !v)}
            />
            {!noBudget ? (
              <View style={{ flexDirection: 'row', gap: spacing.md }}>
                <View style={{ flex: 1, gap: spacing.xs }}>
                  <TextField
                    label="Min budget (₹)"
                    value={minBudget}
                    onChangeText={setMinBudget}
                    placeholder="e.g. 5000000"
                    keyboardType="number-pad"
                  />
                  {parseAmount(minBudget) ? (
                    <Text style={[styles.hint, { color: colors.textFaint }]}>
                      {formatInr(parseAmount(minBudget))}
                    </Text>
                  ) : null}
                </View>
                <View style={{ flex: 1, gap: spacing.xs }}>
                  <TextField
                    label="Max budget (₹)"
                    value={maxBudget}
                    onChangeText={setMaxBudget}
                    placeholder="e.g. 8000000"
                    keyboardType="number-pad"
                  />
                  {parseAmount(maxBudget) ? (
                    <Text style={[styles.hint, { color: colors.textFaint }]}>
                      {formatInr(parseAmount(maxBudget))}
                    </Text>
                  ) : null}
                </View>
              </View>
            ) : null}

            <View style={{ gap: spacing.sm }}>
              <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>
                Areas of interest
              </Text>
              <AreasOfInterestInput
                areas={areas}
                geo={areasGeo}
                onChange={(nextAreas, nextGeo) => {
                  setAreas(nextAreas);
                  setAreasGeo(nextGeo);
                }}
              />
            </View>

            <CheckRow
              label="Strict area match (within 5 km)"
              checked={strictArea}
              onToggle={() => setStrictArea((v) => !v)}
            />

            <View style={{ gap: spacing.sm }}>
              <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>
                Property interests
              </Text>
              <View
                style={{
                  flexDirection: 'row',
                  flexWrap: 'wrap',
                  gap: spacing.sm,
                }}
              >
                {PROPERTY_INTEREST_OPTIONS.map((option) => {
                  const active = propertyInterests.includes(option);
                  return (
                    <Pressable
                      key={option}
                      onPress={() => toggleInterest(option)}
                      accessibilityRole="button"
                      accessibilityLabel={option}
                      accessibilityState={{ selected: active }}
                      style={{
                        paddingHorizontal: 12,
                        paddingVertical: 7,
                        borderRadius: radius.full,
                        backgroundColor: active
                          ? colors.primarySoft
                          : colors.surface,
                        borderWidth: active ? 1.5 : StyleSheet.hairlineWidth,
                        borderColor: active ? colors.primary : colors.border,
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 13,
                          fontFamily: f.semibold,
                          color: active ? colors.primary : colors.textMuted,
                        }}
                      >
                        {option}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <TextField
              label="Expected min ROI (%)"
              value={minRoi}
              onChangeText={setMinRoi}
              placeholder="e.g. 4"
              keyboardType="decimal-pad"
            />
          </View>
        ) : null}

        <View style={{ marginTop: spacing.sm }}>
          <PrimaryButton label="Save changes" busy={saving} onPress={save} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function CheckRow({
  label,
  checked,
  onToggle,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
}) {
  const { colors, fonts: f } = useTheme();
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}
    >
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: radius.sm,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: checked ? colors.primary : colors.surface,
          borderWidth: checked ? 0 : StyleSheet.hairlineWidth,
          borderColor: colors.border,
        }}
      >
        {checked ? (
          <Ionicons name="checkmark" size={15} color={colors.onPrimary} />
        ) : null}
      </View>
      <Text
        style={{ fontSize: 14.5, fontFamily: f.medium, color: colors.text }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function ActionButton({
  icon,
  label,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
}) {
  const { colors, fonts: f } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.actionButton,
        { backgroundColor: colors.glass, borderColor: colors.glassBorder },
      ]}
    >
      <Ionicons name={icon} size={20} color={colors.primary} />
      <Text
        style={{ fontSize: 12.5, fontFamily: f.semibold, color: colors.text }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: string;
}) {
  const { colors, fonts: f } = useTheme();
  return (
    <View style={[styles.infoRow, { borderTopColor: colors.border }]}>
      <Ionicons
        name={icon}
        size={17}
        color={colors.textMuted}
        style={{ marginTop: 2 }}
      />
      <View style={{ flex: 1, gap: 1 }}>
        <Text style={{ fontSize: 12, color: colors.textFaint }}>{label}</Text>
        <Text
          style={{ fontSize: 14.5, fontFamily: f.medium, color: colors.text }}
        >
          {value}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.lg },
  deleteContact: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: radius.full,
    borderWidth: 1,
    paddingVertical: 12,
  },
  identity: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  name: {
    fontSize: 22,
    fontFamily: fonts.extrabold,
    textAlign: 'center',
    flexShrink: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'center',
  },
  actionButton: {
    alignItems: 'center',
    gap: 4,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 10,
    width: 92,
  },
  card: {
    borderWidth: 1,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  infoRow: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  fieldLabel: {
    fontSize: 12.5,
    fontFamily: fonts.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  hint: { fontSize: 12, fontFamily: fonts.medium, paddingHorizontal: 2 },
  reviewBanner: {
    gap: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.md,
  },
  reviewTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  contactedProperty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 8,
  },
  portalAdRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 10,
  },
  mapAdButton: {
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  contactedThumb: {
    width: 46,
    height: 46,
    borderRadius: radius.sm,
  },
  approveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: radius.full,
    paddingHorizontal: 14,
    minHeight: 38,
    minWidth: 104,
  },
  agentStrip: {
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  agentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.full,
    borderWidth: 1,
    paddingLeft: 4,
    paddingRight: 12,
    paddingVertical: 4,
  },
});
