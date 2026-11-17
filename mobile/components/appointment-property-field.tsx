import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { storagePublicUrl } from '@/lib/storage-url';
import { supabase } from '@/lib/supabase';
import { radius, spacing, useTheme } from '@/lib/theme';
import { useDebounced } from '@/lib/use-debounced';
import {
  propertyArea,
  propertySearchTerm,
} from '@shared/lib/calendar/property-hashtag';

export interface LinkedProperty {
  id: string;
  title: string;
  property_code?: string | null;
  location?: string | null;
  sublocality?: string | null;
  city?: string | null;
  images?: string[] | null;
}

const PROPERTY_COLUMNS =
  'id, title, property_code, location, sublocality, city, images';

export async function fetchLinkedProperty(
  id: string
): Promise<LinkedProperty | null> {
  const { data } = await supabase
    .from('properties')
    .select(PROPERTY_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  return (data as LinkedProperty | null) ?? null;
}

export function usePropertyOptions(raw: string | null, minLength: number) {
  const debounced = useDebounced(raw ?? '');
  const term = propertySearchTerm(debounced);
  return useQuery({
    queryKey: ['appointment-property-picker', term],
    enabled: raw !== null && term.length >= minLength,
    queryFn: async () => {
      let query = supabase
        .from('properties')
        .select(PROPERTY_COLUMNS)
        .neq('status', 'Archived');
      if (term) {
        const like = `%${term}%`;
        query = query.or(
          `title.ilike.${like},property_code.ilike.${like},location.ilike.${like},sublocality.ilike.${like}`
        );
      }
      const { data } = await query
        .order('title')
        .limit(5);
      return (data ?? []) as LinkedProperty[];
    },
  });
}

export function PropertyRow({
  property,
  onPress,
  onClear,
}: {
  property: LinkedProperty;
  onPress?: () => void;
  onClear?: () => void;
}) {
  const { colors, fonts: f } = useTheme();
  const cover = storagePublicUrl(property.images?.[0]);
  const place = propertyArea(property);
  const body = (
    <>
      {cover ? (
        <Image source={{ uri: cover }} style={styles.thumb} />
      ) : (
        <View
          style={[
            styles.thumb,
            styles.thumbEmpty,
            { backgroundColor: colors.primarySoft },
          ]}
        >
          <Ionicons name="home-outline" size={15} color={colors.primary} />
        </View>
      )}
      <View style={{ flex: 1, gap: 1 }}>
        <Text
          style={{ fontSize: 14.5, fontFamily: f.semibold, color: colors.text }}
          numberOfLines={1}
        >
          {property.title}
        </Text>
        {property.property_code || place ? (
          <Text
            style={{ fontSize: 12, color: colors.textMuted }}
            numberOfLines={1}
          >
            {[property.property_code, place].filter(Boolean).join(' · ')}
          </Text>
        ) : null}
      </View>
      {onClear ? (
        <Pressable
          onPress={onClear}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Remove linked property"
        >
          <Ionicons name="close-circle" size={18} color={colors.textFaint} />
        </Pressable>
      ) : null}
    </>
  );
  const rowStyle = [
    styles.row,
    { backgroundColor: colors.surface, borderColor: colors.border },
  ];
  return onPress ? (
    <Pressable
      onPress={onPress}
      style={rowStyle}
      accessibilityRole="button"
      accessibilityLabel={`Link ${property.title}`}
    >
      {body}
    </Pressable>
  ) : (
    <View style={rowStyle}>{body}</View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
  },
  thumb: { width: 30, height: 30, borderRadius: radius.sm },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
});
