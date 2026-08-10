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

/** Bound on the contacts scanned for distinct areas of interest. Web
 *  scans the whole table for the same dropdown and caches it for five
 *  minutes; a phone gets a page and the same cache. */
const AREA_SCAN_LIMIT = 500;
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

  // areas_of_interest is a text[] with no cheap indexed DISTINCT, so
  // this is a scan either way. Loaded only once the sheet opens, and
  // held for five minutes — the same deal the web page makes.
  const areas = useQuery({
    queryKey: ['filter-areas'],
    enabled: visible,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from('contacts')
        .select('areas_of_interest')
        .not('areas_of_interest', 'is', null)
        .limit(AREA_SCAN_LIMIT);
      return Array.from(
        new Set(
          ((data ?? []) as { areas_of_interest: string[] | null }[])
            .flatMap((c) => c.areas_of_interest ?? [])
            .map((a) => a.trim())
            .filter(Boolean)
        )
      ).sort();
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
    set({ [key]: filters[key] === value ? null : value } as Partial<
      ContactFilters
    >);
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
          <FilterGroup label="Area of interest">
            <PillWrap>
              {areas.data.map((a) => (
                <FilterPill
                  key={a}
                  label={a}
                  active={filters.area === a}
                  onPress={() => toggle('area', a)}
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

