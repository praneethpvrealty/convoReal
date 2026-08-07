import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppDialog, useAppDialog } from '@/components/app-dialog';
import { SectionLabel } from '@/components/ui';
import { apiFetch } from '@/lib/api';
import { chatListTime } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { queryClient } from '@/lib/query';
import { radius, spacing, useTheme } from '@/lib/theme';

interface LocationApprovalRow {
  id: string;
  property_id: string;
  property_title: string;
  property_code: string | null;
  requester_name: string;
  requester_phone: string;
  identity_protected: boolean;
  via_contact_name: string | null;
  status: string;
  pending_consent_contact_name: string | null;
  created_at: string;
}

export const LOCATION_APPROVALS_QUERY_KEY = 'location-approvals';

function statusLine(row: LocationApprovalRow): { text: string; tone: 'warn' | 'wait' | 'ok' | 'muted' } {
  if (row.status === 'pending' && row.pending_consent_contact_name) {
    return { text: `Awaiting ${row.pending_consent_contact_name}`, tone: 'wait' };
  }
  if (row.status === 'pending') return { text: 'Your decision', tone: 'warn' };
  if (row.status === 'approved') return { text: 'Approved · link sent', tone: 'ok' };
  if (row.status === 'rejected') return { text: 'Rejected', tone: 'muted' };
  return { text: 'Timed out', tone: 'muted' };
}

/** Guarded-location reveal requests with inline Approve/Reject —
 *  the mobile arm of the web dashboard's approvals panel. Hidden
 *  when the account has no requests. */
export function LocationApprovals() {
  const { colors, fonts: f } = useTheme();
  const [processingId, setProcessingId] = useState<string | null>(null);
  const { show, dialogProps } = useAppDialog();

  const { data } = useQuery({
    queryKey: [LOCATION_APPROVALS_QUERY_KEY],
    staleTime: 30_000,
    queryFn: () =>
      apiFetch<{ data: LocationApprovalRow[] }>('/api/location-requests?limit=10'),
  });
  const rows = data?.data ?? [];
  if (rows.length === 0) return null;

  const act = async (row: LocationApprovalRow, action: 'approve' | 'reject') => {
    haptic.tap();
    setProcessingId(row.id);
    try {
      await apiFetch(`/api/properties/${row.property_id}/location-requests`, {
        method: 'PATCH',
        body: JSON.stringify({ request_id: row.id, action }),
      });
      haptic.success();
      await queryClient.invalidateQueries({ queryKey: [LOCATION_APPROVALS_QUERY_KEY] });
    } catch (err) {
      haptic.warn();
      show({
        title: action === 'approve' ? 'Approval failed' : 'Rejection failed',
        message: err instanceof Error ? err.message : 'Please try again.',
      });
    } finally {
      setProcessingId(null);
    }
  };

  const toneColor = { warn: colors.danger, wait: colors.primary, ok: colors.primary, muted: colors.textMuted };

  return (
    <View style={{ gap: spacing.sm }}>
      <SectionLabel text="Location approvals" />
      {rows.map((row) => {
        const s = statusLine(row);
        const actionable = row.status === 'pending' && !row.pending_consent_contact_name;
        return (
          <View
            key={row.id}
            style={[styles.card, { backgroundColor: colors.glass, borderColor: colors.glassBorder }]}
          >
            <View style={styles.head}>
              <Ionicons name="location-outline" size={17} color={colors.primary} />
              <Text
                style={{ flex: 1, fontSize: 14, fontFamily: f.bold, color: colors.text }}
                numberOfLines={1}
              >
                {row.property_title}
                {row.property_code ? `  ·  ${row.property_code}` : ''}
              </Text>
              <Text style={{ fontSize: 11, color: colors.textFaint }}>
                {chatListTime(row.created_at)}
              </Text>
            </View>
            <View style={styles.head}>
              <Ionicons name="person-outline" size={13} color={colors.textMuted} />
              <Text style={{ flex: 1, fontSize: 12.5, color: colors.textMuted }} numberOfLines={1}>
                {row.requester_name} · {row.requester_phone}
                {row.identity_protected ? '  🔒' : ''}
              </Text>
            </View>
            <Text style={{ fontSize: 12, fontFamily: f.bold, color: toneColor[s.tone] }}>
              {s.text}
              {row.via_contact_name ? `  ·  via ${row.via_contact_name}` : ''}
            </Text>
            {actionable ? (
              <View style={styles.actions}>
                <Pressable
                  onPress={() => act(row, 'approve')}
                  disabled={processingId === row.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Approve location request for ${row.property_title}`}
                  style={({ pressed }) => [
                    styles.button,
                    { backgroundColor: colors.primary, opacity: processingId === row.id ? 0.5 : pressed ? 0.8 : 1 },
                  ]}
                >
                  <Ionicons name="checkmark" size={15} color={colors.onPrimary} />
                  <Text
                    style={[styles.buttonText, { fontFamily: f.bold, color: colors.onPrimary }]}
                  >
                    Approve
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => act(row, 'reject')}
                  disabled={processingId === row.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Reject location request for ${row.property_title}`}
                  style={({ pressed }) => [
                    styles.button,
                    styles.rejectButton,
                    { borderColor: colors.danger, opacity: processingId === row.id ? 0.5 : pressed ? 0.8 : 1 },
                  ]}
                >
                  <Ionicons name="close" size={15} color={colors.danger} />
                  <Text style={[styles.buttonText, { color: colors.danger, fontFamily: f.bold }]}>
                    Reject
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        );
      })}
      <AppDialog {...dialogProps} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: 6,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: 2 },
  button: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderRadius: radius.md,
    paddingVertical: 8,
  },
  rejectButton: { backgroundColor: 'transparent', borderWidth: 1 },
  buttonText: { fontSize: 13 },
});
