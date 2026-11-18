import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
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
import { EmptyState, SearchBar } from '@/components/ui';
import { apiFetch } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { Contact } from '@/lib/types';

interface RegisteredAgent {
  id: string;
  name: string | null;
  phone: string;
  company: string | null;
}

export function RequirementAgentShareSheet({
  visible,
  buyers,
  onBack,
  onDone,
}: {
  visible: boolean;
  buyers: Pick<Contact, 'id'>[];
  onBack: () => void;
  onDone: () => void;
}) {
  const { colors, fonts: f } = useTheme();
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const { show, close, dialogProps } = useAppDialog();
  const many = buyers.length > 1;

  const agents = useQuery({
    queryKey: ['requirement-share-agents'],
    enabled: visible,
    queryFn: () =>
      apiFetch<{ data: RegisteredAgent[] }>(
        '/api/requirement-account-shares/agents'
      ).then((response) => response.data),
  });

  const shown = useMemo(() => {
    const value = search.trim().toLowerCase();
    return (agents.data ?? []).filter((agent) =>
      [agent.name, agent.company, agent.phone]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(value))
    );
  }, [agents.data, search]);

  const canSend = Boolean(selectedId) && buyers.length > 0 && !sending;

  async function send() {
    if (!selectedId || !canSend) return;
    setSending(true);
    let delivered = 0;
    try {
      for (const buyer of buyers) {
        await apiFetch('/api/requirement-account-shares', {
          method: 'POST',
          body: JSON.stringify({
            contact_id: buyer.id,
            recipient_contact_id: selectedId,
          }),
        });
        delivered += 1;
      }
      haptic.success();
      show({
        title: many ? `${delivered} requirements shared` : 'Requirement shared',
        message: many
          ? 'The agent can now review the masked buyer briefs in Shared Requirements and return matching inventory.'
          : 'The agent can now review the masked buyer brief in Shared Requirements and return matching inventory.',
        actions: [
          {
            label: 'Done',
            variant: 'primary',
            onPress: () => {
              close();
              onDone();
            },
          },
        ],
      });
    } catch (error) {
      haptic.warn();
      const reason = friendlyError(
        error instanceof Error ? error.message : 'Please try again.'
      );
      show({
        title: 'Could not share requirement',
        message:
          many && delivered > 0
            ? `${delivered} of ${buyers.length} were shared before this stopped. ${reason}`
            : reason,
        actions: [{ label: 'OK', variant: 'primary', onPress: close }],
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <BottomSheet visible={visible} onClose={onBack} title="Share with an agent">
      <View style={{ flexShrink: 1, gap: spacing.md }}>
        <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
          <Text
            style={{ color: colors.textMuted, fontSize: 12.5, lineHeight: 18 }}
          >
            Your saved agents who are on ConvoReal. They receive{' '}
            {many
              ? `${buyers.length} masked buyer briefs`
              : 'a masked buyer brief'}
            , never the buyer’s name or phone number.
          </Text>
          <SearchBar
            value={search}
            onChangeText={setSearch}
            placeholder="Search agents on ConvoReal"
          />
        </View>

        <ScrollView
          style={sheetScrollArea}
          contentContainerStyle={{
            paddingHorizontal: spacing.lg,
            paddingBottom: spacing.sm,
            gap: spacing.sm,
          }}
          keyboardShouldPersistTaps="handled"
        >
          {agents.isPending ? (
            <ActivityIndicator
              color={colors.primary}
              style={{ margin: spacing.xl }}
            />
          ) : agents.isError ? (
            <Text style={{ color: colors.danger, textAlign: 'center' }}>
              Could not load agent contacts.
            </Text>
          ) : shown.length === 0 ? (
            <EmptyState
              icon="people-outline"
              title="No agents on ConvoReal"
              subtitle={
                search.trim()
                  ? 'None of your saved agents on ConvoReal match that search.'
                  : 'None of your saved agent contacts has a ConvoReal account yet. Share the masked text with them instead.'
              }
            />
          ) : (
            shown.map((agent) => {
              const selected = agent.id === selectedId;
              return (
                <Pressable
                  key={agent.id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`Share with ${agent.name || agent.phone || 'agent'}`}
                  onPress={() => {
                    haptic.tap();
                    setSelectedId(agent.id);
                  }}
                  style={[
                    styles.row,
                    {
                      borderColor: selected
                        ? colors.primary
                        : colors.glassBorder,
                      backgroundColor: selected
                        ? colors.primarySoft
                        : colors.glass,
                    },
                  ]}
                >
                  <Ionicons
                    name={selected ? 'radio-button-on' : 'radio-button-off'}
                    size={20}
                    color={selected ? colors.primary : colors.textFaint}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontFamily: f.bold }}>
                      {agent.name || 'Unnamed agent'}
                    </Text>
                    <Text
                      numberOfLines={1}
                      style={{ color: colors.textMuted, fontSize: 11.5 }}
                    >
                      {[agent.company, agent.phone].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                </Pressable>
              );
            })
          )}
        </ScrollView>

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSend }}
          disabled={!canSend}
          onPress={send}
          style={[
            styles.send,
            {
              backgroundColor: colors.primary,
              opacity: canSend ? 1 : 0.45,
              marginHorizontal: spacing.lg,
            },
          ]}
        >
          {sending ? (
            <ActivityIndicator size="small" color={colors.onPrimary} />
          ) : (
            <Ionicons name="send-outline" size={18} color={colors.onPrimary} />
          )}
          <Text style={{ color: colors.onPrimary, fontFamily: f.bold }}>
            {many
              ? `Share ${buyers.length} masked requirements`
              : 'Share masked requirement'}
          </Text>
        </Pressable>
      </View>
      <AppDialog {...dialogProps} />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
  },
  send: {
    minHeight: 48,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
});
