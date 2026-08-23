import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { BottomSheet, sheetScrollArea } from '@/components/sheet';
import { haptic } from '@/lib/haptics';
import {
  fetchAudienceListings,
  type AudienceListing,
} from '@/lib/listing-audience';
import { radius, spacing, useTheme } from '@/lib/theme';

/**
 * Web parity: ListingAudiencePicker. Pick the listing whose audience —
 * everyone who enquired about it or was seen viewing it — should receive
 * the property being shared. One tap resolves and selects them.
 */
export function ListingAudienceSheet({
  visible,
  onClose,
  onPick,
  busyId,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (listing: AudienceListing) => void;
  busyId: string | null;
}) {
  const { colors, fonts: f } = useTheme();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['audience-listings'],
    enabled: visible,
    staleTime: 60_000,
    queryFn: fetchAudienceListings,
  });
  const listings = data ?? [];

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Share with a listing's audience"
    >
      <View
        style={{
          paddingHorizontal: spacing.lg,
          gap: spacing.sm,
          flexShrink: 1,
        }}
      >
        <Text
          style={{ fontSize: 12.5, lineHeight: 18, color: colors.textMuted }}
        >
          Everyone who enquired about a listing or was seen viewing it.
        </Text>

        {isLoading ? (
          <View style={{ paddingVertical: spacing.xl, alignItems: 'center' }}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : isError ? (
          <Text
            style={{
              fontSize: 12.5,
              color: colors.danger,
              paddingVertical: spacing.md,
            }}
          >
            Could not load listing audiences. Check your connection and try
            again.
          </Text>
        ) : listings.length === 0 ? (
          <Text
            style={{
              fontSize: 12.5,
              lineHeight: 18,
              color: colors.textMuted,
              paddingVertical: spacing.md,
            }}
          >
            No listing has an engaged audience yet. Enquiries and tracked
            showcase views build one.
          </Text>
        ) : (
          <ScrollView
            style={[sheetScrollArea, { maxHeight: 400 }]}
            keyboardShouldPersistTaps="handled"
          >
            {listings.map((listing) => (
              <Pressable
                key={listing.propertyId}
                disabled={busyId !== null}
                onPress={() => {
                  haptic.tap();
                  onPick(listing);
                }}
                accessibilityRole="button"
                accessibilityLabel={`Select the ${listing.contactsCount} contacts who engaged with ${listing.title ?? 'this listing'}`}
                style={[styles.row, { borderColor: colors.border }]}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <Text
                    numberOfLines={1}
                    style={{
                      fontSize: 13.5,
                      fontFamily: f.bold,
                      color: colors.text,
                    }}
                  >
                    {listing.title || 'Untitled listing'}
                  </Text>
                  {listing.propertyCode ? (
                    <Text style={{ fontSize: 11, color: colors.textFaint }}>
                      {listing.propertyCode}
                    </Text>
                  ) : null}
                </View>
                {busyId === listing.propertyId ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <View style={styles.count}>
                    <Text
                      style={{
                        fontSize: 11.5,
                        fontFamily: f.bold,
                        color: colors.primary,
                      }}
                    >
                      {listing.contactsCount}
                    </Text>
                    <Ionicons
                      name="people-outline"
                      size={14}
                      color={colors.primary}
                    />
                  </View>
                )}
              </Pressable>
            ))}
          </ScrollView>
        )}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    marginBottom: spacing.xs,
  },
  count: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});
