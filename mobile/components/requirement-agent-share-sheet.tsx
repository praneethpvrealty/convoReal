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
import { supabase } from '@/lib/supabase';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { Contact } from '@/lib/types';

interface ShareStatus {
  registered: boolean;
  recipientName: string;
}

async function fetchAgentContacts(): Promise<Contact[]> {
  const { data, error } = await supabase
    .from('contacts')
    .select('id, name, phone, company, classification')
    .eq('classification', 'Agent')
    .eq('is_merged', false)
    .order('name');
  if (error) throw error;
  return (data ?? []) as unknown as Contact[];
}

export function RequirementAgentShareSheet({
  visible,
  buyer,
  onBack,
  onDone,
}: {
  visible: boolean;
  buyer: Contact;
  onBack: () => void;
  onDone: () => void;
}) {
  const { colors, fonts: f } = useTheme();
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const { show, close, dialogProps } = useAppDialog();

  const agents = useQuery({
    queryKey: ['requirement-share-agents'],
    enabled: visible,
    queryFn: fetchAgentContacts,
  });
  const status = useQuery({
    queryKey: ['requirement-share-agent-status', selectedId],
    enabled: visible && Boolean(selectedId),
    retry: false,
    queryFn: () =>
      apiFetch<{ data: ShareStatus }>(
        `/api/contacts/${selectedId}/share-inventory`
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

  async function send() {
    if (!selectedId || status.data?.registered !== true || sending) return;
    setSending(true);
    try {
      await apiFetch('/api/requirement-account-shares', {
        method: 'POST',
        body: JSON.stringify({
          contact_id: buyer.id,
          recipient_contact_id: selectedId,
        }),
      });
      haptic.success();
      show({
        title: 'Requirement shared',
        message:
          'The agent can now review the masked buyer brief in Shared Requirements and return matching inventory.',
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
      show({
        title: 'Could not share requirement',
        message: friendlyError(
          error instanceof Error ? error.message : 'Please try again.'
        ),
        actions: [{ label: 'OK', variant: 'primary', onPress: close }],
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <BottomSheet
      visible={visible}
      onClose={onBack}
      title="Share with an agent"
    >
      <View style={{ flexShrink: 1, gap: spacing.md }}>
        <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
          <Text style={{ color: colors.textMuted, fontSize: 12.5, lineHeight: 18 }}>
            Select a saved agent contact. ConvoReal shares a masked buyer brief,
            never the buyer’s name or phone number.
          </Text>
          <SearchBar
            value={search}
            onChangeText={setSearch}
            placeholder="Search saved agents"
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
            <ActivityIndicator color={colors.primary} style={{ margin: spacing.xl }} />
          ) : agents.isError ? (
            <Text style={{ color: colors.danger, textAlign: 'center' }}>
              Could not load agent contacts.
            </Text>
          ) : shown.length === 0 ? (
            <EmptyState
              icon="people-outline"
              title="No agent contacts"
              subtitle="Save and classify an agent contact before sharing directly."
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
                      borderColor: selected ? colors.primary : colors.glassBorder,
                      backgroundColor: selected ? colors.primarySoft : colors.glass,
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

        {selectedId ? (
          <View style={{ paddingHorizontal: spacing.lg }}>
            {status.isPending ? (
              <View style={[styles.notice, { borderColor: colors.border }]}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={{ color: colors.textMuted, flex: 1 }}>
                  Checking their ConvoReal account…
                </Text>
              </View>
            ) : status.data?.registered ? (
              <View
                style={[
                  styles.notice,
                  {
                    borderColor: colors.success,
                    backgroundColor: colors.successSoft,
                  },
                ]}
              >
                <Ionicons name="checkmark-circle" size={18} color={colors.success} />
                <Text style={{ color: colors.text, flex: 1 }}>
                  Account verified. This brief can be delivered in-app.
                </Text>
              </View>
            ) : (
              <View
                style={[
                  styles.notice,
                  {
                    borderColor: colors.warning,
                    backgroundColor: colors.warningSoft,
                  },
                ]}
              >
                <Ionicons name="information-circle" size={18} color={colors.warning} />
                <Text style={{ color: colors.text, flex: 1 }}>
                  No matching ConvoReal account was found. Use the WhatsApp
                  sharing option on the web until they join.
                </Text>
              </View>
            )}
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityState={{
            disabled: status.data?.registered !== true || sending,
          }}
          disabled={status.data?.registered !== true || sending}
          onPress={send}
          style={[
            styles.send,
            {
              backgroundColor: colors.primary,
              opacity: status.data?.registered === true && !sending ? 1 : 0.45,
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
            Share masked requirement
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
  notice: {
    minHeight: 48,
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
