import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Pressable, Share, StyleSheet, Text, View } from 'react-native';

import { haptic } from '@/lib/haptics';
import type { DenSellerPage } from '@/lib/den-api';
import { radius, spacing, useTheme } from '@/lib/theme';

export function DenSellerPageCard({
  pages,
  hasProperties,
}: {
  pages: DenSellerPage[];
  hasProperties: boolean;
}) {
  const { colors, fonts: f } = useTheme();
  const live = pages.filter((page) => page.url);
  const off = hasProperties ? pages.filter((page) => !page.url) : [];
  if (live.length === 0 && off.length === 0) return null;

  async function copy(url: string) {
    await Clipboard.setStringAsync(url);
    haptic.success();
  }

  async function share(page: DenSellerPage) {
    if (!page.url) return;
    haptic.send();
    await Share.share({ message: page.share_message ?? page.url }).catch(
      () => undefined
    );
  }

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.glass, borderColor: colors.glassBorder },
      ]}
    >
      <View style={styles.header}>
        <Ionicons name="globe-outline" size={20} color={colors.primary} />
        <View style={{ flex: 1 }}>
          <Text
            style={{ color: colors.text, fontFamily: f.bold, fontSize: 15 }}
          >
            Your public page
          </Text>
          <Text style={{ color: colors.textMuted, fontSize: 12.5 }}>
            One link with all your live listings. Share it anywhere.
          </Text>
        </View>
      </View>
      {live.map((page) => (
        <View
          key={page.url}
          style={[
            styles.page,
            {
              backgroundColor: colors.surfaceSunken,
              borderColor: colors.glassBorder,
            },
          ]}
        >
          <Text
            selectable
            style={{
              color: colors.text,
              fontFamily: f.semibold,
              fontSize: 13.5,
            }}
          >
            {page.url}
          </Text>
          <Text style={{ color: colors.textMuted, fontSize: 12 }}>
            {`Buyers who open it reach ${page.agency_name || 'your agency'}.`}
          </Text>
          <View style={styles.actions}>
            <Pressable
              onPress={() => void copy(page.url!)}
              accessibilityRole="button"
              accessibilityLabel="Copy link"
              style={({ pressed }) => [
                styles.action,
                {
                  borderColor: colors.glassBorder,
                  backgroundColor: colors.surface,
                  opacity: pressed ? 0.75 : 1,
                },
              ]}
            >
              <Ionicons name="copy-outline" size={16} color={colors.primary} />
              <Text
                style={{
                  color: colors.text,
                  fontFamily: f.semibold,
                  fontSize: 13,
                }}
              >
                Copy link
              </Text>
            </Pressable>
            <Pressable
              onPress={() => void share(page)}
              accessibilityRole="button"
              accessibilityLabel="Share link"
              style={({ pressed }) => [
                styles.action,
                {
                  borderColor: colors.primary,
                  backgroundColor: colors.primary,
                  opacity: pressed ? 0.75 : 1,
                },
              ]}
            >
              <Ionicons
                name="share-social-outline"
                size={16}
                color={colors.onPrimary}
              />
              <Text
                style={{
                  color: colors.onPrimary,
                  fontFamily: f.semibold,
                  fontSize: 13,
                }}
              >
                Share
              </Text>
            </Pressable>
          </View>
        </View>
      ))}
      {off.map((page) => (
        <Text
          key={page.account_id}
          style={{ color: colors.textMuted, fontSize: 12.5 }}
        >
          {`Ask ${page.agency_name || 'your agency'} to switch on your public page.`}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    gap: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  page: {
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.md,
    gap: spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  action: {
    flex: 1,
    minHeight: 40,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
});
