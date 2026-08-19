import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ConvoRealLoader } from '@/components/loader';
import { ContactPickerSheet } from '@/components/contact-picker-sheet';
import { EnterRow } from '@/components/motion';
import {
  Banner,
  EmptyState,
  PrimaryButton,
  SectionLabel,
  Tag,
} from '@/components/ui';
import { ApiError } from '@/lib/api';
import { formatInr } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { queryClient } from '@/lib/query';
import {
  dismissMatchEvent,
  fetchMatchEvents,
  searchRadarContacts,
  sendMatchAlert,
} from '@/lib/radar';
import { radius, spacing, useTheme } from '@/lib/theme';
import { usePullRefresh } from '@/lib/use-pull-refresh';
import { resolveRequirementSource } from '@/lib/requirements/profiles';
import type { Contact, MatchEvent } from '@shared/types';

/**
 * Web parity: the Match Radar tab. New listings matched to buyers and
 * buyer preference updates matched to inventory, with one-tap WhatsApp
 * alerts. Deal-mode (direct owner) events render masked, as on web —
 * the credits unlock flow stays on the web.
 */

type CheckedState = { [eventId: string]: Set<string> };
type ManualContactState = { [eventId: string]: Contact[] };
const NO_CONTACTS: Contact[] = [];

export default function RadarScreen() {
  const { colors } = useTheme();
  const [checked, setChecked] = useState<CheckedState>({});
  const [manualContacts, setManualContacts] = useState<ManualContactState>({});
  const [pickerEvent, setPickerEvent] = useState<MatchEvent | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [templateMissingFor, setTemplateMissingFor] = useState<{
    [eventId: string]: string[];
  }>({});

  const events = useQuery({
    queryKey: ['radar-events'],
    queryFn: fetchMatchEvents,
  });
  const pull = usePullRefresh(events.refetch);

  // No entry in `checked` means "all targets selected" — the default —
  // so fresh events need no state sync when the query refetches.
  const selectionFor = (evt: MatchEvent) =>
    checked[evt.id] ?? new Set(evt.matches.map((m) => m.id));

  const targetIdsFor = (evt: MatchEvent) => [
    ...evt.matches.map((match) => match.id),
    ...(manualContacts[evt.id] ?? []).map((contact) => contact.id),
  ];

  const toggleTarget = (evt: MatchEvent, targetId: string) => {
    haptic.tap();
    setChecked((prev) => {
      const current = new Set(prev[evt.id] ?? targetIdsFor(evt));
      if (current.has(targetId)) current.delete(targetId);
      else current.add(targetId);
      return { ...prev, [evt.id]: current };
    });
  };

  const toggleAll = (evt: MatchEvent) => {
    haptic.tap();
    setChecked((prev) => {
      const allIds = targetIdsFor(evt);
      const current = prev[evt.id] ?? new Set(allIds);
      const allChecked = allIds.every((id) => current.has(id));
      return {
        ...prev,
        [evt.id]: allChecked
          ? new Set<string>()
          : new Set(allIds),
      };
    });
  };

  const saveManualContacts = (evt: MatchEvent, contacts: Contact[]) => {
    const previous = manualContacts[evt.id] ?? [];
    setManualContacts((current) => ({ ...current, [evt.id]: contacts }));
    setChecked((current) => {
      const next = new Set(
        current[evt.id] ?? evt.matches.map((match) => match.id)
      );
      const keptIds = new Set(contacts.map((contact) => contact.id));
      for (const contact of previous) {
        if (!keptIds.has(contact.id)) next.delete(contact.id);
      }
      for (const contact of contacts) next.add(contact.id);
      return { ...current, [evt.id]: next };
    });
  };

  async function dismiss(eventId: string) {
    haptic.warn();
    setError(null);
    setDismissingId(eventId);
    try {
      await dismissMatchEvent(eventId);
      queryClient.invalidateQueries({ queryKey: ['radar-events'] });
    } catch {
      setError('Could not dismiss this event.');
    } finally {
      setDismissingId(null);
    }
  }

  async function send(evt: MatchEvent) {
    const targetIds = Array.from(selectionFor(evt));
    if (targetIds.length === 0) return;
    haptic.send();
    setError(null);
    setNotice(null);
    setSendingId(evt.id);
    try {
      const manualIds = new Set(
        (manualContacts[evt.id] ?? []).map((contact) => contact.id)
      );
      const res = await sendMatchAlert(
        evt.id,
        targetIds,
        targetIds.filter((id) => manualIds.has(id))
      );
      if (res.sent > 0) {
        haptic.success();
        setNotice(
          res.sentViaTemplate > 0
            ? `Sent ${res.sent} alert${res.sent === 1 ? '' : 's'} — ${res.sentViaTemplate} via the approved template.`
            : `Sent WhatsApp alerts to ${res.sent} contact${res.sent === 1 ? '' : 's'}.`
        );
      }
      if (res.failed > 0)
        setError(
          `Failed to send ${res.failed} alert${res.failed === 1 ? '' : 's'}.`
        );
      if (res.templateMissing > 0) {
        const names = res.results
          .filter((r) => r.status === 'templateMissing')
          .map(
            (r) => {
              const match = evt.matches.find((item) => item.id === r.id);
              const manual = (manualContacts[evt.id] ?? []).find(
                (contact) => contact.id === r.id
              );
              return match?.name || manual?.name || manual?.phone || 'Unknown';
            }
          );
        setTemplateMissingFor((prev) => ({ ...prev, [evt.id]: names }));
      }
      if (res.sent > 0 && res.templateMissing === 0) {
        queryClient.invalidateQueries({ queryKey: ['radar-events'] });
      }
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not send match alerts.'
      );
    } finally {
      setSendingId(null);
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ headerShown: true, title: 'Match Radar' }} />

      <FlatList
        data={events.data ?? []}
        keyExtractor={(evt) => evt.id}
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl
            refreshing={pull.refreshing}
            onRefresh={pull.onRefresh}
            tintColor={colors.primary}
          />
        }
        ListHeaderComponent={
          <View style={{ gap: spacing.md, marginBottom: spacing.sm }}>
            <Text
              style={{ fontSize: 13, lineHeight: 19, color: colors.textMuted }}
            >
              Fresh listings matched to your buyers, and buyer preference
              changes matched to your inventory. Pick the targets and send
              WhatsApp alerts in one tap.
            </Text>
            {error ? <Banner kind="error" text={error} /> : null}
            {notice ? <Banner kind="success" text={notice} /> : null}
          </View>
        }
        ListEmptyComponent={
          events.isLoading ? (
            <ConvoRealLoader
              style={{ alignSelf: 'center', paddingVertical: 40 }}
            />
          ) : (
            <EmptyState
              icon="radio-outline"
              title="Match Radar clear"
              subtitle="Radar checks for matches automatically when new properties are added or buyers change their search preferences."
            />
          )
        }
        renderItem={({ item, index }) => (
          <EnterRow index={index}>
            {item.source === 'deal_mode' ? (
              <DirectOwnerCard
                event={item}
                dismissing={dismissingId === item.id}
                onDismiss={() => dismiss(item.id)}
              />
            ) : (
              <EventCard
                event={item}
                selected={selectionFor(item)}
                sending={sendingId === item.id}
                dismissing={dismissingId === item.id}
                templateMissing={templateMissingFor[item.id]}
                manualContacts={manualContacts[item.id] ?? NO_CONTACTS}
                onToggleTarget={(targetId) => toggleTarget(item, targetId)}
                onToggleAll={() => toggleAll(item)}
                onAddContacts={() => setPickerEvent(item)}
                onSend={() => send(item)}
                onDismiss={() => dismiss(item.id)}
              />
            )}
          </EnterRow>
        )}
      />

      <ContactPickerSheet
        key={pickerEvent?.id ?? 'radar-closed'}
        visible={pickerEvent !== null}
        onClose={() => setPickerEvent(null)}
        multiSelect
        title="Add contacts"
        hint="Search active Buyers or Agents who were not suggested by this match."
        confirmLabel="Add"
        initialSelected={
          pickerEvent ? manualContacts[pickerEvent.id] ?? NO_CONTACTS : NO_CONTACTS
        }
        maxSelections={pickerEvent ? Math.max(0, 20 - pickerEvent.matches.length) : 0}
        searchKey={pickerEvent ? `radar-${pickerEvent.id}` : 'radar'}
        searchContacts={async (query) => {
          if (!pickerEvent) return [];
          return (await searchRadarContacts(pickerEvent.id, query)) as Contact[];
        }}
        onSelectMany={(contacts) => {
          if (!pickerEvent) return;
          saveManualContacts(pickerEvent, contacts);
          setPickerEvent(null);
        }}
      />
    </View>
  );
}

function EventCard({
  event,
  selected,
  sending,
  dismissing,
  templateMissing,
  manualContacts,
  onToggleTarget,
  onToggleAll,
  onAddContacts,
  onSend,
  onDismiss,
}: {
  event: MatchEvent;
  selected: Set<string>;
  sending: boolean;
  dismissing: boolean;
  templateMissing?: string[];
  manualContacts: Contact[];
  onToggleTarget: (targetId: string) => void;
  onToggleAll: () => void;
  onAddContacts: () => void;
  onSend: () => void;
  onDismiss: () => void;
}) {
  const { colors, fonts: f } = useTheme();
  const displayTargets = [
    ...event.matches.map((match) => ({ ...match, manuallyAdded: false as const })),
    ...manualContacts.map((contact) => ({
      id: contact.id,
      name: contact.name || contact.phone || 'Contact',
      detail: contact.phone,
      score: null,
      chips: [] as string[],
      manuallyAdded: true as const,
    })),
  ];
  const allChecked = displayTargets.every((target) => selected.has(target.id));

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.glass, borderColor: colors.glassBorder },
      ]}
    >
      <View style={styles.cardHead}>
        <Tag
          label={event.kind === 'new_property' ? 'New listing' : 'Buyer update'}
          color={
            event.kind === 'new_property' ? colors.primary : colors.success
          }
        />
        <Text style={{ flex: 1, fontSize: 11.5, color: colors.textFaint }}>
          {new Date(event.created_at).toLocaleDateString()}
        </Text>
        {dismissing ? (
          <ActivityIndicator size="small" color={colors.textFaint} />
        ) : (
          <Pressable
            onPress={onDismiss}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Dismiss event"
          >
            <Ionicons name="trash-outline" size={17} color={colors.textFaint} />
          </Pressable>
        )}
      </View>

      <Subject event={event} />

      <View style={styles.targetsHead}>
        <SectionLabel text={`Matching targets (${displayTargets.length})`} />
        <View style={styles.targetActions}>
          {event.kind === 'new_property' ? (
            <Pressable
              onPress={onAddContacts}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Add contacts"
              style={styles.addContacts}
            >
              <Ionicons name="person-add-outline" size={14} color={colors.primary} />
              <Text style={{ fontSize: 12, fontFamily: f.bold, color: colors.primary }}>
                Add contacts
              </Text>
            </Pressable>
          ) : null}
          <Pressable onPress={onToggleAll} hitSlop={8} accessibilityRole="button">
            <Text
              style={{ fontSize: 12, fontFamily: f.bold, color: colors.primary }}
            >
              {allChecked ? 'Deselect all' : 'Select all'}
            </Text>
          </Pressable>
        </View>
      </View>

      <View style={{ gap: spacing.xs }}>
        {displayTargets.map((match) => {
          const isChecked = selected.has(match.id);
          return (
            <Pressable
              key={match.id}
              onPress={() => onToggleTarget(match.id)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: isChecked }}
              style={[
                styles.target,
                {
                  borderColor: isChecked ? colors.primary : colors.border,
                  backgroundColor: isChecked
                    ? colors.primarySoft
                    : 'transparent',
                },
              ]}
            >
              <Ionicons
                name={isChecked ? 'checkbox' : 'square-outline'}
                size={19}
                color={isChecked ? colors.primary : colors.textFaint}
              />
              <View style={{ flex: 1, gap: 1 }}>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: spacing.sm,
                  }}
                >
                  <Text
                    style={{
                      flex: 1,
                      fontSize: 13.5,
                      fontFamily: f.semibold,
                      color: colors.text,
                    }}
                    numberOfLines={1}
                  >
                    {match.name}
                  </Text>
                  <Text
                    style={{
                      fontSize: match.manuallyAdded ? 10.5 : 12,
                      fontFamily: f.bold,
                      color: match.manuallyAdded ? colors.primary : colors.success,
                    }}
                  >
                    {match.manuallyAdded ? 'Added manually' : `${match.score}%`}
                  </Text>
                </View>
                {match.detail ? (
                  <Text
                    style={{ fontSize: 11.5, color: colors.textFaint }}
                    numberOfLines={1}
                  >
                    {match.detail}
                  </Text>
                ) : null}
                {match.chips.length > 0 ? (
                  <Text
                    style={{ fontSize: 11, color: colors.textMuted }}
                    numberOfLines={1}
                  >
                    {match.chips.slice(0, 3).join(' · ')}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>

      {templateMissing && templateMissing.length > 0 ? (
        <View
          style={[
            styles.warnBox,
            {
              backgroundColor: colors.warningSoft,
              borderColor: colors.warning,
            },
          ]}
        >
          <Ionicons
            name="alert-circle-outline"
            size={16}
            color={colors.warning}
          />
          <Text
            style={{
              flex: 1,
              fontSize: 12,
              lineHeight: 17,
              color: colors.text,
            }}
          >
            {templateMissing.join(', ')}{' '}
            {templateMissing.length === 1 ? 'is' : 'are'} outside the 24-hour
            WhatsApp window. Finish the one-time new-property-alert template
            setup on the web, then send again.
          </Text>
        </View>
      ) : null}

      <PrimaryButton
        label={`Send Match Alert (${selected.size})`}
        icon="paper-plane-outline"
        busy={sending}
        disabled={selected.size === 0 || dismissing}
        onPress={onSend}
      />
    </View>
  );
}

function Subject({ event }: { event: MatchEvent }) {
  const { colors, fonts: f } = useTheme();

  if (event.kind === 'new_property' && event.property) {
    const p = event.property;
    const location = p.sublocality || p.city || p.location;
    return (
      <View style={[styles.subject, { borderColor: colors.border }]}>
        <Ionicons name="business-outline" size={17} color={colors.primary} />
        <View style={{ flex: 1, gap: 1 }}>
          <Text
            style={{ fontSize: 14.5, fontFamily: f.bold, color: colors.text }}
            numberOfLines={1}
          >
            {p.title}
          </Text>
          <Text
            style={{ fontSize: 12, color: colors.textMuted }}
            numberOfLines={1}
          >
            {formatInr(Number(p.price) || null)}
            {location ? ` · ${location}` : ''}
            {p.bedrooms ? ` · ${p.bedrooms} BHK` : ''}
            {p.area_sqft ? ` · ${p.area_sqft} ${p.area_unit || 'Sq.Ft.'}` : ''}
          </Text>
        </View>
      </View>
    );
  }

  if (event.kind === 'buyer_updated' && event.contact) {
    const c = event.contact;
    const source = resolveRequirementSource(c);
    const budget = source.no_budget
      ? 'No budget limit'
      : source.pref_budget_max || source.max_budget
        ? `Up to ${formatInr(source.pref_budget_max ?? source.max_budget)}`
        : null;
    const areas = [
      ...(source.areas_of_interest || []),
      ...(source.pref_areas || []),
    ]
      .slice(0, 3)
      .join(', ');
    return (
      <View style={[styles.subject, { borderColor: colors.border }]}>
        <Ionicons name="person-outline" size={17} color={colors.primary} />
        <View style={{ flex: 1, gap: 1 }}>
          <Text
            style={{ fontSize: 14.5, fontFamily: f.bold, color: colors.text }}
            numberOfLines={1}
          >
            {c.name || c.phone}
          </Text>
          <Text
            style={{ fontSize: 12, color: colors.textMuted }}
            numberOfLines={1}
          >
            {[budget, areas].filter(Boolean).join(' · ') ||
              'Preferences updated'}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <Text
      style={{ fontSize: 12.5, color: colors.textFaint, fontStyle: 'italic' }}
    >
      Subject details no longer available
    </Text>
  );
}

/** Cross-tenant deal-mode event: only the masked snapshot is visible.
 *  Unlocking costs credits and stays a web flow. */
function DirectOwnerCard({
  event,
  dismissing,
  onDismiss,
}: {
  event: MatchEvent;
  dismissing: boolean;
  onDismiss: () => void;
}) {
  const { colors, fonts: f } = useTheme();
  const snap = event.subject_snapshot;

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.glass, borderColor: colors.glassBorder },
      ]}
    >
      <View style={styles.cardHead}>
        <Tag label="Direct owner" color={colors.warning} />
        <Text style={{ flex: 1, fontSize: 11.5, color: colors.textFaint }}>
          {new Date(event.created_at).toLocaleDateString()}
        </Text>
        {dismissing ? (
          <ActivityIndicator size="small" color={colors.textFaint} />
        ) : (
          <Pressable
            onPress={onDismiss}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Dismiss event"
          >
            <Ionicons name="trash-outline" size={17} color={colors.textFaint} />
          </Pressable>
        )}
      </View>

      {snap ? (
        <View style={[styles.subject, { borderColor: colors.border }]}>
          <Ionicons name="home-outline" size={17} color={colors.warning} />
          <View style={{ flex: 1, gap: 1 }}>
            <Text
              style={{ fontSize: 14.5, fontFamily: f.bold, color: colors.text }}
              numberOfLines={1}
            >
              {snap.type} · {snap.listing_type}
              {snap.bedrooms ? ` · ${snap.bedrooms} BHK` : ''}
            </Text>
            <Text
              style={{ fontSize: 12, color: colors.textMuted }}
              numberOfLines={1}
            >
              {[
                snap.locality || snap.city,
                snap.price_band || snap.rent_band,
                snap.area_sqft
                  ? `${snap.area_sqft} ${snap.area_unit || 'Sq.Ft.'}`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
        </View>
      ) : null}

      <Text style={{ fontSize: 12.5, lineHeight: 18, color: colors.textMuted }}>
        A property owner listed this directly with {event.matches.length} of
        your buyers matching. Unlock the full listing from Match Radar on the
        web.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  card: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  subject: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  targetsHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  targetActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  addContacts: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  target: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  warnBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.sm,
  },
});
