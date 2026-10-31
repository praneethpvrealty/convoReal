import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { EmptyState, PrimaryButton } from '@/components/ui';
import { haptic } from '@/lib/haptics';
import { radius, spacing, useTheme } from '@/lib/theme';

export function LoadErrorState({
  title = 'Couldn’t load this',
  subtitle = 'Check your connection and try again.',
  onRetry,
}: {
  title?: string;
  subtitle?: string;
  onRetry: () => void;
}) {
  return (
    <EmptyState
      icon="cloud-offline-outline"
      title={title}
      subtitle={subtitle}
      action={<RetryButton onRetry={onRetry} />}
    />
  );
}

export function NotFoundState({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <EmptyState
      icon="search-outline"
      title={title}
      subtitle={subtitle}
      action={
        <View style={{ alignSelf: 'stretch' }}>
          <PrimaryButton label="Back" onPress={() => router.back()} />
        </View>
      }
    />
  );
}

export function InlineLoadError({
  label = 'Couldn’t load',
  onRetry,
}: {
  label?: string;
  onRetry: () => void;
}) {
  const { colors, fonts: f } = useTheme();
  return (
    <View
      style={[styles.inline, { backgroundColor: colors.warningSoft }]}
      accessibilityRole="alert"
    >
      <Ionicons name="cloud-offline-outline" size={16} color={colors.warning} />
      <Text
        style={{
          flex: 1,
          fontSize: 13,
          fontFamily: f.semibold,
          color: colors.text,
        }}
      >
        {label}
      </Text>
      <Pressable
        onPress={() => {
          haptic.tap();
          onRetry();
        }}
        accessibilityRole="button"
        accessibilityLabel="Retry"
        hitSlop={12}
      >
        <Text
          style={{
            fontSize: 13,
            fontFamily: f.semibold,
            color: colors.primary,
          }}
        >
          Retry
        </Text>
      </Pressable>
    </View>
  );
}

function RetryButton({ onRetry }: { onRetry: () => void }) {
  const { colors, fonts: f } = useTheme();
  return (
    <Pressable
      onPress={() => {
        haptic.tap();
        onRetry();
      }}
      accessibilityRole="button"
      accessibilityLabel="Retry"
      style={({ pressed }) => [
        styles.retry,
        { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 },
      ]}
    >
      <Ionicons name="refresh" size={16} color={colors.onPrimary} />
      <Text
        style={{
          fontSize: 14,
          fontFamily: f.semibold,
          color: colors.onPrimary,
        }}
      >
        Retry
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  inline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  retry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.full,
    paddingHorizontal: spacing.xl,
    minHeight: 44,
  },
});
