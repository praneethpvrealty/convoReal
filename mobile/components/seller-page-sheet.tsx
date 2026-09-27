import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { BottomSheet } from '@/components/sheet';
import { Banner, PrimaryButton } from '@/components/ui';
import { friendlyError } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import {
  fetchSellerPage,
  updateSellerPage,
  type SellerPageAction,
} from '@/lib/seller-page';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { Contact } from '@/lib/types';

export function SellerPageSheet({
  visible,
  onClose,
  contact,
}: {
  visible: boolean;
  onClose: () => void;
  contact: Pick<Contact, 'id' | 'name' | 'phone'>;
}) {
  const { colors, fonts: f } = useTheme();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<SellerPageAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const queryKey = ['seller-page', contact.id];
  const status = useQuery({
    queryKey,
    enabled: visible,
    queryFn: () => fetchSellerPage(contact.id),
  });
  const data = status.data;
  const name = contact.name?.trim() || contact.phone || 'this seller';
  const listingsLine = data
    ? data.listing_count === 1
      ? '1 live listing is on the page.'
      : `${data.listing_count} live listings are on the page.`
    : '';

  function closeSheet() {
    setActionError(null);
    setNotice(null);
    onClose();
  }

  async function run(action: SellerPageAction) {
    if (pending) return;
    setPending(action);
    setActionError(null);
    setNotice(null);
    try {
      queryClient.setQueryData(
        queryKey,
        await updateSellerPage(contact.id, action)
      );
      haptic.success();
      setNotice(
        action === 'disable'
          ? 'Seller page turned off.'
          : action === 'rotate'
            ? 'New link created. The old one no longer works.'
            : 'Seller page is live.'
      );
    } catch (reason) {
      haptic.warn();
      setActionError(
        friendlyError(
          reason instanceof Error ? reason.message : 'Could not update the page'
        )
      );
    } finally {
      setPending(null);
    }
  }

  function confirmRotate() {
    Alert.alert(
      'Create a new link?',
      'The current link stops working immediately.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'New link', onPress: () => void run('rotate') },
      ]
    );
  }

  async function copyLink() {
    if (!data?.url) return;
    await Clipboard.setStringAsync(data.url);
    haptic.success();
    setNotice('Link copied.');
  }

  async function sendOnWhatsApp() {
    const digits = contact.phone?.replace(/\D/g, '') ?? '';
    if (!digits || !data?.share_message) return;
    haptic.send();
    try {
      await Linking.openURL(
        `https://wa.me/${digits}?text=${encodeURIComponent(data.share_message)}`
      );
    } catch {
      haptic.warn();
      setActionError('Could not open WhatsApp on this device.');
    }
  }

  const error = status.error
    ? friendlyError(
        status.error instanceof Error
          ? status.error.message
          : 'Could not load the seller page'
      )
    : actionError;

  return (
    <BottomSheet visible={visible} onClose={closeSheet} title="Seller page">
      <View style={{ paddingHorizontal: spacing.lg, gap: spacing.lg }}>
        <Text style={{ color: colors.textMuted, fontSize: 14, lineHeight: 20 }}>
          {`A link ${name} can share that shows only their live listings on your showcase. Every call and WhatsApp enquiry on it comes to you.`}
        </Text>

        <View
          style={[
            styles.panel,
            {
              backgroundColor: colors.surfaceSunken,
              borderColor: colors.glassBorder,
            },
          ]}
        >
          {status.isLoading ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : data?.enabled && data.url ? (
            <View style={{ gap: spacing.sm }}>
              <Text
                selectable
                style={{
                  color: colors.text,
                  fontFamily: f.semibold,
                  fontSize: 14,
                }}
              >
                {data.url}
              </Text>
              <Text style={{ color: colors.textMuted, fontSize: 12.5 }}>
                {listingsLine}
              </Text>
            </View>
          ) : data ? (
            <Text
              style={{
                color: colors.textMuted,
                fontSize: 13.5,
                lineHeight: 20,
              }}
            >
              {data.owns_listings
                ? `Off. ${listingsLine} Turn it on to create a private link.`
                : `${name} has no listings as owner yet. You can still turn the page on; it shows listings as soon as they are published.`}
            </Text>
          ) : null}
        </View>

        {error ? <Banner kind="error" text={error} /> : null}
        {notice ? <Banner kind="success" text={notice} /> : null}

        {data?.enabled ? (
          <>
            <PrimaryButton
              label="Send on WhatsApp"
              icon="logo-whatsapp"
              disabled={!contact.phone || !data.share_message}
              onPress={() => void sendOnWhatsApp()}
              testID="seller-page-send"
            />
            <View style={styles.row}>
              {(
                [
                  { icon: 'copy-outline', label: 'Copy', onPress: copyLink },
                  {
                    icon: 'refresh-outline',
                    label: 'New link',
                    onPress: confirmRotate,
                    action: 'rotate',
                  },
                  {
                    icon: 'power-outline',
                    label: 'Turn off',
                    onPress: () => void run('disable'),
                    action: 'disable',
                  },
                ] as const
              ).map((item) => (
                <Pressable
                  key={item.label}
                  onPress={() => void item.onPress()}
                  disabled={Boolean(pending)}
                  accessibilityRole="button"
                  accessibilityLabel={item.label}
                  style={({ pressed }) => [
                    styles.secondary,
                    {
                      borderColor: colors.glassBorder,
                      backgroundColor: colors.surface,
                      opacity: pending ? 0.45 : pressed ? 0.75 : 1,
                    },
                  ]}
                >
                  {'action' in item && pending === item.action ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <Ionicons
                      name={item.icon}
                      size={17}
                      color={colors.primary}
                    />
                  )}
                  <Text
                    style={{
                      color: colors.text,
                      fontFamily: f.semibold,
                      fontSize: 13,
                    }}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : (
          <PrimaryButton
            label="Turn on"
            icon="globe-outline"
            busy={pending === 'enable'}
            disabled={status.isLoading || !data}
            onPress={() => void run('enable')}
            testID="seller-page-enable"
          />
        )}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  panel: {
    minHeight: 72,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    justifyContent: 'center',
  },
  loading: {
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  secondary: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
});
