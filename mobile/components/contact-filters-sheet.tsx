import { useQuery } from '@tanstack/react-query';
import { Pressable, ScrollView, Text, View } from 'react-native';

import {
  FilterGroup,
  FilterPill,
  PillScroller,
  PillWrap,
} from '@/components/filter-sheet-parts';
import { BottomSheet, sheetScrollArea } from '@/components/sheet';
import { PrimaryButton } from '@/components/ui';
import { apiFetch } from '@/lib/api';
import {
  AREA_OPTIONS_QUERY_KEY,
  areaOptionLabel,
  type AreaOption,
} from '@/lib/contact-area-options';
import {
  activeFilterCount,
  budgetStepLabel,
  BUDGET_STEPS,
  EMPTY_FILTERS,
  isDirty,
  SORT_OPTIONS,
  type ContactFilters,
} from '@/lib/contact-filters';
import { haptic } from '@/lib/haptics';
import { supabase } from '@/lib/supabase';
import { classificationColors, spacing, useTheme } from '@/lib/theme';
import { CLASSIFICATIONS } from '@/lib/types';

/** Mirrors the Contacts list's own `.limit(150)`. */
const LIST_LIMIT = 150;

/**
 * The web Contacts page's Filters dialog, as a sheet.
 *
 * Selections apply as they are made rather than behind an Apply button:
 * the footer counts what is left, so the effect of a chip is visible
 * without dismissing the sheet to look.
 */
export function ContactFiltersSheet({
  visible,
  onClose,
  filters,
  onChange,
  resultCount,
  loading,
}: {
  visible: boolean;
  onClose: () => void;
  filters: ContactFilters;
  onChange: (filters: ContactFilters) => void;
  resultCount: number;
  loading: boolean;
}) {
  const { colors, dark, fonts: f } = useTheme();

  const tags = useQuery({
    queryKey: ['filter-tags'],
    enabled: visible,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from('tags')
        .select('id, name')
        .order('name')
        .limit(100);
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  // Every stored locality, distinct-counted in SQL and grouped by
  // spelling on the server — the same list the web filter shows. Loaded
  // only once the sheet opens, and held for five minutes.
  const areas = useQuery({
    queryKey: AREA_OPTIONS_QUERY_KEY,
    enabled: visible,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const res = await apiFetch<{ data?: AreaOption[] }>(
        '/api/contacts/area-options'
      );
      return Array.isArray(res.data) ? res.data : [];
    },
  });

  function set(patch: Partial<ContactFilters>) {
    haptic.tap();
    onChange({ ...filters, ...patch });
  }

  /** Chips toggle: tapping the selected one clears it, so every filter
   *  can be undone where it was set without hunting for an "All". */
  function toggle<K extends keyof ContactFilters>(
    key: K,
    value: ContactFilters[K]
  ) {
    set({
      [key]: filters[key] === value ? null : value,
    } as Partial<ContactFilters>);
  }

  /** Areas are a set: each chip adds or removes its spelling group. */
  function toggleArea(key: string) {
    set({
      areas: filters.areas.includes(key)
        ? filters.areas.filter((k) => k !== key)
        : [...filters.areas, key],
    });
  }

  const count = activeFilterCount(filters);

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={count > 0 ? `Filters · ${count}` : 'Filters'}
      contentStyle={{ paddingHorizontal: 0 }}
    >
      <ScrollView
        style={[sheetScrollArea, { maxHeight: 420 }]}
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          paddingBottom: spacing.md,
          gap: spacing.lg,
        }}
      >
        <FilterGroup label="Classification">
          <PillWrap>
            {CLASSIFICATIONS.map((c) => (
              <FilterPill
                key={c}
                label={c}
                tint={classificationColors[c]?.[dark ? 'dark' : 'light']}
                active={filters.classification === c}
                onPress={() => toggle('classification', c)}
              />
            ))}
          </PillWrap>
        </FilterGroup>

        {tags.data && tags.data.length > 0 ? (
          <FilterGroup label="Tag">
            <PillWrap>
              {tags.data.map((t) => (
                <FilterPill
                  key={t.id}
                  label={t.name}
                  active={filters.tagId === t.id}
                  onPress={() => toggle('tagId', t.id)}
                />
              ))}
            </PillWrap>
          </FilterGroup>
        ) : null}

        {/* A ladder, not a set — so it scrolls in order instead of
            wrapping into a block that has to be read to be scanned. */}
        <FilterGroup
          label="Budget from"
          hint="Includes contacts marked as having no budget constraint."
        >
          <BudgetRow
            selected={filters.minBudget}
            onPick={(v) => toggle('minBudget', v)}
          />
        </FilterGroup>

        <FilterGroup label="Budget up to">
          <BudgetRow
            selected={filters.maxBudget}
            onPick={(v) => toggle('maxBudget', v)}
          />
        </FilterGroup>

        {areas.data && areas.data.length > 0 ? (
          <FilterGroup
            label="Area of interest"
            hint="Pick as many as you like. Different spellings of one area count as one."
          >
            <PillWrap>
              {areas.data.map((option) => (
                <FilterPill
                  key={option.key}
                  label={`${areaOptionLabel(option)} · ${option.count}`}
                  active={filters.areas.includes(option.key)}
                  onPress={() => toggleArea(option.key)}
                />
              ))}
            </PillWrap>
          </FilterGroup>
        ) : null}

        <FilterGroup label="Sort by">
          <PillWrap>
            {SORT_OPTIONS.map((s) => (
              <FilterPill
                key={s.key}
                label={s.label}
                active={filters.sort === s.key}
                onPress={() => set({ sort: s.key })}
              />
            ))}
          </PillWrap>
        </FilterGroup>
      </ScrollView>

      <View
        style={{
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.sm,
          gap: spacing.sm,
        }}
      >
        <PrimaryButton
          label={
            loading
              ? 'Counting…'
              : // The list itself stops at 150, so say so rather than
                // reporting the cap as the whole answer.
                `Show ${resultCount}${resultCount >= LIST_LIMIT ? '+' : ''} contact${resultCount === 1 ? '' : 's'}`
          }
          onPress={onClose}
        />
        <Pressable
          onPress={() => {
            haptic.tap();
            onChange(EMPTY_FILTERS);
          }}
          disabled={!isDirty(filters)}
          accessibilityRole="button"
          accessibilityLabel="Clear all filters"
          accessibilityState={{ disabled: !isDirty(filters) }}
          style={{ alignItems: 'center', paddingVertical: spacing.sm }}
        >
          <Text
            style={{
              fontSize: 13,
              fontFamily: f.semibold,
              color: isDirty(filters) ? colors.textMuted : colors.textFaint,
            }}
          >
            Clear all
          </Text>
        </Pressable>
      </View>
    </BottomSheet>
  );
}

function BudgetRow({
  selected,
  onPick,
}: {
  selected: number | null;
  onPick: (value: number) => void;
}) {
  return (
    <PillScroller>
      {BUDGET_STEPS.map((step) => (
        <FilterPill
          key={step}
          label={budgetStepLabel(step)}
          active={selected === step}
          onPress={() => onPick(step)}
        />
      ))}
    </PillScroller>
  );
}
