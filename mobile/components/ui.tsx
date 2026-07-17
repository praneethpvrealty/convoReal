import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { avatarHue, initials } from '@/lib/format';
import { radius, spacing, useTheme } from '@/lib/theme';

/** Initials avatar with a deterministic hue per contact. */
export function Avatar({ name, size = 46 }: { name: string; size?: number }) {
  const { dark } = useTheme();
  const hue = avatarHue(name);
  const bg = dark ? `hsl(${hue}, 42%, 26%)` : `hsl(${hue}, 65%, 90%)`;
  const fg = dark ? `hsl(${hue}, 70%, 78%)` : `hsl(${hue}, 55%, 34%)`;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: bg,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: fg, fontWeight: '700', fontSize: size * 0.38 }}>
        {initials(name)}
      </Text>
    </View>
  );
}

export function UnreadBadge({ count }: { count: number }) {
  const { colors } = useTheme();
  if (count <= 0) return null;
  return (
    <View
      style={{
        minWidth: 22,
        height: 22,
        borderRadius: 11,
        backgroundColor: colors.primary,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 6,
      }}
    >
      <Text style={{ color: colors.onPrimary, fontSize: 12, fontWeight: '700' }}>
        {count > 99 ? '99+' : count}
      </Text>
    </View>
  );
}

/** Small selectable pill used for inbox filters. */
export function FilterChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Text
      onPress={onPress}
      style={{
        paddingHorizontal: 14,
        paddingVertical: 7,
        borderRadius: radius.full,
        overflow: 'hidden',
        fontSize: 13,
        fontWeight: '600',
        backgroundColor: active ? colors.primary : colors.surface,
        color: active ? colors.onPrimary : colors.textMuted,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: active ? colors.primary : colors.border,
      }}
    >
      {label}
    </Text>
  );
}

/** Tiny labeled tag (Name Tag, classification). */
export function Tag({ label, color }: { label: string; color?: string }) {
  const { colors } = useTheme();
  const fg = color ?? colors.primary;
  return (
    <View
      style={{
        borderRadius: radius.sm,
        paddingHorizontal: 6,
        paddingVertical: 1.5,
        backgroundColor: colors.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.border,
      }}
    >
      <Text style={{ fontSize: 11, fontWeight: '600', color: fg }}>{label}</Text>
    </View>
  );
}

/** Pulsing placeholder block while a list loads. */
export function Skeleton({ style }: { style?: ViewStyle }) {
  const { colors } = useTheme();
  const pulse = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 650, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.45, duration: 650, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <Animated.View
      style={[{ backgroundColor: colors.surface, borderRadius: radius.sm, opacity: pulse }, style]}
    />
  );
}

export function ConversationSkeleton() {
  return (
    <View style={{ flexDirection: 'row', gap: spacing.md, padding: spacing.lg, alignItems: 'center' }}>
      <Skeleton style={{ width: 46, height: 46, borderRadius: 23 }} />
      <View style={{ flex: 1, gap: spacing.sm }}>
        <Skeleton style={{ height: 14, width: '55%' }} />
        <Skeleton style={{ height: 12, width: '85%' }} />
      </View>
    </View>
  );
}

export function EmptyState({
  icon,
  title,
  subtitle,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: 64, paddingHorizontal: 32, gap: spacing.md }}>
      <View
        style={{
          width: 72,
          height: 72,
          borderRadius: 36,
          backgroundColor: colors.primarySoft,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name={icon} size={32} color={colors.primary} />
      </View>
      <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text, textAlign: 'center' }}>
        {title}
      </Text>
      {subtitle ? (
        <Text style={{ fontSize: 14, color: colors.textMuted, textAlign: 'center', lineHeight: 20 }}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

/** Inline error/info banner. */
export function Banner({ kind, text }: { kind: 'error' | 'info' | 'success'; text: string }) {
  const { colors } = useTheme();
  const map = {
    error: { bg: colors.dangerSoft, fg: colors.danger },
    info: { bg: colors.primarySoft, fg: colors.primary },
    success: { bg: colors.successSoft, fg: colors.success },
  } as const;
  return (
    <View
      style={{
        backgroundColor: map[kind].bg,
        borderRadius: radius.md,
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.md,
      }}
    >
      <Text style={{ color: map[kind].fg, fontSize: 13.5, fontWeight: '600', lineHeight: 19 }}>
        {text}
      </Text>
    </View>
  );
}
