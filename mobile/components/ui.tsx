import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { avatarHue, initials } from '@/lib/format';
import { hotGradient, radius, shadows, spacing, useTheme , fonts } from '@/lib/theme';

/**
 * Initials avatar with a deterministic hue per contact. `ring` draws
 * an Instagram-style gradient ring (used for HOT leads).
 */
export function Avatar({
  name,
  size = 46,
  ring = false,
}: {
  name: string;
  size?: number;
  ring?: boolean;
}) {
  const { dark } = useTheme();
  const hue = avatarHue(name);
  const bg = dark ? `hsl(${hue}, 42%, 26%)` : `hsl(${hue}, 65%, 90%)`;
  const fg = dark ? `hsl(${hue}, 70%, 78%)` : `hsl(${hue}, 55%, 34%)`;

  const core = (
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
      <Text style={{ color: fg, fontFamily: fonts.bold, fontSize: size * 0.38 }}>
        {initials(name)}
      </Text>
    </View>
  );

  if (!ring) return core;
  const pad = Math.max(2.5, size * 0.055);
  return (
    <LinearGradient
      colors={hotGradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{
        width: size + pad * 2 + 3,
        height: size + pad * 2 + 3,
        borderRadius: (size + pad * 2 + 3) / 2,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View
        style={{
          padding: 1.5,
          borderRadius: (size + 3) / 2,
          backgroundColor: dark ? '#121016' : '#ffffff',
        }}
      >
        {core}
      </View>
    </LinearGradient>
  );
}

/**
 * Icon-only button with a guaranteed 44pt touch target and a screen-
 * reader name. Every icon-only Pressable should be one of these —
 * bare icons are silent (or mispronounced) under VoiceOver/TalkBack.
 */
export function IconButton({
  icon,
  label,
  onPress,
  size = 20,
  color,
  disabled = false,
  style,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  size?: number;
  color?: string;
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={disabled ? { disabled: true } : undefined}
      style={[
        {
          minWidth: 36,
          minHeight: 36,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: disabled ? 0.4 : 1,
        },
        style,
      ]}
    >
      <Ionicons name={icon} size={size} color={color ?? colors.text} />
    </Pressable>
  );
}

export function UnreadBadge({ count }: { count: number }) {
  const { colors } = useTheme();
  if (count <= 0) return null;
  return (
    <View
      accessibilityLabel={`${count} unread`}
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
      <Text style={{ color: colors.onPrimary, fontSize: 12, fontFamily: fonts.bold }}>
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
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      style={{
        paddingHorizontal: 15,
        paddingVertical: 9,
        borderRadius: radius.full,
        backgroundColor: active ? colors.primary : colors.surfaceRaised,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: active ? colors.primary : colors.border,
      }}
    >
      <Text
        style={{
          fontSize: 13,
          fontFamily: fonts.bold,
          color: active ? colors.onPrimary : colors.text,
        }}
      >
        {label}
      </Text>
    </Pressable>
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
      <Text style={{ fontSize: 11, fontFamily: fonts.bold, color: fg }}>{label}</Text>
    </View>
  );
}

/** Shimmering placeholder block while a list loads. */
export function Skeleton({ style }: { style?: ViewStyle }) {
  const { colors, dark } = useTheme();
  const sweep = useRef(new Animated.Value(-1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(sweep, { toValue: 1, duration: 1100, useNativeDriver: true })
    );
    loop.start();
    return () => loop.stop();
  }, [sweep]);

  const translateX = sweep.interpolate({ inputRange: [-1, 1], outputRange: [-160, 160] });
  const sheen = dark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.65)';

  return (
    <View
      style={[
        { backgroundColor: colors.incomingBubble, borderRadius: radius.sm, overflow: 'hidden' },
        style,
      ]}
    >
      <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateX }] }]}>
        <LinearGradient
          colors={['transparent', sheen, 'transparent']}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    </View>
  );
}

export function ConversationSkeleton() {
  const { colors } = useTheme();
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          gap: spacing.md,
          alignItems: 'center',
          marginHorizontal: spacing.lg,
          marginBottom: spacing.md - 2,
          padding: spacing.md,
          borderRadius: radius.lg,
          backgroundColor: colors.surfaceRaised,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.border,
        },
        shadows.card,
      ]}
    >
      <Skeleton style={{ width: 50, height: 50, borderRadius: 25 }} />
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
      <Text style={{ fontSize: 17, fontFamily: fonts.bold, color: colors.text, textAlign: 'center' }}>
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
      <Text style={{ color: map[kind].fg, fontSize: 13.5, fontFamily: fonts.semibold, lineHeight: 19 }}>
        {text}
      </Text>
    </View>
  );
}
