import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { PropertyPicker } from '@/components/agent-detail';
import { AppDialog, useAppDialog } from '@/components/app-dialog';
import { apiFetch, ApiError } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { queryClient } from '@/lib/query';
import { radius, spacing, useTheme } from '@/lib/theme';

export interface UnmappedPortalAd {
  portal: string;
  portalListingId: string;
  leadCount: number;
  lastSeenAt: string;
  sampleContactId: string;
  sampleContactName: string | null;
  guessedPropertyId: string | null;
  guessedPropertyTitle: string | null;
}

/**
 * Web parity: the portal ads with leads waiting and no listing mapped to
 * them yet (src/components/contacts/unmapped-portal-ads.tsx). One row per
 * ad, not per lead — mapping it is one decision that settles all of its
 * enquiries and every later one. The queue itself is computed server-side
 * by unmapped_portal_ads (migration 264), so both surfaces read the same
 * answer rather than each grouping leads their own way.
 */
export function UnmappedPortalAds() {
  const { colors, fonts: f } = useTheme();
  const [picking, setPicking] = useState<UnmappedPortalAd | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const { show, dialogProps } = useAppDialog();

  const { data: ads } = useQuery({
    queryKey: ['unmapped-portal-ads'],
    queryFn: async () => {
      const { data } = await apiFetch<{ data: UnmappedPortalAd[] }>(
        '/api/portals/unmapped-ads'
      );
      return data ?? [];
    },
    staleTime: 60_000,
  });

  async function mapAd(ad: UnmappedPortalAd, propertyId: string) {
    setPicking(null);
    setBusy(ad.portalListingId);
    try {
      const { data } = await apiFetch<{
        data: { propertyTitle: string; taggedContacts: number };
      }>(`/api/contacts/${ad.sampleContactId}/portal-link`, {
        method: 'POST',
        body: JSON.stringify({ propertyId }),
      });
      haptic.success();
      show({
        title: 'Ad mapped',
        message:
          `${ad.portal} ad ${ad.portalListingId} is now "${data.propertyTitle}". ` +
          `${data.taggedContacts} lead${data.taggedContacts === 1 ? '' : 's'} tagged, and new ` +
          `enquiries on it match automatically.`,
      });
      queryClient.invalidateQueries({ queryKey: ['unmapped-portal-ads'] });
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      queryClient.invalidateQueries({ queryKey: ['contact-counts'] });
    } catch (e) {
      haptic.warn();
      show({
        title: 'Could not map the ad',
        message: friendlyError(
          e instanceof ApiError ? e.message : 'Try again.'
        ),
      });
    } finally {
      setBusy(null);
    }
  }

  if (!ads || ads.length === 0) return null;

  return (
    <View
      style={[
        styles.panel,
        { backgroundColor: colors.warningSoft, borderColor: colors.warning },
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Ionicons name="link-outline" size={15} color={colors.warning} />
        <Text
          style={{ fontSize: 12.5, fontFamily: f.bold, color: colors.warning }}
        >
          {ads.length} portal ad{ads.length === 1 ? '' : 's'} not mapped
        </Text>
      </View>
      <Text style={{ fontSize: 11.5, color: colors.textMuted }}>
        Say which listing each one is — once. Their leads are tagged now, and
        every later enquiry on the ad matches without guessing.
      </Text>

      {ads.map((ad) => (
        <View
          key={`${ad.portal}:${ad.portalListingId}`}
          style={[
            styles.row,
            {
              backgroundColor: colors.surfaceRaised,
              borderColor: colors.glassBorder,
            },
          ]}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <Text
              style={{ fontSize: 12.5, fontFamily: f.bold, color: colors.text }}
              numberOfLines={1}
            >
              {ad.portal} ad {ad.portalListingId} · {ad.leadCount} lead
              {ad.leadCount === 1 ? '' : 's'}
            </Text>
            <Text
              style={{ fontSize: 11.5, color: colors.textMuted }}
              numberOfLines={1}
            >
              {ad.guessedPropertyTitle
                ? `Currently guessed as ${ad.guessedPropertyTitle}`
                : 'No listing tagged'}
            </Text>
          </View>
          <Pressable
            onPress={() => {
              haptic.tap();
              setPicking(ad);
            }}
            disabled={busy !== null}
            accessibilityRole="button"
            accessibilityLabel={`Map ${ad.portal} ad ${ad.portalListingId} to a listing`}
            style={[
              styles.mapButton,
              { borderColor: colors.primary, opacity: busy !== null ? 0.6 : 1 },
            ]}
          >
            {busy === ad.portalListingId ? (
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
        </View>
      ))}

      <PropertyPicker
        visible={picking !== null}
        excludeIds={[]}
        onClose={() => setPicking(null)}
        onSelect={(propertyId) => picking && mapAd(picking, propertyId)}
      />
      <AppDialog {...dialogProps} />
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: 10,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  mapButton: {
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
});
