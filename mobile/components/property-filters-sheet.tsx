import { Pressable, ScrollView, Text, View } from 'react-native';

import {
  FilterGroup,
  FilterPill,
  PillScroller,
  PillWrap,
} from '@/components/filter-sheet-parts';
import { BottomSheet, sheetScrollArea } from '@/components/sheet';
import { PrimaryButton } from '@/components/ui';
import { haptic } from '@/lib/haptics';
import { PROPERTY_TYPE_GROUPS } from '@/lib/property-options';
import {
  activePropertyFilterCount,
  budgetStepLabel,
  BUDGET_STEPS,
  EMPTY_PROPERTY_FILTERS,
  isPropertyFiltersDirty,
  PROPERTY_SORTS,
  PROPERTY_STATUSES,
  TYPE_CATEGORIES,
  type PropertyFilters,
} from '@/lib/property-filters';
import { spacing, useTheme } from '@/lib/theme';

/**
 * The Properties tab's Filters sheet — the same control the Contacts
 * tab has, over the axes `GET /api/properties` already understands.
 *
 * Selections apply as they are made and the footer counts what is left,
 * so a chip's effect is visible without dismissing the sheet.
 */
export function PropertyFiltersSheet({
  visible,
  onClose,
  filters,
  onChange,
  resultCount,
  loading,
  hasNear,
}: {
  visible: boolean;
  onClose: () => void;
  filters: PropertyFilters;
  onChange: (filters: PropertyFilters) => void;
  resultCount: number | undefined;
  loading: boolean;
  /** A location anchor is active, so the route orders by distance and
   *  the sort chips would be a promise it does not keep. */
  hasNear: boolean;
}) {
  const { colors, fonts: f } = useTheme();

  function set(patch: Partial<PropertyFilters>) {
    haptic.tap();
    onChange({ ...filters, ...patch });
  }

  /** Chips toggle: tapping the selected one clears it, so every filter
   *  can be undone where it was set without hunting for an "All". */
  function toggle<K extends keyof PropertyFilters>(
    key: K,
    value: PropertyFilters[K]
  ) {
    set({ [key]: filters[key] === value ? null : value } as Partial<
      PropertyFilters
    >);
  }

  const count = activePropertyFilterCount(filters);

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
        {/* A category matches every subtype under it, so it sits above
            them rather than among them. */}
        <FilterGroup label="Category">
          <PillWrap>
            {TYPE_CATEGORIES.map((c) => (
              <FilterPill
                key={c}
                label={c}
                active={filters.type === c}
                onPress={() => toggle('type', c)}
              />
            ))}
          </PillWrap>
        </FilterGroup>

        <FilterGroup label="Property type">
          <PillWrap>
            {PROPERTY_TYPE_GROUPS.flatMap((g) => g.options).map((t) => (
              <FilterPill
                key={t}
                label={t}
                active={filters.type === t}
                onPress={() => toggle('type', t)}
              />
            ))}
          </PillWrap>
        </FilterGroup>

        <FilterGroup
          label="Status"
          hint="Overrides the “Include unavailable” chip while it is set."
        >
          <PillWrap>
            {PROPERTY_STATUSES.map((s) => (
              <FilterPill
                key={s}
                label={s}
                active={filters.status === s}
                onPress={() => toggle('status', s)}
              />
            ))}
          </PillWrap>
        </FilterGroup>

        {/* A ladder, not a set — so it scrolls in order instead of
            wrapping into a block that has to be read to be scanned. */}
        <FilterGroup
          label="Price from"
          hint="Listings with no recorded price, JV/JD included, drop out of a price-bounded search."
        >
          <PriceRow
            selected={filters.minPrice}
            onPick={(v) => toggle('minPrice', v)}
          />
        </FilterGroup>

        <FilterGroup label="Price up to">
          <PriceRow
            selected={filters.maxPrice}
            onPick={(v) => toggle('maxPrice', v)}
          />
        </FilterGroup>

        <FilterGroup label="Listed by">
          <PillWrap>
            <FilterPill
              label="Owner"
              active={filters.source === 'owner'}
              onPress={() => toggle('source', 'owner')}
            />
            <FilterPill
              label="Agent"
              active={filters.source === 'agent'}
              onPress={() => toggle('source', 'agent')}
            />
          </PillWrap>
        </FilterGroup>

        <FilterGroup label="Showcase">
          <PillWrap>
            <FilterPill
              label="Showcased"
              active={filters.showcase === 'true'}
              onPress={() => toggle('showcase', 'true')}
            />
            <FilterPill
              label="Not showcased"
              active={filters.showcase === 'false'}
              onPress={() => toggle('showcase', 'false')}
            />
          </PillWrap>
        </FilterGroup>

        <FilterGroup label="Sort by">
          {hasNear ? (
            <Text style={{ fontSize: 12, color: colors.textMuted }}>
              Ordered by distance while a location filter is on. Clear the
              location to sort another way.
            </Text>
          ) : (
            <PillWrap>
              {PROPERTY_SORTS.map((s) => (
                <FilterPill
                  key={s.key}
                  label={s.label}
                  active={filters.sort === s.key}
                  onPress={() => set({ sort: s.key })}
                />
              ))}
            </PillWrap>
          )}
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
            loading || resultCount === undefined
              ? 'Counting…'
              : `Show ${resultCount} listing${resultCount === 1 ? '' : 's'}`
          }
          onPress={onClose}
        />
        <Pressable
          onPress={() => {
            haptic.tap();
            onChange(EMPTY_PROPERTY_FILTERS);
          }}
          disabled={!isPropertyFiltersDirty(filters)}
          accessibilityRole="button"
          accessibilityLabel="Clear all filters"
          accessibilityState={{ disabled: !isPropertyFiltersDirty(filters) }}
          style={{ alignItems: 'center', paddingVertical: spacing.sm }}
        >
          <Text
            style={{
              fontSize: 13,
              fontFamily: f.semibold,
              color: isPropertyFiltersDirty(filters)
                ? colors.textMuted
                : colors.textFaint,
            }}
          >
            Clear all
          </Text>
        </Pressable>
      </View>
    </BottomSheet>
  );
}

function PriceRow({
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
