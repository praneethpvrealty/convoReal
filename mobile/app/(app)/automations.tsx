import { Ionicons } from '@expo/vector-icons';
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

import { Banner, EmptyState } from '@/components/ui';
import { ApiError, apiFetch } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { queryClient } from '@/lib/query';
import { radius, shadows, spacing, useTheme , fonts } from '@/lib/theme';
import type { AutomationRow, FlowRow } from '@/lib/types';

export default function AutomationsScreen() {
  const { colors, fonts: f } = useTheme();
  const [error, setError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const automationsQuery = useQuery({
    queryKey: ['automations'],
    queryFn: async () =>
      (await apiFetch<{ automations: AutomationRow[] }>('/api/automations')).automations,
  });
  const flowsQuery = useQuery({
    queryKey: ['flows'],
    queryFn: async () => (await apiFetch<{ flows: FlowRow[] }>('/api/flows')).flows,
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
      setError(err instanceof ApiError ? err.message : 'Could not update automation.');
    } finally {
      setTogglingId(null);
    }
  }

  const refreshing = automationsQuery.isFetching || flowsQuery.isFetching;

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={styles.container}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            automationsQuery.refetch();
            flowsQuery.refetch();
          }}
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
        Toggle automations you created on or off. Building and editing them happens on the web.
      </Text>
      {automationsQuery.isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ paddingVertical: 20 }} />
      ) : (automationsQuery.data ?? []).length === 0 ? (
        <EmptyState
          icon="git-branch-outline"
          title="No automations yet"
          subtitle="Create triggers and actions in the web app's Automations builder."
        />
      ) : (
        (automationsQuery.data ?? []).map((a) => (
          <View
            key={a.id}
            style={[styles.card, { backgroundColor: colors.glass, borderColor: colors.glassBorder }]}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ fontSize: 15, fontFamily: f.bold, color: colors.text }}>{a.name}</Text>
              <Text style={{ fontSize: 12.5, color: colors.textMuted }}>
                {a.trigger_type.replace(/_/g, ' ')}
                {typeof a.execution_count === 'number' ? ` · ran ${a.execution_count}×` : ''}
              </Text>
            </View>
            {togglingId === a.id ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <Switch
                value={a.is_active}
                onValueChange={(v) => toggle(a, v)}
                trackColor={{ true: colors.primary, false: colors.border }}
                thumbColor="#fff"
              />
            )}
          </View>
        ))
      )}

      <SectionLabel text="WhatsApp Flows" />
      {flowsQuery.isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ paddingVertical: 20 }} />
      ) : (flowsQuery.data ?? []).length === 0 ? (
        <Text style={{ fontSize: 13, color: colors.textMuted }}>
          No interactive flows. Build WhatsApp menu trees in the web app's Flow Builder.
        </Text>
      ) : (
        (flowsQuery.data ?? []).map((flow) => (
          <View
            key={flow.id}
            style={[styles.card, { backgroundColor: colors.glass, borderColor: colors.glassBorder }]}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ fontSize: 15, fontFamily: f.bold, color: colors.text }}>{flow.name}</Text>
              <Text style={{ fontSize: 12.5, color: colors.textMuted }}>
                {flow.trigger_type ? `${flow.trigger_type.replace(/_/g, ' ')} · ` : ''}
                {typeof flow.execution_count === 'number' ? `ran ${flow.execution_count}×` : ''}
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

      <Text style={{ fontSize: 12, color: colors.textFaint, textAlign: 'center' }}>
        Flow activation involves canvas validation — manage flow status on the web.
      </Text>
    </ScrollView>
  );
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
  container: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  card: {
    ...shadows.card,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
});
