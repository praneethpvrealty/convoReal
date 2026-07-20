import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { placeDetails, placesAutocomplete, sessionToken } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { AreaOfInterestGeo } from '@/lib/types';
import { useDebounced } from '@/lib/use-debounced';

/** Quick-add chips — same shortlist the web offers (areas-of-interest-input.tsx). */
const SUGGESTED_AREAS = ['Whitefield', 'Koramangala', 'Indiranagar', 'Jayanagar', 'Not specific'];

/**
 * Native areas-of-interest picker with Google Places geo resolution —
 * the mobile port of the web AreasOfInterestInput. Typing queries
 * /api/maps/autocomplete; picking a suggestion resolves coordinates via
 * /api/maps/place-details and records them in `geo` so proximity
 * matching works. Free-typed areas are kept name-only, exactly like web.
 */
export function AreasOfInterestInput({
  areas,
  geo,
  onChange,
}: {
  areas: string[];
  geo: AreaOfInterestGeo[];
  onChange: (areas: string[], geo: AreaOfInterestGeo[]) => void;
}) {
  const { colors, fonts: f, dark } = useTheme();
  const [input, setInput] = useState('');
  const [focused, setFocused] = useState(false);
  const session = useRef(sessionToken());
  const debounced = useDebounced(input.trim());

  const enabled = focused && debounced.length >= 2;
  const { data: suggestions, isFetching } = useQuery({
    queryKey: ['area-suggest', debounced],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      try {
        const res = await placesAutocomplete(debounced, session.current);
        return res.suggestions.slice(0, 5);
      } catch {
        // 501 = no Google key configured; degrade to plain text add.
        return [];
      }
    },
  });

  const hasArea = (name: string) => areas.some((a) => a.toLowerCase() === name.toLowerCase());

  function addName(name: string, geoEntry?: AreaOfInterestGeo) {
    const clean = name.trim();
    if (!clean) return;
    const nextAreas = hasArea(clean) ? areas : [...areas, clean];
    const nextGeo = geoEntry
      ? [...geo.filter((g) => g.name.toLowerCase() !== clean.toLowerCase()), geoEntry]
      : geo;
    onChange(nextAreas, nextGeo);
  }

  function removeArea(name: string) {
    haptic.tap();
    onChange(
      areas.filter((a) => a !== name),
      geo.filter((g) => g.name.toLowerCase() !== name.toLowerCase())
    );
  }

  function manualAdd() {
    addName(input);
    setInput('');
  }

  async function pick(s: { place_id: string; main_text: string }) {
    haptic.tap();
    const name = s.main_text;
    // Show the chip immediately; resolve coordinates in the background.
    addName(name);
    setInput('');
    setFocused(false);
    try {
      const { place } = await placeDetails(s.place_id, session.current);
      session.current = sessionToken(); // sessions are single-purchase
      if (Number.isFinite(place.latitude) && Number.isFinite(place.longitude)) {
        onChange(
          hasArea(name) ? areas : [...areas, name],
          [
            ...geo.filter((g) => g.name.toLowerCase() !== name.toLowerCase()),
            { name, lat: place.latitude, lng: place.longitude },
          ]
        );
      }
    } catch {
      // Keep the name-only area — matching falls back to the locality table.
    }
  }

  const hasGeo = (name: string) => geo.some((g) => g.name.toLowerCase() === name.toLowerCase());

  return (
    <View style={{ gap: spacing.sm }}>
      {areas.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {areas.map((a) => (
            <View
              key={a}
              style={[styles.chip, { backgroundColor: colors.primarySoft, borderColor: colors.primary }]}
            >
              {hasGeo(a) ? <Ionicons name="location" size={12} color={colors.primary} /> : null}
              <Text style={{ fontSize: 13, fontFamily: f.semibold, color: colors.primary }}>{a}</Text>
              <Pressable
                onPress={() => removeArea(a)}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${a}`}
              >
                <Ionicons name="close" size={14} color={colors.primary} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      <View>
        <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
          <View
            style={[
              styles.inputWrap,
              { backgroundColor: colors.surfaceRaised, borderColor: focused ? colors.primary : colors.border },
            ]}
          >
            <Ionicons name="location-outline" size={16} color={colors.textFaint} />
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder="Add a locality…"
              placeholderTextColor={colors.textFaint}
              onFocus={() => setFocused(true)}
              onBlur={() => setTimeout(() => setFocused(false), 150)}
              onSubmitEditing={manualAdd}
              returnKeyType="done"
              autoCapitalize="words"
              style={[styles.input, { color: colors.text }]}
            />
            {enabled && isFetching ? <ActivityIndicator size="small" color={colors.primary} /> : null}
          </View>
          <Pressable
            onPress={manualAdd}
            accessibilityRole="button"
            accessibilityLabel="Add area"
            style={[styles.addBtn, { backgroundColor: colors.primarySoft }]}
          >
            <Ionicons name="add" size={20} color={colors.primary} />
          </Pressable>
        </View>

        {enabled && suggestions && suggestions.length > 0 ? (
          <View
            style={[
              styles.suggestions,
              { backgroundColor: dark ? '#12281E' : '#FFFFFF', borderColor: colors.glassBorder },
            ]}
          >
            {suggestions.map((s, i) => (
              <Pressable
                key={s.place_id}
                onPress={() => pick(s)}
                style={[
                  styles.suggestionRow,
                  i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
                ]}
              >
                <Ionicons name="location-outline" size={15} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontFamily: f.semibold, color: colors.text }} numberOfLines={1}>
                    {s.main_text}
                  </Text>
                  {s.secondary_text ? (
                    <Text style={{ fontSize: 11.5, color: colors.textFaint }} numberOfLines={1}>
                      {s.secondary_text}
                    </Text>
                  ) : null}
                </View>
                <Ionicons name="add-circle-outline" size={16} color={colors.textFaint} />
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        <Text style={{ fontSize: 11, color: colors.textFaint }}>Quick add:</Text>
        {SUGGESTED_AREAS.filter((a) => !hasArea(a)).map((a) => (
          <Pressable
            key={a}
            onPress={() => addName(a)}
            accessibilityRole="button"
            accessibilityLabel={`Add ${a}`}
            style={[styles.quickChip, { borderColor: colors.border, backgroundColor: colors.surfaceSunken }]}
          >
            <Text style={{ fontSize: 11.5, color: colors.textMuted }}>+ {a}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.full,
    borderWidth: 1,
    paddingLeft: 12,
    paddingRight: 8,
    paddingVertical: 6,
  },
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    height: 44,
  },
  input: { flex: 1, fontSize: 15, paddingVertical: 0 },
  addBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestions: {
    marginTop: spacing.xs,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  quickChip: {
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
});
