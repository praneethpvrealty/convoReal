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

interface DocumentApprovalRow {
  id: string;
  property_id: string;
  property_title: string;
  property_code: string | null;
  requester_name: string;
  requester_phone: string;
  requester_email: string | null;
  status: string;
  share_sent_at: string | null;
  created_at: string;
}

export const DOCUMENT_APPROVALS_QUERY_KEY = 'document-approvals';

export function DocumentApprovals() {
  const { colors, fonts: f } = useTheme();
  const { show, close, dialogProps } = useAppDialog();
  const [processingId, setProcessingId] = useState<string | null>(null);
  const { data } = useQuery({
    queryKey: [DOCUMENT_APPROVALS_QUERY_KEY],
    staleTime: 30_000,
    queryFn: () =>
      apiFetch<{ data: DocumentApprovalRow[] }>(
        '/api/document-requests?limit=10'
      ),
  });
  const rows = data?.data ?? [];
  const pendingCount = rows.length;

  async function act(row: DocumentApprovalRow, action: 'approve' | 'reject') {
    setProcessingId(row.id);
    try {
      const result = await apiFetch<{ delivered?: boolean }>(
        `/api/properties/${row.property_id}/document-requests`,
        {
          method: 'PATCH',
          body: JSON.stringify({ request_id: row.id, action }),
        }
      );
      haptic.success();
      show({
        title: action === 'approve' ? 'Documents approved' : 'Request rejected',
        message:
          action === 'approve'
            ? result.delivered
              ? 'A secure document link was sent to the requester on WhatsApp.'
              : 'Approved, but WhatsApp delivery needs your follow-up.'
            : 'The document request has been closed.',
      });
      await queryClient.invalidateQueries({
        queryKey: [DOCUMENT_APPROVALS_QUERY_KEY],
      });
    } catch (error) {
      haptic.warn();
      show({
        title: action === 'approve' ? 'Approval failed' : 'Rejection failed',
        message: error instanceof Error ? error.message : 'Please try again.',
      });
    } finally {
      setProcessingId(null);
    }
  }

  function confirmReject(row: DocumentApprovalRow) {
    haptic.tap();
    show({
      title: 'Reject document access?',
      message: `${row.requester_name} will not receive the property documents.`,
      actions: [
        { label: 'Cancel', variant: 'muted', onPress: close },
        {
          label: 'Reject',
          variant: 'destructive',
          onPress: () => {
            close();
            void act(row, 'reject');
          },
        },
      ],
    });
  }

  return (
    <>
      {rows.length > 0 ? (
        <View style={{ gap: spacing.sm }}>
          <SectionLabel text={`Document approvals (${pendingCount})`} />
          {rows.map((row) => {
            const pending = row.status === 'pending';
            const busy = processingId === row.id;
            return (
              <View
                key={row.id}
                style={[
                  styles.card,
                  {
                    backgroundColor: colors.glass,
                    borderColor: colors.glassBorder,
                  },
                ]}
              >
                <View style={styles.head}>
                  <Ionicons
                    name="document-text-outline"
                    size={17}
                    color={colors.primary}
                  />
                  <Text
                    style={{
                      flex: 1,
                      fontSize: 14,
                      fontFamily: f.bold,
                      color: colors.text,
                    }}
                    numberOfLines={1}
                  >
                    {row.property_title}
                    {row.property_code ? ` · ${row.property_code}` : ''}
                  </Text>
                  <Text style={{ fontSize: 11, color: colors.textFaint }}>
                    {chatListTime(row.created_at)}
                  </Text>
                </View>
                <Text
                  style={{ fontSize: 12.5, color: colors.textMuted }}
                  numberOfLines={1}
                >
                  {row.requester_name} · {row.requester_phone}
                </Text>
                {row.requester_email ? (
                  <Text
                    style={{ fontSize: 11.5, color: colors.textFaint }}
                    numberOfLines={1}
                  >
                    {row.requester_email}
                  </Text>
                ) : null}
                {!pending ? (
                  <Text
                    style={{
                      fontSize: 12,
                      fontFamily: f.bold,
                      color:
                        row.status === 'approved'
                          ? colors.success
                          : colors.textMuted,
                    }}
                  >
                    {row.status === 'approved'
                      ? row.share_sent_at
                        ? 'Approved · link sent'
                        : 'Approved · follow up'
                      : 'Rejected'}
                  </Text>
                ) : (
                  <View style={styles.actions}>
                    <Pressable
                      onPress={() => void act(row, 'approve')}
                      disabled={busy}
                      accessibilityRole="button"
                      accessibilityLabel={`Approve document request for ${row.property_title}`}
                      style={({ pressed }) => [
                        styles.button,
                        {
                          backgroundColor: colors.primary,
                          opacity: busy ? 0.5 : pressed ? 0.8 : 1,
                        },
                      ]}
                    >
                      <Ionicons
                        name="checkmark"
                        size={15}
                        color={colors.onPrimary}
                      />
                      <Text
                        style={[
                          styles.buttonText,
                          { fontFamily: f.bold, color: colors.onPrimary },
                        ]}
                      >
                        Approve
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => confirmReject(row)}
                      disabled={busy}
                      accessibilityRole="button"
                      accessibilityLabel={`Reject document request for ${row.property_title}`}
                      style={({ pressed }) => [
                        styles.button,
                        styles.reject,
                        {
                          borderColor: colors.danger,
                          opacity: busy ? 0.5 : pressed ? 0.8 : 1,
                        },
                      ]}
                    >
                      <Ionicons name="close" size={15} color={colors.danger} />
                      <Text
                        style={[
                          styles.buttonText,
                          { fontFamily: f.bold, color: colors.danger },
                        ]}
                      >
                        Reject
                      </Text>
                    </Pressable>
                  </View>
                )}
              </View>
            );
          })}
        </View>
      ) : null}
      <AppDialog {...dialogProps} />
    </>
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
  reject: { backgroundColor: 'transparent', borderWidth: 1 },
  buttonText: { fontSize: 13 },
});
