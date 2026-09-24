import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AppDialog, useAppDialog } from '@/components/app-dialog';
import { ContactPickerSheet } from '@/components/contact-picker-sheet';
import { ContactRequirementsSheet } from '@/components/contact-requirements-sheet';
import { EnterRow, PressScale } from '@/components/motion';
import { RequirementAgentShareSheet } from '@/components/requirement-agent-share-sheet';
import { BottomSheet } from '@/components/sheet';
import {
  Avatar,
  Banner,
  EmptyState,
  FilterChip,
  PrimaryButton,
  SearchBar,
  Tag,
} from '@/components/ui';
import { useAuthStore } from '@/lib/auth-store';
import { friendlyError } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { openContactChat } from '@/lib/open-chat';
import { queryClient } from '@/lib/query';
import {
  buildRequirementDigest,
  type RequirementShareMode,
} from '@/lib/requirement-digest';
import {
  attachSuggestedTag,
  fetchRequirements,
  searchRequirementContacts,
  setRequirementActive,
} from '@/lib/requirements';
import {
  attachedTagNames,
  canEditRequirement,
  effectiveAreas,
  effectiveCategories,
  EMPTY_REQUIREMENT_FILTERS,
  filterRequirements,
  latestNote,
  REQUIREMENT_CLASSIFICATIONS,
  REQUIREMENT_PRIORITIES,
  requirementBudgetLabel,
  requirementStats,
  visibleTagSuggestions,
  type RequirementFilters,
  type RequirementRow,
} from '@/lib/requirements-feed';
import { resolveRequirementSource } from '@/lib/requirements-profile';
import { radius, spacing, useTheme } from '@/lib/theme';
import { useDebounced } from '@/lib/use-debounced';
import { usePullRefresh } from '@/lib/use-pull-refresh';

/**
 * Web parity: the Requirements tab on the Contacts page.
 *
 * Every buyer and agent brief the account holds, searchable by client,
 * phone, area, brief text or note — with the area search merging
 * spellings the way the Contacts filter does. What a brief means
 * (which profile is active, how explicit and AI-extracted preferences
 * merge, what may leave the Engine) lives in the shared libraries this
 * screen reads; the screen renders and acts.
 */
export default function RequirementsScreen() {
  const { colors, fonts: f } = useTheme();
  const profile = useAuthStore((s) => s.profile);
  const session = useAuthStore((s) => s.session);
  const canEdit = Boolean(profile && profile.account_role !== 'viewer');
  const { show, dialogProps } = useAppDialog();

  const [search, setSearch] = useState('');
  const debounced = useDebounced(search);
  const [filters, setFilters] = useState<RequirementFilters>(
    EMPTY_REQUIREMENT_FILTERS
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<RequirementRow | null>(null);
  const [picking, setPicking] = useState(false);
  const [sharing, setSharing] = useState<RequirementRow | null>(null);
  const [agentShare, setAgentShare] = useState<RequirementRow | null>(null);

  const list = useQuery({
    queryKey: ['requirements'],
    queryFn: fetchRequirements,
    enabled: Boolean(profile?.account_id),
  });
  const pull = usePullRefresh(list.refetch);

  const rows = useMemo(() => list.data ?? [], [list.data]);
  const stats = useMemo(() => requirementStats(rows), [rows]);
  const shown = useMemo(
    () => filterRequirements(rows, { ...filters, search: debounced }),
    [rows, filters, debounced]
  );

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['requirements'] });

  function setFilter(patch: Partial<RequirementFilters>) {
    haptic.tap();
    setFilters((prev) => ({ ...prev, ...patch }));
  }

  async function togglePark(row: RequirementRow) {
    const next = row.requirement_active === false;
    setBusyId(row.id);
    haptic.tap();
    try {
      await setRequirementActive(row.id, next);
      setNotice(
        next
          ? 'Requirement is live again — matching and sharing resumed'
          : 'Requirement parked — no more matches, alerts or shares'
      );
      await refresh();
    } catch (err) {
      show({
        title: 'Could not change that',
        message: friendlyError(
          err instanceof Error ? err.message : String(err)
        ),
      });
    } finally {
      setBusyId(null);
    }
  }

  async function acceptTag(row: RequirementRow, name: string) {
    if (!profile?.account_id || !session?.user.id) return;
    setBusyId(row.id);
    haptic.tap();
    try {
      await attachSuggestedTag(
        row.id,
        profile.account_id,
        session.user.id,
        name
      );
      setNotice(`Tagged as "${name}"`);
      await refresh();
    } catch (err) {
      show({
        title: `Couldn't add "${name}"`,
        message: friendlyError(
          err instanceof Error ? err.message : String(err)
        ),
      });
    } finally {
      setBusyId(null);
    }
  }

  async function openChat(row: RequirementRow) {
    const outcome = await openContactChat(row);
    if (!outcome.ok) {
      show({
        title: 'Could not open the thread',
        message: friendlyError(outcome.error ?? 'Please try again.'),
      });
    }
  }

  function digestFor(row: RequirementRow, mode: RequirementShareMode) {
    const source = resolveRequirementSource(row);
    return buildRequirementDigest(
      [
        {
          id: row.id,
          name: row.name,
          classification: row.classification,
          no_budget: source.no_budget,
          min_budget: source.min_budget ?? source.pref_budget_min ?? null,
          max_budget: source.max_budget ?? source.pref_budget_max ?? null,
          requirements: source.requirements,
          areas_of_interest: [
            ...(source.areas_of_interest ?? []),
            ...(source.pref_areas ?? []),
          ].filter(Boolean),
          projects_of_interest: [
            ...(source.projects_of_interest ?? []),
            ...(source.pref_projects ?? []),
          ].filter(Boolean),
          tags: attachedTagNames(row),
          latestNote: latestNote(row),
          requirement_active: row.requirement_active,
        },
      ],
      mode
    );
  }

  async function shareDigest(row: RequirementRow, mode: RequirementShareMode) {
    const message = digestFor(row, mode);
    if (!message) {
      show({
        title: 'Nothing to share yet',
        message:
          'This brief has no budget, area or requirement text a co-broker could act on.',
      });
      return;
    }
    setSharing(null);
    haptic.send();
    await Share.share({ message });
  }

  async function copyDigest(row: RequirementRow, mode: RequirementShareMode) {
    const message = digestFor(row, mode);
    if (!message) return;
    await Clipboard.setStringAsync(message);
    setSharing(null);
    haptic.success();
    setNotice('Requirement copied — paste it wherever your brokers are');
  }

  const header = (
    <View style={styles.header}>
      <SearchBar
        value={search}
        onChangeText={setSearch}
        placeholder="Client, phone, area, brief or note"
      />

      <View style={styles.tiles}>
        {(
          [
            { label: 'Total', value: stats.total, cls: 'All', pri: 'All' },
            { label: 'High', value: stats.hot, cls: 'All', pri: 'High' },
            { label: 'Buyers', value: stats.buyers, cls: 'Buyer', pri: 'All' },
            { label: 'Agents', value: stats.agents, cls: 'Agent', pri: 'All' },
          ] as const
        ).map((tile) => {
          const active =
            filters.classification === tile.cls &&
            filters.priority === tile.pri;
          return (
            <Pressable
              key={tile.label}
              onPress={() =>
                setFilter({ classification: tile.cls, priority: tile.pri })
              }
              accessibilityRole="button"
              accessibilityLabel={`${tile.label}: ${tile.value}`}
              accessibilityState={{ selected: active }}
              style={[
                styles.tile,
                {
                  backgroundColor: colors.glass,
                  borderColor: active ? colors.primary : colors.glassBorder,
                },
              ]}
            >
              <Text
                style={{ fontFamily: f.bold, fontSize: 20, color: colors.text }}
              >
                {tile.value}
              </Text>
              <Text
                style={{
                  fontFamily: f.medium,
                  fontSize: 11,
                  color: colors.textMuted,
                }}
              >
                {tile.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
      >
        {REQUIREMENT_CLASSIFICATIONS.map((c) => (
          <FilterChip
            key={c.key}
            label={c.label}
            active={filters.classification === c.key}
            onPress={() => setFilter({ classification: c.key })}
          />
        ))}
      </ScrollView>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
      >
        {REQUIREMENT_PRIORITIES.map((p) => (
          <FilterChip
            key={p.key}
            label={p.label}
            active={filters.priority === p.key}
            onPress={() => setFilter({ priority: p.key })}
          />
        ))}
      </ScrollView>

      {canEdit ? (
        <PrimaryButton
          label="Add a requirement"
          icon="add-circle-outline"
          onPress={() => {
            haptic.tap();
            setPicking(true);
          }}
        />
      ) : null}

      {notice ? <Banner kind="success" text={notice} /> : null}
      {list.isError ? (
        <Banner kind="error" text="Could not load requirements." />
      ) : null}
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ headerShown: true, title: 'Requirements' }} />
      <FlatList
        data={shown}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={header}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={pull.refreshing}
            onRefresh={pull.onRefresh}
            tintColor={colors.primary}
          />
        }
        ListEmptyComponent={
          list.isPending ? (
            <ActivityIndicator color={colors.primary} style={styles.center} />
          ) : (
            <EmptyState
              icon="clipboard-outline"
              title="No requirements found"
              subtitle="Try broadening your search or filters."
            />
          )
        }
        renderItem={({ item, index }) => (
          <EnterRow index={index}>
            <RequirementCard
              row={item}
              busy={busyId === item.id}
              canEdit={canEdit}
              onChat={() => openChat(item)}
              onEdit={() => setEditing(item)}
              onShare={() => setSharing(item)}
              onPark={() => togglePark(item)}
              onAcceptTag={(name) => acceptTag(item, name)}
            />
          </EnterRow>
        )}
      />

      <ContactPickerSheet
        visible={picking}
        onClose={() => setPicking(false)}
        title="Whose requirement?"
        hint="Buyers whose briefs this app can write."
        searchContacts={searchRequirementContacts}
        searchKey="requirement-contacts"
        onSelect={(contact) => {
          setPicking(false);
          setEditing(contact as RequirementRow);
        }}
      />

      <BottomSheet
        visible={Boolean(sharing)}
        onClose={() => setSharing(null)}
        title="Share this requirement"
      >
        {sharing ? (
          <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
            <Text
              style={{
                fontFamily: f.regular,
                fontSize: 13,
                color: colors.textMuted,
              }}
            >
              Masked withholds the client&apos;s name, your tags and your notes.
              Full detail sends them exactly as written.
            </Text>
            <PrimaryButton
              label="Share masked"
              icon="lock-closed-outline"
              onPress={() => shareDigest(sharing, 'masked')}
            />
            <Pressable
              onPress={() => copyDigest(sharing, 'masked')}
              accessibilityRole="button"
              style={styles.secondary}
            >
              <Text style={{ fontFamily: f.semibold, color: colors.text }}>
                Copy masked text
              </Text>
            </Pressable>
            <Pressable
              onPress={() => shareDigest(sharing, 'full')}
              accessibilityRole="button"
              style={styles.secondary}
            >
              <Text style={{ fontFamily: f.semibold, color: colors.text }}>
                Share full detail
              </Text>
            </Pressable>
            {canEdit && sharing.classification === 'Buyer' ? (
              <Pressable
                onPress={() => {
                  const row = sharing;
                  setSharing(null);
                  setAgentShare(row);
                }}
                accessibilityRole="button"
                style={styles.secondary}
              >
                <Text style={{ fontFamily: f.semibold, color: colors.text }}>
                  Send to an agent in ConvoReal
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </BottomSheet>

      {editing ? (
        <ContactRequirementsSheet
          visible
          contact={editing}
          onClose={() => setEditing(null)}
          onChanged={refresh}
        />
      ) : null}

      {agentShare ? (
        <RequirementAgentShareSheet
          visible
          buyer={agentShare}
          onBack={() => setAgentShare(null)}
          onDone={() => {
            setAgentShare(null);
            refresh();
          }}
        />
      ) : null}

      <AppDialog {...dialogProps} />
    </View>
  );
}

function RequirementCard({
  row,
  busy,
  canEdit,
  onChat,
  onEdit,
  onShare,
  onPark,
  onAcceptTag,
}: {
  row: RequirementRow;
  busy: boolean;
  canEdit: boolean;
  onChat: () => void;
  onEdit: () => void;
  onShare: () => void;
  onPark: () => void;
  onAcceptTag: (name: string) => void;
}) {
  const { colors, fonts: f } = useTheme();
  const source = resolveRequirementSource(row) as RequirementRow;
  const parked = row.requirement_active === false;
  const budget = requirementBudgetLabel(row);
  const areas = effectiveAreas(source);
  const categories = effectiveCategories(source);
  const tagNames = attachedTagNames(row);
  const projects = visibleTagSuggestions(
    [
      ...(source.projects_of_interest ?? []),
      ...(source.pref_projects ?? []),
    ].filter((p): p is string => Boolean(p)),
    tagNames
  );
  const suggestions = visibleTagSuggestions(
    source.pref_suggested_tags,
    tagNames
  );
  const note = latestNote(row);

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.glass,
          borderColor: colors.glassBorder,
          opacity: parked ? 0.6 : 1,
        },
      ]}
    >
      <View style={styles.row}>
        <View style={styles.identity}>
          <Avatar name={row.name || '?'} size={38} />
          <View style={{ flexShrink: 1 }}>
            <Text
              numberOfLines={1}
              style={{
                fontFamily: f.semibold,
                fontSize: 15,
                color: colors.text,
              }}
            >
              {row.name || 'Unnamed'}
            </Text>
            {row.phone ? (
              <Text
                style={{
                  fontFamily: f.regular,
                  fontSize: 12,
                  color: colors.textMuted,
                }}
              >
                {row.phone}
              </Text>
            ) : null}
          </View>
        </View>
        <View style={styles.badges}>
          {parked ? <Tag label="PARKED" color={colors.warning} /> : null}
          {row.lead_temp ? (
            <Tag
              label={row.lead_temp}
              color={row.lead_temp === 'HOT' ? colors.danger : undefined}
            />
          ) : null}
          {row.classification ? <Tag label={row.classification} /> : null}
        </View>
      </View>

      <View style={styles.row}>
        <Text
          style={{
            fontFamily: f.medium,
            fontSize: 12,
            color: colors.textMuted,
          }}
        >
          Estimated budget
        </Text>
        <View style={styles.badges}>
          {budget.ai ? (
            <Ionicons name="sparkles" size={12} color={colors.primary} />
          ) : null}
          <Text
            style={{ fontFamily: f.semibold, fontSize: 14, color: colors.text }}
          >
            {budget.text}
          </Text>
        </View>
      </View>

      {source.requirements?.trim() ? (
        <Text
          style={{
            fontFamily: f.regular,
            fontSize: 13,
            lineHeight: 19,
            color: colors.text,
          }}
        >
          {source.requirements.trim()}
        </Text>
      ) : (
        <Text
          style={{
            fontFamily: f.regular,
            fontSize: 13,
            fontStyle: 'italic',
            color: colors.textFaint,
          }}
        >
          No demands statement yet.
        </Text>
      )}

      {categories || areas ? (
        <View style={styles.chipWrap}>
          {categories?.value.map((c) => (
            <PreferenceChip
              key={`c-${c}`}
              label={c}
              ai={categories.source === 'ai'}
            />
          ))}
          {areas?.value.map((a) => (
            <PreferenceChip
              key={`a-${a}`}
              label={`📍 ${a}`}
              ai={areas.source === 'ai'}
            />
          ))}
        </View>
      ) : null}

      {projects.length > 0 || suggestions.length > 0 ? (
        <View style={styles.chipWrap}>
          {[...projects, ...suggestions].map((name) => (
            <Pressable
              key={`s-${name}`}
              onPress={() => (canEdit ? onAcceptTag(name) : undefined)}
              disabled={!canEdit || busy}
              accessibilityRole="button"
              accessibilityLabel={`Add ${name} as a tag`}
              style={[
                styles.suggestion,
                { borderColor: colors.primary, opacity: canEdit ? 1 : 0.6 },
              ]}
            >
              <Ionicons name="add" size={12} color={colors.primary} />
              <Text
                style={{
                  fontFamily: f.medium,
                  fontSize: 12,
                  color: colors.primary,
                }}
              >
                {name}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {tagNames.length > 0 ? (
        <View style={styles.chipWrap}>
          {tagNames.map((t) => (
            <Tag key={`t-${t}`} label={t} />
          ))}
        </View>
      ) : null}

      {note ? (
        <Text
          style={{
            fontFamily: f.regular,
            fontSize: 12,
            fontStyle: 'italic',
            color: colors.textMuted,
          }}
        >
          “{note}”
        </Text>
      ) : null}

      <View style={[styles.actions, { borderTopColor: colors.glassBorder }]}>
        <CardAction icon="chatbubbles-outline" label="Chat" onPress={onChat} />
        {canEdit && canEditRequirement(row.classification) ? (
          <CardAction icon="create-outline" label="Edit" onPress={onEdit} />
        ) : null}
        <CardAction
          icon="share-social-outline"
          label="Share"
          onPress={onShare}
          disabled={parked}
        />
        {canEdit ? (
          <CardAction
            icon="power"
            label={parked ? 'Unpark' : 'Park'}
            onPress={onPark}
            disabled={busy}
            tint={parked ? colors.warning : colors.success}
          />
        ) : null}
      </View>
    </View>
  );
}

function PreferenceChip({ label, ai }: { label: string; ai: boolean }) {
  const { colors, fonts: f } = useTheme();
  if (!ai) return <Tag label={label} />;
  return (
    <View
      accessibilityLabel={`${label}, extracted by AI from the demands statement`}
      style={[
        styles.aiChip,
        { borderColor: colors.primary, backgroundColor: colors.primarySoft },
      ]}
    >
      <Ionicons name="sparkles" size={11} color={colors.primary} />
      <Text
        style={{ fontFamily: f.medium, fontSize: 12, color: colors.primary }}
      >
        {label}
      </Text>
    </View>
  );
}

function CardAction({
  icon,
  label,
  onPress,
  disabled = false,
  tint,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tint?: string;
}) {
  const { colors, fonts: f } = useTheme();
  return (
    <PressScale>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        style={[styles.action, { opacity: disabled ? 0.4 : 1 }]}
      >
        <Ionicons name={icon} size={16} color={tint ?? colors.textMuted} />
        <Text
          style={{
            fontFamily: f.medium,
            fontSize: 12,
            color: tint ?? colors.textMuted,
          }}
        >
          {label}
        </Text>
      </Pressable>
    </PressScale>
  );
}

const styles = StyleSheet.create({
  header: { padding: spacing.lg, gap: spacing.md },
  list: { paddingBottom: spacing.xl, gap: spacing.md, flexGrow: 1 },
  center: { paddingVertical: 40, alignSelf: 'center' },
  tiles: { flexDirection: 'row', gap: spacing.sm },
  tile: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderRadius: radius.md,
  },
  chips: { gap: spacing.sm, paddingRight: spacing.lg },
  card: {
    marginHorizontal: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexShrink: 1,
  },
  badges: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  aiChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: radius.full,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  suggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: radius.full,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.md,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  secondary: { alignItems: 'center', paddingVertical: spacing.md },
});
