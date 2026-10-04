import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';

import { PortalExpirySheet } from '@/components/portal-expiry-sheet';
import { apiFetch } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { formatInr } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import {
  driftHeadline,
  driftToggleLabel,
  propertyHref,
} from '@/lib/portal-drift';
import { radius, spacing, useTheme } from '@/lib/theme';

export type PortalDriftKind =
  'withdrawn_stock' | 'stale_expiry' | 'likely_lapsed' | 'details_drift';

export interface PortalDriftFinding {
  portal: string;
  portalListingId: string;
  listingUrl: string | null;
  expiresOn: string | null;
  propertyId: string;
  propertyTitle: string | null;
  propertyCode: string | null;
  propertyStatus: string | null;
  driftKind: PortalDriftKind;
  leadCount: number;
  lastLeadAt: string | null;
  parsedPropertyType: string | null;
  parsedPrice: number | null;
  parsedAreaSqft: number | null;
  listingType: string | null;
  listingPrice: number | null;
  listingAreaSqft: number | null;
}

const PORTAL_LABELS: Record<string, string> = {
  '99acres': '99acres',
  magicbricks: 'MagicBricks',
  housing: 'Housing.com',
};

const DISMISS_KEY_PREFIX = 'convoreal.portalDrift.dismissed:v1';

function findingSignature(findings: PortalDriftFinding[]): string {
  return [...findings]
    .map(
      (f) =>
        `${f.portal}|${f.portalListingId}|${f.propertyId}|${f.driftKind}|${f.propertyStatus ?? ''}`
    )
    .sort()
    .join('::');
}

function expiryLabel(expiresOn: string | null): string {
  if (!expiresOn) return 'its expiry';
  return new Date(`${expiresOn}T00:00:00`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function findingHeadline(f: PortalDriftFinding): string {
  switch (f.driftKind) {
    case 'withdrawn_stock':
      return 'Ad live on withdrawn stock';
    case 'stale_expiry':
      return 'Leads after the recorded expiry';
    case 'likely_lapsed':
      return 'Ad probably lapsed';
    case 'details_drift':
      return 'Ad and listing disagree';
  }
}

function findingDetail(f: PortalDriftFinding): string {
  const leads = `${f.leadCount} lead${f.leadCount === 1 ? '' : 's'}`;
  switch (f.driftKind) {
    case 'withdrawn_stock':
      return `${leads} in the last 30 days, but the listing is ${f.propertyStatus}. You are paying for an ad on withdrawn stock — take it down, then mark it removed.`;
    case 'stale_expiry':
      return `${leads} arrived after ${expiryLabel(f.expiresOn)}, so the ad is still live and the recorded expiry is stale. Update the expiry date below.`;
    case 'likely_lapsed':
      return `No leads since it expired on ${expiryLabel(f.expiresOn)}. Renew it on the portal, or mark it removed.`;
    case 'details_drift': {
      const pairs: string[] = [];
      if (f.parsedPropertyType && f.listingType) {
        pairs.push(`${f.parsedPropertyType} vs ${f.listingType}`);
      }
      if (f.parsedPrice !== null && f.listingPrice !== null) {
        pairs.push(
          `${formatInr(f.parsedPrice)} vs ${formatInr(f.listingPrice)}`
        );
      }
      if (f.parsedAreaSqft !== null && f.listingAreaSqft !== null) {
        pairs.push(`${f.parsedAreaSqft} vs ${f.listingAreaSqft} sq ft`);
      }
      return `Its last lead email says ${pairs.join(', ')} (ad vs listing) — one side was edited and the other was not.`;
    }
  }
}

/**
 * Web parity: mapped portal ads whose recorded state has diverged from
 * reality (src/components/inventory/portal-drift-panel.tsx). The four
 * checks live server-side in portal_listing_drift (migration 267), so
 * both surfaces read the same findings rather than each deciding what
 * counts as drift. Stateless — fixing the condition clears the row.
 */
export function PortalDriftPanel({ style }: { style?: ViewStyle }) {
  const { colors, fonts: f } = useTheme();
  const router = useRouter();
  const accountId = useAuthStore((s) => s.profile?.account_id);
  const storageKey = accountId ? `${DISMISS_KEY_PREFIX}:${accountId}` : null;
  const [isDismissed, setIsDismissed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [sheetPropertyId, setSheetPropertyId] = useState<string | null>(null);

  const { data: findings, isLoading } = useQuery({
    queryKey: ['portal-drift'],
    queryFn: async () => {
      const { data } = await apiFetch<{ data: PortalDriftFinding[] }>(
        '/api/portals/drift'
      );
      return data ?? [];
    },
    staleTime: 5 * 60_000,
  });

  const active = findings ?? [];
  const signature = findingSignature(active);

  useEffect(() => {
    if (!storageKey) {
      setIsDismissed(false);
      return;
    }

    if (isLoading) return;

    if (active.length === 0) {
      void AsyncStorage.removeItem(storageKey).then(() => {
        if (!storageKey) return;
        setIsDismissed(false);
      });
      return;
    }

    let cancelled = false;
    void AsyncStorage.getItem(storageKey).then((dismissedSignature) => {
      if (cancelled) return;
      if (dismissedSignature !== signature) {
        void AsyncStorage.removeItem(storageKey).then(() => {
          if (!cancelled) setIsDismissed(false);
        });
        return;
      }
      setIsDismissed(true);
    });

    return () => {
      cancelled = true;
    };
  }, [active.length, isLoading, signature, storageKey]);

  async function hidePanel() {
    if (!storageKey) return;
    await AsyncStorage.setItem(storageKey, signature);
    setIsDismissed(true);
  }

  if (!active || active.length === 0 || isDismissed) return null;

  return (
    <View
      style={[
        styles.panel,
        { backgroundColor: colors.warningSoft, borderColor: colors.warning },
        style,
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Ionicons name="warning-outline" size={15} color={colors.warning} />
        <Text
          style={{
            flex: 1,
            flexShrink: 1,
            fontSize: 13,
            fontFamily: f.bold,
            color: colors.text,
          }}
          numberOfLines={2}
        >
          {driftHeadline(active.length)}
        </Text>
        <Pressable
          onPress={() => {
            haptic.tap();
            setExpanded((v) => !v);
          }}
          accessibilityRole="button"
          accessibilityLabel={
            expanded
              ? 'Hide portal discrepancies'
              : 'Review portal discrepancies'
          }
          accessibilityState={{ expanded }}
          hitSlop={8}
          style={{
            marginLeft: 'auto',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 2,
            height: 28,
            paddingHorizontal: 12,
            borderRadius: 14,
            backgroundColor: colors.warning,
          }}
        >
          <Text
            style={{
              fontSize: 12,
              fontFamily: f.bold,
              color: colors.onWarning,
            }}
          >
            {driftToggleLabel(expanded)}
          </Text>
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={13}
            color={colors.onWarning}
          />
        </Pressable>
        <Pressable
          onPress={hidePanel}
          accessibilityRole="button"
          accessibilityLabel="Dismiss portal discrepancy banner"
          hitSlop={8}
          style={{
            width: 26,
            height: 26,
            borderRadius: 13,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: colors.warning,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="close" size={14} color={colors.warning} />
        </Pressable>
      </View>
      {expanded ? (
        <Text style={{ fontSize: 12, color: colors.textMuted }}>
          Spotted from the leads and emails already in the Engine. Each row
          clears itself once the ad and the listing agree again.
        </Text>
      ) : null}

      {expanded &&
        active.map((item) => (
          <View
            key={`${item.portal}:${item.portalListingId}:${item.driftKind}`}
            style={[
              styles.row,
              {
                backgroundColor: colors.surfaceRaised,
                borderColor: colors.glassBorder,
              },
            ]}
          >
            <View style={{ gap: 2 }}>
              <Text
                style={{
                  fontSize: 13.5,
                  fontFamily: f.bold,
                  color: colors.text,
                }}
              >
                {findingHeadline(item)}
              </Text>
              <Text
                style={{ fontSize: 12.5, color: colors.text }}
                numberOfLines={2}
              >
                {PORTAL_LABELS[item.portal] || item.portal} ad{' '}
                {item.portalListingId} ·{' '}
                {item.propertyTitle || 'Untitled listing'}
                {item.propertyCode ? ` (${item.propertyCode})` : ''}
              </Text>
              <Text style={{ fontSize: 12.5, color: colors.textMuted }}>
                {findingDetail(item)}
              </Text>
            </View>
            <View style={styles.actions}>
              <Pressable
                onPress={() => {
                  haptic.tap();
                  setSheetPropertyId(item.propertyId);
                }}
                accessibilityRole="button"
                accessibilityLabel={`Update portal listing for ${item.propertyTitle || 'this listing'}`}
                style={[
                  styles.actionButton,
                  {
                    borderColor: colors.warning,
                    backgroundColor: colors.warning,
                  },
                ]}
              >
                <Text
                  style={{
                    fontSize: 12,
                    fontFamily: f.bold,
                    color: colors.onWarning,
                  }}
                >
                  Update portal listing
                </Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  haptic.tap();
                  router.push(propertyHref(item.propertyId) as never);
                }}
                accessibilityRole="button"
                accessibilityLabel="Open listing"
                style={[styles.actionButton, { borderColor: colors.warning }]}
              >
                <Text
                  style={{
                    fontSize: 12,
                    fontFamily: f.bold,
                    color: colors.text,
                  }}
                >
                  Open listing
                </Text>
              </Pressable>
              {item.listingUrl ? (
                <Pressable
                  onPress={() => {
                    haptic.tap();
                    void Linking.openURL(item.listingUrl as string);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Open the ${PORTAL_LABELS[item.portal] || item.portal} ad ${item.portalListingId}`}
                  style={[styles.actionButton, { borderColor: colors.warning }]}
                >
                  <Text
                    style={{
                      fontSize: 12,
                      fontFamily: f.bold,
                      color: colors.text,
                    }}
                  >
                    View ad
                  </Text>
                  <Ionicons name="open-outline" size={13} color={colors.text} />
                </Pressable>
              ) : null}
            </View>
          </View>
        ))}
      <PortalExpirySheet
        visible={sheetPropertyId !== null}
        onClose={() => setSheetPropertyId(null)}
        propertyId={sheetPropertyId ?? ''}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  row: {
    gap: spacing.sm,
    padding: 10,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
});
