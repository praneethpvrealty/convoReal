import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { BottomSheet, sheetScrollArea } from '@/components/sheet';
import { SearchBar, SectionLabel } from '@/components/ui';
import {
  projectOptions,
  type InterestFilter,
} from '@/lib/contact-interest';
import { haptic } from '@/lib/haptics';
import { supabase } from '@/lib/supabase';
import { radius, spacing, useTheme } from '@/lib/theme';
import { useDebounced } from '@/lib/use-debounced';

/** Web caps Inventory stars at six (STARRED_PROPERTY_CAP); the quick
 *  picks here are the same six. */
const STARRED_CAP = 6;
/** Bound on the inventory page scanned for distinct project names. An
 *  account past this has more projects than a picker can show anyway,
 *  and search still reaches any listing directly. */
const PROJECT_SCAN_LIMIT = 400;

/**
 * Pick the property or project to narrow the Contacts list by.
 *
 * Opens on the account's Inventory stars — the same quick picks the web
 * Contacts page shows as chips — so the common case is one tap, and
 * falls through to search across every listing and project for the rest.
 */
export function InterestFilterSheet({
  visible,
  onClose,
  active,
  onApply,
}: {
  visible: boolean;
  onClose: () => void;
  active: InterestFilter | null;
  onApply: (filter: InterestFilter | null) => void;
}) {
  const { colors, fonts: f } = useTheme();
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search.trim());

  // Every exit routes through here — backdrop tap, Android back and
  // picking a row all call the sheet's onClose — so the next open
  // starts on the starred quick picks rather than the last search.
  function close() {
    setSearch('');
    onClose();
  }

  // Project names come off the inventory rows rather than the projects
  // table: properties.project stays authoritative for units that were
  // never linked to a project row (migration 227), so the string is the
  // only field that sees the whole tower. Search-independent, so it is
  // cached across keystrokes.
  const projects = useQuery({
    queryKey: ['interest-projects'],
    enabled: visible,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from('properties')
        .select('project')
        .not('project', 'is', null)
        .limit(PROJECT_SCAN_LIMIT);
      return (data ?? []) as { project: string | null }[];
    },
  });

  const listings = useQuery({
    queryKey: ['interest-listings', debounced],
    enabled: visible,
    queryFn: async () => {
      let query = supabase
        .from('properties')
        .select('id, property_code, title, project, is_starred');
      if (debounced) {
        const term = `%${debounced}%`;
        query = query
          .or(
            `property_code.ilike.${term},title.ilike.${term},project.ilike.${term}`
          )
          .limit(20);
      } else {
        query = query
          .eq('is_starred', true)
          .order('updated_at', { ascending: false })
          .limit(STARRED_CAP);
      }
      const { data } = await query;
      return (data ?? []) as {
        id: string;
        property_code: string | null;
        title: string | null;
        project: string | null;
        is_starred: boolean | null;
      }[];
    },
  });

  const projectRows = projectOptions(projects.data ?? [], debounced).slice(
    0,
    debounced ? 8 : 6
  );
  const listingRows = listings.data ?? [];
  const loading = listings.isFetching || projects.isFetching;
  const empty =
    !loading && projectRows.length === 0 && listingRows.length === 0;

  function apply(filter: InterestFilter) {
    haptic.tap();
    onApply(filter);
    close();
  }

  return (
    <BottomSheet
      visible={visible}
      onClose={close}
      title="Enquired for"
      contentStyle={{ paddingHorizontal: 0 }}
    >
      <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
        <Text style={{ fontSize: 12, color: colors.textMuted }}>
          Show only contacts who enquired about one listing, or about
          anything in one project.
        </Text>
        <SearchBar
          value={search}
          onChangeText={setSearch}
          placeholder="Search code, title or project…"
        />
        {active ? (
          <Pressable
            onPress={() => {
              haptic.tap();
              onApply(null);
              close();
            }}
            accessibilityRole="button"
            accessibilityLabel={`Clear the ${active.label} filter`}
            style={[
              styles.clearRow,
              {
                backgroundColor: colors.glass,
                borderColor: colors.glassBorder,
              },
            ]}
          >
            <Ionicons name="close-circle" size={16} color={colors.textMuted} />
            <Text
              style={{
                fontSize: 13,
                fontFamily: f.semibold,
                color: colors.text,
              }}
              numberOfLines={1}
            >
              Clear “{active.label}”
            </Text>
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        style={[sheetScrollArea, { maxHeight: 380 }]}
        contentContainerStyle={{ paddingVertical: spacing.sm }}
        keyboardShouldPersistTaps="handled"
      >
        {loading && listingRows.length === 0 && projectRows.length === 0 ? (
          <ActivityIndicator
            color={colors.primary}
            style={{ paddingVertical: spacing.xl }}
          />
        ) : null}

        {projectRows.length > 0 ? (
          <View style={{ paddingHorizontal: spacing.lg, paddingTop: 2 }}>
            <SectionLabel text="Projects" style={{ color: colors.textMuted }} />
          </View>
        ) : null}
        {projectRows.map((p) => (
          <OptionRow
            key={`project-${p.name.toLowerCase()}`}
            icon="business-outline"
            title={p.name}
            subtitle={`${p.count} listing${p.count === 1 ? '' : 's'} in inventory`}
            selected={active?.kind === 'project' && active.value === p.name}
            onPress={() =>
              apply({ kind: 'project', value: p.name, label: p.name })
            }
          />
        ))}

        {listingRows.length > 0 ? (
          <View
            style={{
              paddingHorizontal: spacing.lg,
              paddingTop: projectRows.length > 0 ? spacing.md : 2,
            }}
          >
            <SectionLabel
              text={debounced ? 'Listings' : 'Starred in inventory'}
              style={{ color: colors.textMuted }}
            />
          </View>
        ) : null}
        {listingRows.map((p) => {
          const label = p.property_code || p.title || 'Listing';
          return (
            <OptionRow
              key={p.id}
              icon={p.is_starred ? 'star' : 'home-outline'}
              iconColor={p.is_starred ? colors.rating : undefined}
              title={label}
              subtitle={
                [p.property_code ? p.title : null, p.project]
                  .filter(Boolean)
                  .join(' · ') || undefined
              }
              selected={active?.kind === 'property' && active.value === p.id}
              onPress={() => apply({ kind: 'property', value: p.id, label })}
            />
          );
        })}

        {empty ? (
          <Text
            style={{
              textAlign: 'center',
              paddingHorizontal: spacing.lg,
              paddingVertical: spacing.xl,
              fontSize: 13,
              color: colors.textMuted,
            }}
          >
            {debounced
              ? 'No listing or project matches that.'
              : 'Star a listing on the Properties tab to keep it here as a one-tap filter, or search for any listing above.'}
          </Text>
        ) : null}
      </ScrollView>
    </BottomSheet>
  );
}

function OptionRow({
  icon,
  iconColor,
  title,
  subtitle,
  selected,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  title: string;
  subtitle?: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors, fonts: f } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
      style={[
        styles.optionRow,
        selected && { backgroundColor: colors.primarySoft },
      ]}
    >
      <View style={[styles.optionIcon, { backgroundColor: colors.glass }]}>
        <Ionicons
          name={icon}
          size={16}
          color={iconColor ?? (selected ? colors.primary : colors.textMuted)}
        />
      </View>
      <View style={{ flex: 1 }}>
        <Text
          style={{
            fontSize: 14,
            fontFamily: f.semibold,
            color: selected ? colors.primary : colors.text,
          }}
          numberOfLines={1}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text
            style={{ fontSize: 12, color: colors.textFaint }}
            numberOfLines={1}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      {selected ? (
        <Ionicons name="checkmark-circle" size={18} color={colors.primary} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  clearRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
  },
  optionIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
