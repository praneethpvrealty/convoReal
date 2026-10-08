import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { catalogShareState } from '@shared/lib/inventory/catalog-product-share';

import { AppDialog, type DialogAction } from '@/components/app-dialog';
import { ContactPickerSheet } from '@/components/contact-picker-sheet';
import { SectionLabel } from '@/components/ui';
import { useAuthStore } from '@/lib/auth-store';
import {
  fetchCatalogShareContext,
  type CatalogShareContext,
  sendCatalogProduct,
  syncPropertyToCatalog,
} from '@/lib/catalog-product-share';
import { haptic } from '@/lib/haptics';
import { radius, spacing, useTheme } from '@/lib/theme';
import { contactHandle } from '@/lib/reachability';
import type { Contact, Property } from '@/lib/types';

export function CatalogProductShare({
  property,
  visible,
  recipients,
  onShared,
  onDone,
}: {
  property: Property;
  visible: boolean;
  recipients: Contact[];
  onShared?: (contactIds: string[]) => void;
  onDone: () => void;
}) {
  const { colors, fonts: f } = useTheme();
  const queryClient = useQueryClient();
  const accountId = useAuthStore((s) => s.profile?.account_id) ?? null;
  const queryKey = ['catalog-share', accountId, property.id];
  const context = useQuery({
    queryKey,
    queryFn: () => fetchCatalogShareContext(accountId as string, property.id),
    enabled: visible && Boolean(accountId),
    staleTime: 30_000,
  });
  const [now, setNow] = useState(() => Date.now());
  const [syncing, setSyncing] = useState(false);
  const [sending, setSending] = useState(false);
  const [picking, setPicking] = useState(false);
  const [dialog, setDialog] = useState<{
    title: string;
    message?: string;
    actions: DialogAction[];
  } | null>(null);

  const data = context.data;
  const state = catalogShareState(
    {
      meta_catalog_synced_at: data?.syncedAt ?? null,
      meta_catalog_error: data?.error ?? null,
    },
    now
  );

  useEffect(() => {
    if (!visible || state.status !== 'indexing') return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [visible, state.status]);

  if (!data?.catalogId) return null;
  const catalogId = data.catalogId;
  const currency = data.currency;

  function notify(title: string, message?: string) {
    setDialog({
      title,
      message,
      actions: [
        { label: 'OK', variant: 'primary', onPress: () => setDialog(null) },
      ],
    });
  }

  async function sync() {
    if (syncing) return;
    setSyncing(true);
    haptic.tap();
    try {
      const syncedAt = await syncPropertyToCatalog(property.id);
      queryClient.setQueryData<CatalogShareContext>(queryKey, (prev) =>
        prev ? { ...prev, syncedAt, error: null } : prev
      );
      setNow(Date.now());
      haptic.success();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sync failed';
      queryClient.setQueryData<CatalogShareContext>(queryKey, (prev) =>
        prev ? { ...prev, syncedAt: null, error: message } : prev
      );
      haptic.warn();
      notify('Could not sync to catalog', message);
    } finally {
      setSyncing(false);
    }
  }

  async function send(contacts: Contact[]) {
    if (contacts.length === 0 || sending) return;
    setSending(true);
    haptic.send();
    try {
      const { sent, failed } = await sendCatalogProduct(
        catalogId,
        currency,
        property,
        contacts
      );
      setPicking(false);
      if (sent.length > 0) onShared?.(sent.map((c) => c.id));
      if (failed.length === 0) {
        haptic.success();
        onDone();
        return;
      }
      haptic.warn();
      notify(
        `Sent to ${sent.length} of ${contacts.length}`,
        failed
          .map(
            ({ contact, error }) =>
              `${contact.name || contactHandle(contact)}: ${error}`
          )
          .join('\n')
      );
    } catch (err) {
      haptic.warn();
      notify(
        'Could not send product card',
        err instanceof Error ? err.message : 'Please try again.'
      );
    } finally {
      setSending(false);
    }
  }

  const statusLabel =
    state.status === 'ready'
      ? 'Synced to catalog'
      : state.status === 'indexing'
        ? 'Indexing in progress'
        : state.status === 'failed'
          ? 'Sync failed'
          : 'Not synced';
  const statusColor =
    state.status === 'ready'
      ? colors.success
      : state.status === 'failed'
        ? colors.danger
        : colors.warning;
  const ready = state.status === 'ready';
  const recipientName =
    recipients.length === 0
      ? null
      : recipients.length === 1
        ? recipients[0].name || contactHandle(recipients[0])
        : `${recipients.length} contacts`;

  return (
    <>
      <SectionLabel text="Share as WhatsApp product card" />
      <View
        style={[
          styles.card,
          { backgroundColor: colors.surfaceSunken, borderColor: colors.border },
        ]}
      >
        <View style={styles.statusRow}>
          <Text
            style={{
              flex: 1,
              fontSize: 12,
              fontFamily: f.semibold,
              color: statusColor,
            }}
          >
            ● {statusLabel}
          </Text>
          <Pressable
            onPress={() => void sync()}
            disabled={syncing}
            accessibilityRole="button"
            accessibilityLabel="Sync this property to the WhatsApp catalog"
            accessibilityState={{ disabled: syncing, busy: syncing }}
            style={[styles.syncButton, { borderColor: colors.border }]}
          >
            {syncing ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : null}
            <Text
              style={{
                fontSize: 12,
                fontFamily: f.semibold,
                color: colors.text,
              }}
            >
              {syncing ? 'Syncing' : 'Sync now'}
            </Text>
          </Pressable>
        </View>
        <Text
          style={{ fontSize: 11.5, lineHeight: 16, color: colors.textMuted }}
        >
          Sends this property as an interactive catalog product card inside
          WhatsApp, with its photo, details and price inline.
        </Text>
        {state.status === 'indexing' ? (
          <Text style={{ fontSize: 11.5, color: colors.warning }}>
            Meta Catalog is indexing the product. Ready to share in{' '}
            {state.secondsLeft}s.
          </Text>
        ) : null}
        {state.status === 'failed' && data.error ? (
          <Text
            style={{ fontSize: 11.5, color: colors.danger }}
            numberOfLines={3}
          >
            {data.error}
          </Text>
        ) : null}
        <Pressable
          disabled={!ready || sending}
          onPress={() =>
            recipients.length ? void send(recipients) : setPicking(true)
          }
          accessibilityRole="button"
          accessibilityLabel={
            recipientName
              ? `Send product card to ${recipientName}`
              : 'Select contacts and send product card'
          }
          accessibilityState={{ disabled: !ready || sending, busy: sending }}
          style={[
            styles.sendButton,
            {
              backgroundColor: colors.primarySoft,
              borderColor: colors.primary,
            },
            (!ready || sending) && { opacity: 0.5 },
          ]}
        >
          <Ionicons name="pricetag-outline" size={18} color={colors.primary} />
          <Text
            style={{
              flex: 1,
              fontSize: 13.5,
              fontFamily: f.bold,
              color: colors.primary,
            }}
          >
            {sending
              ? 'Sending product card…'
              : state.status === 'indexing'
                ? `Indexing (${state.secondsLeft}s)`
                : recipientName
                  ? `Send product card to ${recipientName}`
                  : 'Select contacts & send product card'}
          </Text>
          {sending ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Ionicons name="chevron-forward" size={16} color={colors.primary} />
          )}
        </Pressable>
      </View>

      <ContactPickerSheet
        visible={picking}
        onClose={() => setPicking(false)}
        multiSelect
        confirmLabel="Send"
        onSelectMany={(contacts) => void send(contacts)}
        title="Send product card"
        hint="Choose the contacts who should receive this listing as a WhatsApp catalog product card from your business number."
        busy={sending}
        busyLabel="Sending product card…"
      />
      <AppDialog
        visible={dialog !== null}
        onClose={() => setDialog(null)}
        title={dialog?.title ?? ''}
        message={dialog?.message}
        actions={dialog?.actions ?? []}
      />
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  syncButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  sendButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
});
