import { useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

import { AppDialog, useAppDialog } from '@/components/app-dialog';
import { ConvoRealLoader } from '@/components/loader';
import { Banner, EmptyState } from '@/components/ui';
import { ApiError, apiFetch } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { haptic } from '@/lib/haptics';
import { queryClient } from '@/lib/query';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { AutomationRow, FlowRow } from '@/lib/types';
import { usePullRefresh } from '@/lib/use-pull-refresh';
import { describeIssue } from '@shared/lib/automations/step-tree';
import {
  isTriggerAvailable,
  triggerActivationSentence,
  triggerLabel,
} from '@shared/lib/automations/trigger-meta';

export default function AutomationsScreen() {
  const { colors, fonts: f } = useTheme();
  const profile = useAuthStore((s) => s.profile);
  const canEdit = Boolean(
    profile && profile.account_role !== 'viewer' && !profile.is_read_only
  );
  const [error, setError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const { show, close, dialogProps } = useAppDialog();

  const automationsQuery = useQuery({
    queryKey: ['automations'],
    queryFn: async () =>
      (await apiFetch<{ automations: AutomationRow[] }>('/api/automations'))
        .automations,
  });
  const flowsQuery = useQuery({
    queryKey: ['flows'],
    queryFn: async () =>
      (await apiFetch<{ flows: FlowRow[] }>('/api/flows')).flows,
  });

  async function toggle(automation: AutomationRow, next: boolean) {
    haptic.tap();
    setError(null);
    setTogglingId(automation.id);
    try {
      // The API route validates trigger/steps before allowing activation
      // — that's why this isn't a direct table update.
      await apiFetch(`/api/automations/${automation.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: next }),
      });
      queryClient.invalidateQueries({ queryKey: ['automations'] });
    } catch (err) {
      setError(toggleErrorText(err));
    } finally {
      setTogglingId(null);
    }
  }

  function requestToggle(automation: AutomationRow, next: boolean) {
    if (!next) {
      toggle(automation, false);
      return;
    }
    show({
      title: `Turn on “${automation.name}”?`,
      message: triggerActivationSentence(
        automation.trigger_type,
        automation.trigger_config
      ),
      actions: [
        { label: 'Cancel', variant: 'muted', onPress: close },
        {
          label: 'Turn on',
          variant: 'primary',
          onPress: () => {
            close();
            toggle(automation, true);
          },
        },
      ],
    });
  }

  const pull = usePullRefresh(() =>
    Promise.all([automationsQuery.refetch(), flowsQuery.refetch()])
  );

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={styles.container}
      refreshControl={
        <RefreshControl
          refreshing={pull.refreshing}
          onRefresh={pull.onRefresh}
          tintColor={colors.primary}
        />
      }
    >
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Automations',
        }}
      />

      {error ? <Banner kind="error" text={error} /> : null}

      <SectionLabel text="Automations" />
      <Text style={{ fontSize: 12.5, color: colors.textFaint }}>
        {canEdit
          ? 'Toggle any automation in your account on or off. Building and editing them happens on the web.'
          : "Every automation in your account. Your access is read-only, so you can't switch them on or off."}
      </Text>
      {automationsQuery.isLoading ? (
        <ConvoRealLoader style={{ alignSelf: 'center', paddingVertical: 20 }} />
      ) : (automationsQuery.data ?? []).length === 0 ? (
        <EmptyState
          icon="git-branch-outline"
          title="No automations yet"
          subtitle="Create triggers and actions in the web app's Automations builder."
        />
      ) : (
        (automationsQuery.data ?? []).map((a) => {
          const blockedOn = !isTriggerAvailable(a.trigger_type) && !a.is_active;
          return (
            <View
              key={a.id}
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
                    fontSize: 15,
                    fontFamily: f.bold,
                    color: colors.text,
                  }}
                >
                  {a.name}
                </Text>
                <Text style={{ fontSize: 12.5, color: colors.textMuted }}>
                  {triggerLabel(a.trigger_type)}
                  {typeof a.execution_count === 'number'
                    ? ` · ran ${a.execution_count}×`
                    : ''}
                </Text>
              </View>
              {togglingId === a.id ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <Switch
                  value={a.is_active}
                  onValueChange={(v) => requestToggle(a, v)}
                  disabled={!canEdit || blockedOn}
                  accessibilityHint={
                    !canEdit
                      ? 'Your access is read-only.'
                      : blockedOn
                        ? 'This trigger is not yet available, so this automation cannot be turned on.'
                        : undefined
                  }
                  trackColor={{ true: colors.primary, false: colors.border }}
                  thumbColor="#fff"
                />
              )}
            </View>
          );
        })
      )}

      <SectionLabel text="WhatsApp Flows" />
      {flowsQuery.isLoading ? (
        <ConvoRealLoader style={{ alignSelf: 'center', paddingVertical: 20 }} />
      ) : (flowsQuery.data ?? []).length === 0 ? (
        <Text style={{ fontSize: 13, color: colors.textMuted }}>
          No interactive flows. Build WhatsApp menu trees in the web app's Flow
          Builder.
        </Text>
      ) : (
        (flowsQuery.data ?? []).map((flow) => (
          <View
            key={flow.id}
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
                style={{ fontSize: 15, fontFamily: f.bold, color: colors.text }}
              >
                {flow.name}
              </Text>
              <Text style={{ fontSize: 12.5, color: colors.textMuted }}>
                {flow.trigger_type
                  ? `${flow.trigger_type.replace(/_/g, ' ')} · `
                  : ''}
                {typeof flow.execution_count === 'number'
                  ? `ran ${flow.execution_count}×`
                  : ''}
              </Text>
            </View>
            <Text
              style={{
                fontSize: 11.5,
                fontFamily: f.bold,
                textTransform: 'uppercase',
                color:
                  flow.status === 'active'
                    ? colors.success
                    : flow.status === 'archived'
                      ? colors.textFaint
                      : colors.warning,
              }}
            >
              {flow.status}
            </Text>
          </View>
        ))
      )}

      <Text
        style={{ fontSize: 12, color: colors.textFaint, textAlign: 'center' }}
      >
        Flow activation involves canvas validation — manage flow status on the
        web.
      </Text>
      <AppDialog {...dialogProps} />
    </ScrollView>
  );
}

function toggleErrorText(err: unknown): string {
  if (!(err instanceof ApiError)) return 'Could not update automation.';
  const issues = (err.data as { issues?: unknown } | undefined)?.issues;
  if (!Array.isArray(issues) || issues.length === 0) return err.message;
  const lines = issues
    .filter(
      (i): i is { path: string; message: string } =>
        typeof i?.path === 'string' && typeof i?.message === 'string'
    )
    .map((i) => `• ${describeIssue(i)}`);
  return lines.length > 0
    ? `Fix these on the web before turning it on:\n${lines.join('\n')}`
    : err.message;
}

function SectionLabel({ text }: { text: string }) {
  const { colors, fonts: f } = useTheme();
  return (
    <Text
      style={{
        fontSize: 12.5,
        fontFamily: f.bold,
        textTransform: 'uppercase',
        letterSpacing: 0.4,
        color: colors.textFaint,
        marginTop: spacing.sm,
      }}
    >
      {text}
    </Text>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: spacing.xxl,
  },
  card: {
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
});
