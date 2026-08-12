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

import { AppDialog, useAppDialog } from '@/components/app-dialog';
import { BottomSheet, sheetScrollArea } from '@/components/sheet';
import { SectionLabel } from '@/components/ui';
import { apiFetch } from '@/lib/api';
import { gateRequestStatusLabel } from '@/lib/gate-stats';
import { haptic } from '@/lib/haptics';
import { queryClient } from '@/lib/query';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { Property } from '@/lib/types';

interface GateRequest {
  id: string;
  requester_name: string;
  requester_phone: string;
  status: string;
  scope?: string;
  identity_protected?: boolean;
  created_at: string;
  approved_at: string | null;
}

interface ActiveGrant {
  id: string;
  expires_at: string;
  view_count: number | null;
  last_viewed_at: string | null;
  contact?: { id: string; name: string | null; phone: string | null } | null;
}

const fmt = (iso: string | null | undefined): string =>
  iso
    ? new Date(iso).toLocaleString('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : '—';

/**
 * Who asked to open a confidential listing, and who still can.
 *
 * The counts on the card say how much demand there is; this says who,
 * and carries the one action they imply — revoking a key that is still
 * live. The phone had the counts and not the action, which left an
 * agent away from a desk able to see that someone could open a listing
 * and unable to stop them.
 */
export function GateRequestsSheet({
  property,
  visible,
  onClose,
}: {
  property: Property;
  visible: boolean;
  onClose: () => void;
}) {
  const { colors, fonts: f } = useTheme();
  const { show, close, dialogProps } = useAppDialog();
  const [revoking, setRevoking] = useState<string | null>(null);

  const requests = useQuery({
    queryKey: ['gate-requests', property.id],
    enabled: visible,
    queryFn: () =>
      apiFetch<{ data: GateRequest[] }>(
        `/api/properties/${property.id}/location-requests`
      ),
    select: (r) => (r.data ?? []).filter((x) => x.scope === 'listing'),
  });

  // The route already excludes revoked and expired grants, so every row
  // here is a key that opens the listing right now.
  const grants = useQuery({
    queryKey: ['gate-grants', property.id],
    enabled: visible,
    queryFn: () =>
      apiFetch<{ data: ActiveGrant[] }>(
        `/api/properties/${property.id}/share-grants`
      ),
    select: (r) => r.data ?? [],
  });

  async function revoke(grant: ActiveGrant) {
    setRevoking(grant.id);
    try {
      await apiFetch(
        `/api/properties/${property.id}/share-grants?grant_id=${grant.id}`,
        { method: 'DELETE' }
      );
      haptic.success();
      await Promise.all([
        grants.refetch(),
        queryClient.invalidateQueries({
          queryKey: ['properties', 'gate-stats'],
        }),
      ]);
    } catch (err) {
      haptic.warn();
      show({
        title: 'Could not revoke',
        message: err instanceof Error ? err.message : 'Please try again.',
      });
    } finally {
      setRevoking(null);
    }
  }

  function confirmRevoke(grant: ActiveGrant) {
    haptic.tap();
    const who = grant.contact?.name || grant.contact?.phone || 'this link';
    show({
      title: 'Revoke access?',
      message: `The page closes for ${who} and their photos stop loading. It cannot recall what they already saved.`,
      actions: [
        { label: 'Cancel', variant: 'muted', onPress: close },
        {
          label: 'Revoke',
          variant: 'destructive',
          onPress: () => {
            close();
            void revoke(grant);
          },
        },
      ],
    });
  }

  const loading = requests.isLoading || grants.isLoading;
  const live = grants.data ?? [];
  const rows = requests.data ?? [];

  return (
    <>
      <BottomSheet visible={visible} onClose={onClose} title={property.title}>
        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <ScrollView
            style={sheetScrollArea}
            contentContainerStyle={{
              gap: spacing.lg,
              paddingBottom: spacing.md,
            }}
          >
            <View style={{ gap: spacing.sm }}>
              <SectionLabel text={`Who can open it now (${live.length})`} />
              {live.length === 0 ? (
                <Text style={[styles.empty, { color: colors.textMuted }]}>
                  Nobody. The link shows only the stub to everyone.
                </Text>
              ) : (
                live.map((g) => (
                  <View
                    key={g.id}
                    style={[
                      styles.card,
                      {
                        backgroundColor: colors.glass,
                        borderColor: colors.glassBorder,
                      },
                    ]}
                  >
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text
                        style={{
                          fontSize: 13.5,
                          fontFamily: f.bold,
                          color: colors.text,
                        }}
                        numberOfLines={1}
                      >
                        {g.contact?.name ||
                          g.contact?.phone ||
                          'Anyone with the link'}
                      </Text>
                      <Text style={[styles.meta, { color: colors.textMuted }]}>
                        Expires {fmt(g.expires_at)}
                      </Text>
                      <Text style={[styles.meta, { color: colors.textMuted }]}>
                        {g.view_count ?? 0} view
                        {(g.view_count ?? 0) === 1 ? '' : 's'}
                        {g.last_viewed_at
                          ? ` · last ${fmt(g.last_viewed_at)}`
                          : ''}
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => confirmRevoke(g)}
                      disabled={revoking === g.id}
                      accessibilityRole="button"
                      accessibilityLabel={`Revoke access for ${
                        g.contact?.name || g.contact?.phone || 'this link'
                      }`}
                      accessibilityState={{ busy: revoking === g.id }}
                      style={({ pressed }) => [
                        styles.revoke,
                        {
                          borderColor: colors.danger,
                          opacity: pressed || revoking === g.id ? 0.6 : 1,
                        },
                      ]}
                    >
                      {revoking === g.id ? (
                        <ActivityIndicator size="small" color={colors.danger} />
                      ) : (
                        <Ionicons
                          name="shield-outline"
                          size={14}
                          color={colors.danger}
                        />
                      )}
                      <Text
                        style={{
                          fontSize: 12.5,
                          fontFamily: f.bold,
                          color: colors.danger,
                        }}
                      >
                        Revoke
                      </Text>
                    </Pressable>
                  </View>
                ))
              )}
            </View>

            <View style={{ gap: spacing.sm }}>
              <SectionLabel text={`Requests (${rows.length})`} />
              {rows.length === 0 ? (
                <Text style={[styles.empty, { color: colors.textMuted }]}>
                  Nobody has asked for access yet.
                </Text>
              ) : (
                rows.map((r) => (
                  <View
                    key={r.id}
                    style={[
                      styles.card,
                      {
                        backgroundColor: colors.glass,
                        borderColor: colors.glassBorder,
                      },
                    ]}
                  >
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text
                        style={{
                          fontSize: 13.5,
                          fontFamily: f.bold,
                          color: colors.text,
                        }}
                        numberOfLines={1}
                      >
                        {r.requester_name}
                      </Text>
                      <Text style={[styles.meta, { color: colors.textMuted }]}>
                        {r.requester_phone}
                      </Text>
                      {/* Masking is enforced server side; this only
                          explains why the name is not the buyer's. */}
                      {r.identity_protected ? (
                        <Text
                          style={[
                            styles.meta,
                            { color: colors.textMuted, fontStyle: 'italic' },
                          ]}
                        >
                          Came through a co-broker — their client&apos;s details
                          stay private
                        </Text>
                      ) : null}
                      <Text style={[styles.meta, { color: colors.textMuted }]}>
                        Asked {fmt(r.created_at)}
                        {r.approved_at
                          ? ` · approved ${fmt(r.approved_at)}`
                          : ''}
                      </Text>
                    </View>
                    <Text
                      style={{
                        fontSize: 11,
                        fontFamily: f.bold,
                        color:
                          r.status === 'approved'
                            ? colors.success
                            : r.status === 'pending'
                              ? colors.warning
                              : r.status === 'rejected'
                                ? colors.danger
                                : colors.textMuted,
                      }}
                    >
                      {gateRequestStatusLabel(r.status)}
                    </Text>
                  </View>
                ))
              )}
            </View>

            <Text style={[styles.meta, { color: colors.textMuted }]}>
              Approve or reject from the WhatsApp ping, or from the approvals
              panel on the home screen.
            </Text>
          </ScrollView>
        )}
      </BottomSheet>
      <AppDialog {...dialogProps} />
    </>
  );
}

const styles = StyleSheet.create({
  loading: { paddingVertical: spacing.xl, alignItems: 'center' },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  revoke: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  empty: { fontSize: 12.5 },
  meta: { fontSize: 11.5 },
});
