import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  documentApprovalCopy,
  documentApprovalStage,
  documentDecisionLabel,
  documentRequestWaitLabel,
  groupDocumentApprovals,
  type DocumentApprovalGroup,
  type DocumentApprovalRow,
} from '@shared/lib/dashboard/document-approvals';

import { AppDialog, useAppDialog } from '@/components/app-dialog';
import { SectionLabel } from '@/components/ui';
import { apiFetch } from '@/lib/api';
import { chatListTime } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { queryClient } from '@/lib/query';
import { radius, spacing, useTheme } from '@/lib/theme';

export const DOCUMENT_APPROVALS_QUERY_KEY = 'document-approvals';

type Decision = 'approve' | 'reject';

export function DocumentApprovals() {
  const { colors, fonts: f } = useTheme();
  const { show, close, dialogProps } = useAppDialog();
  const [processing, setProcessing] = useState<Set<string>>(new Set());
  const [showDecided, setShowDecided] = useState(false);
  const { data } = useQuery({
    queryKey: [DOCUMENT_APPROVALS_QUERY_KEY],
    staleTime: 30_000,
    queryFn: () =>
      apiFetch<{ data: DocumentApprovalRow[] }>(
        '/api/document-requests?limit=10'
      ),
  });
  const rows = data?.data ?? [];
  const now = new Date();
  const { open, decided } = groupDocumentApprovals(rows, now);
  const pendingCount = open.reduce((sum, group) => sum + group.rows.length, 0);

  function markProcessing(ids: string[], busy: boolean) {
    setProcessing((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (busy) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  async function act(targets: DocumentApprovalRow[], action: Decision) {
    const ids = targets.map((row) => row.id);
    markProcessing(ids, true);
    let delivered = 0;
    let done = 0;
    let failure: string | null = null;
    try {
      for (const row of targets) {
        try {
          const result = await apiFetch<{ delivered?: boolean }>(
            `/api/properties/${row.property_id}/document-requests`,
            {
              method: 'PATCH',
              body: JSON.stringify({ request_id: row.id, action }),
            }
          );
          done += 1;
          if (result.delivered) delivered += 1;
        } catch (error) {
          failure =
            error instanceof Error ? error.message : 'Please try again.';
        }
      }
      if (failure && done === 0) {
        haptic.warn();
        show({
          title: action === 'approve' ? 'Approval failed' : 'Rejection failed',
          message: failure,
        });
      } else {
        haptic.success();
        show({
          title:
            action === 'approve'
              ? targets.length === 1
                ? 'Documents approved'
                : `Approved ${done} of ${targets.length}`
              : targets.length === 1
                ? 'Request closed'
                : `Closed ${done} of ${targets.length}`,
          message:
            action === 'approve'
              ? targets.length === 1
                ? delivered === 1
                  ? 'A secure document link was sent to the requester on WhatsApp.'
                  : 'Approved, but WhatsApp delivery needs your follow-up.'
                : `${delivered} link${delivered === 1 ? '' : 's'} sent on WhatsApp.${failure ? ` ${failure}` : ''}`
              : failure
                ? failure
                : 'The requester will not receive the property documents.',
        });
      }
      await queryClient.invalidateQueries({
        queryKey: [DOCUMENT_APPROVALS_QUERY_KEY],
      });
    } finally {
      markProcessing(ids, false);
    }
  }

  function confirmReject(
    targets: DocumentApprovalRow[],
    group: DocumentApprovalGroup<DocumentApprovalRow>
  ) {
    haptic.tap();
    const label = documentApprovalCopy(targets[0], now).reject;
    show({
      title:
        targets.length === 1
          ? `${label} document access?`
          : `${label} all ${targets.length} requests?`,
      message: `${group.requester_name} will not receive the property documents.`,
      actions: [
        { label: 'Cancel', variant: 'muted', onPress: close },
        {
          label,
          variant: 'destructive',
          onPress: () => {
            close();
            void act(targets, 'reject');
          },
        },
      ],
    });
  }

  function renderRequest(
    row: DocumentApprovalRow,
    group: DocumentApprovalGroup<DocumentApprovalRow>
  ) {
    const stale = documentApprovalStage(row, now) === 'stale';
    const copy = documentApprovalCopy(row, now);
    const busy = processing.has(row.id);
    const secondary = stale || row.document_count === 0;
    return (
      <View
        key={row.id}
        style={[
          styles.request,
          {
            borderColor: colors.glassBorder,
            backgroundColor: colors.surfaceSunken,
          },
        ]}
      >
        <View style={styles.head}>
          <Pressable
            onPress={() => router.push(`/(app)/property/${row.property_id}`)}
            accessibilityRole="link"
            accessibilityLabel={`Open ${row.property_title}`}
            style={{ flex: 1 }}
          >
            <Text
              style={{ fontSize: 13.5, fontFamily: f.bold, color: colors.text }}
              numberOfLines={1}
            >
              {row.property_title}
              {row.property_code ? ` · ${row.property_code}` : ''}
            </Text>
          </Pressable>
          <View
            style={[
              styles.chip,
              {
                backgroundColor: stale ? colors.dangerSoft : colors.warningSoft,
              },
            ]}
          >
            <Text
              style={{
                fontSize: 10.5,
                fontFamily: f.bold,
                color: stale ? colors.danger : colors.warning,
              }}
            >
              {documentRequestWaitLabel(row, now)}
            </Text>
          </View>
        </View>
        <Text style={{ fontSize: 11.5, color: colors.textFaint }}>
          Requested {chatListTime(row.created_at)} ·{' '}
          <Text
            style={{
              color:
                row.document_count === 0 ? colors.warning : colors.textMuted,
            }}
          >
            {row.document_count === 0
              ? 'No documents uploaded'
              : `${row.document_count} ${row.document_count === 1 ? 'document' : 'documents'}`}
          </Text>
        </Text>
        {copy.hint ? (
          <View style={styles.hint}>
            <Ionicons name="warning-outline" size={13} color={colors.warning} />
            <Text style={{ flex: 1, fontSize: 11.5, color: colors.warning }}>
              {copy.hint}
              {row.document_count === 0 ? (
                <Text
                  onPress={() =>
                    router.push(`/(app)/property-edit?id=${row.property_id}`)
                  }
                  style={{
                    fontFamily: f.bold,
                    textDecorationLine: 'underline',
                  }}
                >
                  {' '}
                  Upload documents
                </Text>
              ) : null}
            </Text>
          </View>
        ) : null}
        <View style={styles.actions}>
          <Pressable
            onPress={() => confirmReject([row], group)}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={`${copy.reject} document request for ${row.property_title}`}
            style={({ pressed }) => [
              styles.reject,
              { opacity: busy ? 0.5 : pressed ? 0.6 : 0.85 },
            ]}
          >
            <Text
              style={[
                styles.buttonText,
                { fontFamily: f.medium, color: colors.danger },
              ]}
            >
              {copy.reject}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              haptic.tap();
              void act([row], 'approve');
            }}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={`${copy.approve} for ${row.property_title}`}
            style={({ pressed }) => [
              styles.button,
              secondary
                ? { borderWidth: 1, borderColor: colors.primary }
                : { backgroundColor: colors.primary },
              { opacity: busy ? 0.5 : pressed ? 0.8 : 1 },
            ]}
          >
            <Ionicons
              name="checkmark"
              size={15}
              color={secondary ? colors.primary : colors.onPrimary}
            />
            <Text
              style={[
                styles.buttonText,
                {
                  fontFamily: f.bold,
                  color: secondary ? colors.primary : colors.onPrimary,
                },
              ]}
            >
              {copy.approve}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  function renderGroup(group: DocumentApprovalGroup<DocumentApprovalRow>) {
    const busy = group.rows.some((row) => processing.has(row.id));
    const multi = group.rows.length > 1;
    return (
      <View
        key={group.key}
        style={[
          styles.card,
          { backgroundColor: colors.glass, borderColor: colors.glassBorder },
        ]}
      >
        <View style={styles.head}>
          <Ionicons name="person-outline" size={16} color={colors.primary} />
          <Text
            style={{
              flex: 1,
              fontSize: 14,
              fontFamily: f.bold,
              color: colors.text,
            }}
            numberOfLines={1}
          >
            {group.requester_name}
            <Text style={{ fontFamily: f.regular, color: colors.textMuted }}>
              {' '}
              · {group.requester_phone}
            </Text>
          </Text>
          {multi ? (
            <Text style={{ fontSize: 11, color: colors.textFaint }}>
              {group.rows.length} properties
            </Text>
          ) : null}
        </View>
        {group.requester_email ? (
          <Text
            style={{ fontSize: 11.5, color: colors.textFaint }}
            numberOfLines={1}
          >
            {group.requester_email}
          </Text>
        ) : null}
        {group.rows.map((row) => renderRequest(row, group))}
        {multi ? (
          <View
            style={[
              styles.actions,
              styles.groupActions,
              { borderTopColor: colors.glassBorder },
            ]}
          >
            <Pressable
              onPress={() => confirmReject(group.rows, group)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={`${group.stale ? 'Dismiss' : 'Reject'} all document requests from ${group.requester_name}`}
              style={({ pressed }) => [
                styles.reject,
                { opacity: busy ? 0.5 : pressed ? 0.6 : 0.85 },
              ]}
            >
              <Text
                style={[
                  styles.buttonText,
                  { fontFamily: f.medium, color: colors.danger },
                ]}
              >
                {group.stale ? 'Dismiss all' : 'Reject all'}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                haptic.tap();
                void act(group.rows, 'approve');
              }}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={`Approve all document requests from ${group.requester_name}`}
              style={({ pressed }) => [
                styles.button,
                group.stale
                  ? { borderWidth: 1, borderColor: colors.primary }
                  : { backgroundColor: colors.primary },
                {
                  opacity: busy ? 0.5 : pressed ? 0.8 : 1,
                },
              ]}
            >
              <Text
                style={[
                  styles.buttonText,
                  {
                    fontFamily: f.bold,
                    color: group.stale ? colors.primary : colors.onPrimary,
                  },
                ]}
              >
                Approve all {group.rows.length}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    );
  }

  function renderDecided(row: DocumentApprovalRow) {
    const approved = row.status === 'approved';
    return (
      <View
        key={row.id}
        style={[
          styles.card,
          { backgroundColor: colors.glass, borderColor: colors.glassBorder },
        ]}
      >
        <View style={styles.head}>
          <Ionicons
            name={
              approved ? 'checkmark-circle-outline' : 'close-circle-outline'
            }
            size={17}
            color={approved ? colors.success : colors.textMuted}
          />
          <Text
            style={{
              flex: 1,
              fontSize: 14,
              fontFamily: f.bold,
              color: colors.text,
            }}
            numberOfLines={1}
            onPress={() => router.push(`/(app)/property/${row.property_id}`)}
          >
            {row.property_title}
            {row.property_code ? ` · ${row.property_code}` : ''}
          </Text>
          <Text style={{ fontSize: 11, color: colors.textFaint }}>
            {chatListTime(row.decided_at ?? row.created_at)}
          </Text>
        </View>
        <Text
          style={{ fontSize: 12.5, color: colors.textMuted }}
          numberOfLines={1}
        >
          {row.requester_name} · {row.requester_phone}
        </Text>
        <Text
          style={{
            fontSize: 12,
            fontFamily: f.bold,
            color: approved ? colors.success : colors.textMuted,
          }}
        >
          {documentDecisionLabel(row)}
        </Text>
      </View>
    );
  }

  if (rows.length === 0) {
    return <AppDialog {...dialogProps} />;
  }

  return (
    <>
      <View style={{ gap: spacing.sm }}>
        <SectionLabel
          text={
            pendingCount > 0
              ? `Document approvals (${pendingCount})`
              : 'Document approvals'
          }
        />
        {open.map(renderGroup)}
        {decided.length > 0 ? (
          <Pressable
            onPress={() => setShowDecided((v) => !v)}
            accessibilityRole="button"
            accessibilityState={{ expanded: showDecided }}
            style={styles.disclosure}
          >
            <Ionicons
              name={showDecided ? 'chevron-down' : 'chevron-forward'}
              size={14}
              color={colors.textMuted}
            />
            <Text
              style={{
                fontSize: 12.5,
                fontFamily: f.bold,
                color: colors.textMuted,
              }}
            >
              Recently decided ({decided.length})
            </Text>
          </Pressable>
        ) : null}
        {showDecided ? decided.map(renderDecided) : null}
      </View>
      <AppDialog {...dialogProps} />
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: 8,
  },
  request: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.sm,
    gap: 6,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  hint: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: 2,
  },
  groupActions: { borderTopWidth: 1, paddingTop: spacing.sm },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderRadius: radius.md,
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
  },
  reject: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  disclosure: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
  },
  buttonText: { fontSize: 13 },
});
