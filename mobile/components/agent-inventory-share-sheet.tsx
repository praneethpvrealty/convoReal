import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { fetchPropertyPage } from '@/app/(app)/(tabs)/properties';
import { AppDialog, useAppDialog } from '@/components/app-dialog';
import { BottomSheet } from '@/components/sheet';
import { EmptyState, SearchBar } from '@/components/ui';
import { apiFetch } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { friendlyError } from '@/lib/errors';
import { formatInr } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { buildShortlistMessage } from '@/lib/share-message';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { Contact, Property } from '@/lib/types';
import { useDebounced } from '@/lib/use-debounced';
import { getShowcaseUrl } from '@/lib/welcome-message';

interface ShareStatus {
  registered: boolean;
  recipientName: string;
}

interface ShareResult extends ShareStatus {
  sharedCount: number;
  alreadySharedCount: number;
}

export function AgentInventoryShareSheet({
  visible,
  onClose,
  contact,
}: {
  visible: boolean;
  onClose: () => void;
  contact: Contact;
}) {
  const { colors, fonts: f } = useTheme();
  const session = useAuthStore((state) => state.session);
  const fullName = useAuthStore((state) => state.profile?.full_name);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Property[]>([]);
  const [includeInvite, setIncludeInvite] = useState(false);
  const [sending, setSending] = useState(false);
  const debounced = useDebounced(search.trim());
  const { show, close, dialogProps } = useAppDialog();

  const status = useQuery({
    queryKey: ['agent-inventory-share-status', contact.id],
    enabled: visible,
    retry: false,
    queryFn: () =>
      apiFetch<{ data: ShareStatus }>(
        `/api/contacts/${contact.id}/share-inventory`
      ).then((response) => response.data),
  });
  const properties = useQuery({
    queryKey: ['agent-inventory-share-search', debounced],
    enabled: visible,
    queryFn: () => fetchPropertyPage(0, debounced, 'All', null, false),
  });
  const baseUrl = useQuery({
    queryKey: ['showcase-url'],
    enabled: visible,
    staleTime: 5 * 60_000,
    queryFn: getShowcaseUrl,
  });

  const emailName = (session?.user.email?.split('@')[0] ?? '').split(
    /[._-]/
  )[0];
  const agentName =
    fullName?.trim() ||
    (emailName
      ? emailName.charAt(0).toUpperCase() + emailName.slice(1)
      : undefined);
  const agentPhone = session?.user.phone
    ? `+${session.user.phone.replace(/^\+/, '')}`
    : undefined;
  const propertyMessage = useMemo(
    () =>
      selected.length > 0 && baseUrl.data
        ? buildShortlistMessage({
            properties: selected,
            baseUrl: baseUrl.data,
            contactName: contact.name ?? undefined,
            agentName,
            agentPhone,
          })
        : '',
    [selected, baseUrl.data, contact.name, agentName, agentPhone]
  );

  function closeSheet() {
    setSearch('');
    setSelected([]);
    setIncludeInvite(false);
    onClose();
  }

  const registered = status.data?.registered === true;
  const canSend =
    !status.isPending &&
    !status.isError &&
    (selected.length > 0 || (!registered && includeInvite));

  function toggle(property: Property) {
    haptic.tap();
    setSelected((current) => {
      if (current.some((item) => item.id === property.id)) {
        return current.filter((item) => item.id !== property.id);
      }
      if (current.length >= 25) {
        show({
          title: 'Selection limit',
          message: 'Choose no more than 25 properties at a time.',
          actions: [{ label: 'OK', variant: 'primary', onPress: close }],
        });
        return current;
      }
      return [...current, property];
    });
  }

  async function send() {
    if (!canSend || sending) return;
    setSending(true);
    try {
      const share = await apiFetch<{ data: ShareResult }>(
        `/api/contacts/${contact.id}/share-inventory`,
        {
          method: 'POST',
          body: JSON.stringify({
            property_ids: selected.map((item) => item.id),
          }),
        }
      );

      let inviteMessage = '';
      if (!share.data.registered && includeInvite) {
        const invite = await apiFetch<{ shareMessage: string }>(
          '/api/beta-invites',
          {
            method: 'POST',
            body: JSON.stringify({
              label: contact.name || null,
              invitee_phone: contact.phone,
            }),
          }
        );
        inviteMessage = invite.shareMessage;
      }

      const message = [
        propertyMessage,
        share.data.registered && selected.length > 0
          ? 'I’ve also shared these directly to your ConvoReal inventory. Please review them under Pending Review.'
          : '',
        inviteMessage,
      ]
        .filter(Boolean)
        .join('\n\n');
      const phone = (contact.phone ?? '').replace(/\D/g, '');
      haptic.send();
      await Linking.openURL(
        `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
      );
      closeSheet();
    } catch (error) {
      haptic.warn();
      show({
        title: 'Could not share inventory',
        message: friendlyError(
          error instanceof Error ? error.message : 'Please try again.'
        ),
        actions: [{ label: 'OK', variant: 'primary', onPress: close }],
      });
    } finally {
      setSending(false);
    }
  }

  const rows = properties.data?.data ?? [];

  return (
    <BottomSheet visible={visible} onClose={closeSheet} title="Share inventory">
      <View
        style={{
          paddingHorizontal: spacing.lg,
          gap: spacing.md,
          flexShrink: 1,
        }}
      >
        <Text
          style={{ fontSize: 12.5, color: colors.textMuted, lineHeight: 18 }}
        >
          Pick any properties for WhatsApp. If {contact.name || 'this agent'}{' '}
          uses ConvoReal, they also enter the Pending Review queue with your
          attribution.
        </Text>

        {status.isPending ? (
          <View
            style={[
              styles.notice,
              {
                borderColor: colors.border,
                backgroundColor: colors.surfaceSunken,
              },
            ]}
          >
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={{ flex: 1, fontSize: 12, color: colors.textMuted }}>
              Checking their ConvoReal account…
            </Text>
          </View>
        ) : status.isError ? (
          <Text style={{ fontSize: 12, color: colors.danger }}>
            {friendlyError((status.error as Error).message)}
          </Text>
        ) : registered ? (
          <View
            style={[
              styles.notice,
              {
                borderColor: colors.success,
                backgroundColor: colors.successSoft,
              },
            ]}
          >
            <Ionicons
              name="checkmark-circle"
              size={18}
              color={colors.success}
            />
            <Text style={{ flex: 1, fontSize: 12, color: colors.text }}>
              ConvoReal account found — selected properties will be added for
              review.
            </Text>
          </View>
        ) : (
          <Pressable
            onPress={() => setIncludeInvite((value) => !value)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: includeInvite }}
            style={[
              styles.notice,
              {
                borderColor: colors.primary,
                backgroundColor: colors.primarySoft,
              },
            ]}
          >
            <Ionicons
              name={includeInvite ? 'checkbox' : 'square-outline'}
              size={20}
              color={colors.primary}
            />
            <Text
              style={{
                flex: 1,
                fontSize: 12,
                color: colors.text,
                lineHeight: 17,
              }}
            >
              <Text style={{ fontFamily: f.bold }}>
                Also invite them to ConvoReal.
              </Text>{' '}
              The personal app invite is added at the end of the WhatsApp
              message.
            </Text>
          </Pressable>
        )}

        <SearchBar
          value={search}
          onChangeText={setSearch}
          placeholder="Search available inventory"
        />

        <View style={{ maxHeight: 300, flexShrink: 1 }}>
          {properties.isPending ? (
            <View style={{ paddingVertical: spacing.xl, alignItems: 'center' }}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : properties.isError ? (
            <Text style={{ fontSize: 12, color: colors.danger }}>
              Could not load inventory — try again.
            </Text>
          ) : rows.length === 0 ? (
            <EmptyState
              icon="home-outline"
              title="No available properties"
              subtitle="Try another search or send only the app invite."
            />
          ) : (
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View style={{ gap: spacing.sm }}>
                {rows.map((property) => {
                  const checked = selected.some(
                    (item) => item.id === property.id
                  );
                  return (
                    <Pressable
                      key={property.id}
                      onPress={() => toggle(property)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked }}
                      style={[
                        styles.row,
                        {
                          borderColor: checked
                            ? colors.primary
                            : colors.glassBorder,
                          backgroundColor: checked
                            ? colors.primarySoft
                            : colors.glass,
                        },
                      ]}
                    >
                      <Ionicons
                        name={checked ? 'checkbox' : 'square-outline'}
                        size={20}
                        color={checked ? colors.primary : colors.textFaint}
                      />
                      <View style={{ flex: 1 }}>
                        <Text
                          numberOfLines={1}
                          style={{
                            fontSize: 13.5,
                            fontFamily: f.bold,
                            color: colors.text,
                          }}
                        >
                          {property.title}
                        </Text>
                        <Text
                          numberOfLines={1}
                          style={{ fontSize: 11.5, color: colors.textMuted }}
                        >
                          {[
                            property.location,
                            property.price ? formatInr(property.price) : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
          )}
        </View>

        <Pressable
          onPress={send}
          disabled={!canSend || sending}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSend || sending }}
          style={[
            styles.send,
            {
              backgroundColor: colors.primary,
              opacity: canSend && !sending ? 1 : 0.5,
            },
          ]}
        >
          {sending ? (
            <ActivityIndicator size="small" color={colors.onPrimary} />
          ) : (
            <Ionicons name="logo-whatsapp" size={18} color={colors.onPrimary} />
          )}
          <Text
            style={{
              fontSize: 14,
              fontFamily: f.bold,
              color: colors.onPrimary,
            }}
          >
            Open WhatsApp · {selected.length} selected
          </Text>
        </Pressable>
      </View>
      <AppDialog {...dialogProps} />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  send: {
    minHeight: 46,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
});
