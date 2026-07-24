import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { forwardRef, useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { avatarHue, initials } from '@/lib/format';
import {
  radius,
  shadows,
  spacing,
  useBrandGradient,
  useTheme,
  fonts,
} from '@/lib/theme';

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
  const { colors, dark, fonts: f } = useTheme();
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
      <Text style={{ color: fg, fontFamily: f.bold, fontSize: size * 0.38 }}>
        {initials(name)}
      </Text>
    </View>
  );

  if (!ring) return core;
  // Spec rule 5: light = 2.5px solid bright-green ring; dark = thin
  // lime ring with a soft lime glow (no gradient sweep).
  const ringStyle = dark
    ? {
        borderWidth: 1.5,
        borderColor: 'rgba(198,246,141,0.55)',
        shadowColor: '#C6F68D',
        shadowOpacity: 0.22,
        shadowRadius: 9,
        shadowOffset: { width: 0, height: 0 },
        elevation: 4,
      }
    : { borderWidth: 2.5, borderColor: colors.success };
  const pad = 2.5;
  return (
    <View
      style={{
        width: size + pad * 2 + 5,
        height: size + pad * 2 + 5,
        borderRadius: (size + pad * 2 + 5) / 2,
        alignItems: 'center',
        justifyContent: 'center',
        ...ringStyle,
      }}
    >
      {core}
    </View>
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
  const { colors, fonts: f } = useTheme();
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
  const { colors, dark, fonts: f } = useTheme();
  if (count <= 0) return null;
  return (
    <View
      accessibilityLabel={`${count} unread`}
      style={{
        minWidth: 22,
        height: 22,
        borderRadius: 11,
        backgroundColor: colors.success,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 6,
      }}
    >
      <Text style={{ color: dark ? '#10220F' : '#FFFFFF', fontSize: 12, fontFamily: f.bold }}>
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
  const { colors, fonts: f } = useTheme();
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
        backgroundColor: active ? colors.primary : colors.glass,
        borderWidth: 1,
        borderColor: active ? colors.primary : colors.glassBorder,
      }}
    >
      <Text
        style={{
          fontSize: 13,
          fontFamily: f.bold,
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
  const { colors, fonts: f } = useTheme();
  const fg = color ?? colors.mintText;
  return (
    <View
      style={{
        borderRadius: radius.sm,
        paddingHorizontal: 6,
        paddingVertical: 1.5,
        backgroundColor: colors.glass,
        borderWidth: 1,
        borderColor: colors.glassBorder,
        // In a tight row the tag truncates rather than crushing its
        // sibling (e.g. a long name_tag squeezing the agent's name out).
        flexShrink: 1,
      }}
    >
      <Text style={{ fontSize: 11, fontFamily: f.bold, color: fg }} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** Shimmering placeholder block while a list loads. */
export function Skeleton({ style }: { style?: ViewStyle }) {
  const { colors, dark, fonts: f } = useTheme();
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
        { backgroundColor: colors.surfaceSunken, borderRadius: radius.sm, overflow: 'hidden' },
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

/**
 * Shared chrome for list rows rendered as floating cards (Inbox,
 * Contacts, skeletons). Kept as a plain object so Link-asChild sites
 * can `StyleSheet.flatten([listCard, {...colors}])`
 * into the single flat style expo-router's Slot requires.
 */
export const listCard: ViewStyle = {
  flexDirection: 'row',
  alignItems: 'center',
  gap: spacing.md,
  marginHorizontal: spacing.lg,
  marginBottom: spacing.md - 2,
  paddingHorizontal: spacing.md,
  paddingVertical: spacing.md,
  borderRadius: radius.lg,
  borderWidth: 1,
};

export function ConversationSkeleton() {
  const { colors, fonts: f } = useTheme();
  return (
    <View
      style={[
        listCard,
        { backgroundColor: colors.glass, borderColor: colors.glassBorder },
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

/** Placeholder matching the tall photo-first PropertyCard geometry. */
export function PropertyCardSkeleton() {
  const { colors, fonts: f } = useTheme();
  return (
    <View
      style={[
        {
          marginHorizontal: spacing.lg,
          marginBottom: spacing.md,
          padding: spacing.sm,
          borderRadius: radius.lg,
          borderWidth: 1,
          backgroundColor: colors.glass,
          borderColor: colors.glassBorder,
          gap: spacing.sm,
        },
      ]}
    >
      <Skeleton style={{ height: 168, borderRadius: radius.md }} />
      <View style={{ paddingHorizontal: spacing.xs, gap: spacing.sm, paddingBottom: spacing.xs }}>
        <Skeleton style={{ height: 15, width: '65%' }} />
        <Skeleton style={{ height: 12, width: '40%' }} />
      </View>
    </View>
  );
}

export function EmptyState({
  icon,
  title,
  subtitle,
  action,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  /** Optional CTA rendered under the copy (e.g. widen-search button). */
  action?: React.ReactNode;
}) {
  const { colors, fonts: f } = useTheme();
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
      <Text style={{ fontSize: 17, fontFamily: f.bold, color: colors.text, textAlign: 'center' }}>
        {title}
      </Text>
      {subtitle ? (
        <Text style={{ fontSize: 14, color: colors.textMuted, textAlign: 'center', lineHeight: 20 }}>
          {subtitle}
        </Text>
      ) : null}
      {action}
    </View>
  );
}

/** Uppercase micro-label above a section of content. */
export function SectionLabel({ text, style }: { text: string; style?: TextStyle }) {
  const { colors, fonts: f } = useTheme();
  return (
    <Text
      style={[
        {
          fontSize: 12.5,
          fontFamily: f.bold,
          textTransform: 'uppercase',
          letterSpacing: 0.4,
          color: colors.textFaint,
        },
        style,
      ]}
    >
      {text}
    </Text>
  );
}

/**
 * The one search field — pill-shaped, raised, with a labelled clear
 * button. Extra TextInput props (onFocus/onBlur/keyboard…) pass
 * through for autocomplete-style consumers.
 */
export function SearchBar({
  value,
  onChangeText,
  placeholder,
  ...inputProps
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
} & Omit<React.ComponentProps<typeof TextInput>, 'value' | 'onChangeText' | 'placeholder' | 'style'>) {
  const { colors, fonts: f } = useTheme();
  return (
    <View
      style={[
        sharedStyles.searchWrap,
        { backgroundColor: colors.glass, borderColor: colors.glassBorder },
      ]}
    >
      <Ionicons name="search" size={16} color={colors.textFaint} />
      <TextInput
        style={[sharedStyles.searchInput, { color: colors.text, fontFamily: f.medium }]}
        placeholder={placeholder}
        placeholderTextColor={colors.textFaint}
        value={value}
        onChangeText={onChangeText}
        {...inputProps}
      />
      {value ? (
        <Pressable
          onPress={() => onChangeText('')}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
        >
          <Ionicons name="close-circle" size={16} color={colors.textFaint} />
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * The one text field: optional uppercase label above, optional
 * leading icon, consistent metrics. Replaces the five hand-rolled
 * input styles that had drifted across login/contact/appointment/
 * template forms.
 */
export const TextField = forwardRef<
  TextInput,
  {
    label?: string;
    icon?: keyof typeof Ionicons.glyphMap;
  } & React.ComponentProps<typeof TextInput>
>(function TextField({ label, icon, ...props }, ref) {
  const { colors, fonts: f } = useTheme();
  const input = (
    <View
      style={[
        sharedStyles.fieldWrap,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      {icon ? <Ionicons name={icon} size={18} color={colors.textFaint} /> : null}
      <TextInput
        ref={ref}
        style={[
          sharedStyles.fieldInput,
          { color: colors.text },
          props.multiline ? { minHeight: 84, textAlignVertical: 'top' } : null,
        ]}
        placeholderTextColor={colors.textFaint}
        accessibilityLabel={label ?? (typeof props.placeholder === 'string' ? props.placeholder : undefined)}
        {...props}
      />
    </View>
  );
  if (!label) return input;
  return (
    <View style={{ gap: spacing.sm }}>
      <SectionLabel text={label} style={{ color: colors.textMuted }} />
      {input}
    </View>
  );
});

/**
 * The one primary CTA — brand-gradient fill (the brand rule; flat
 * green buttons were the drift). Busy state swaps in a spinner.
 */
export function PrimaryButton({
  label,
  onPress,
  busy = false,
  disabled = false,
  icon,
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const { colors, fonts: f } = useTheme();
  return (
    <Pressable
      disabled={disabled || busy}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || busy, busy }}
      android_ripple={{ color: 'rgba(0,0,0,0.12)', foreground: true }}
      style={({ pressed }) => [
        sharedStyles.primaryButton,
        {
          backgroundColor: colors.primary,
          opacity: disabled || busy ? 0.55 : pressed ? 0.85 : 1,
        },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={colors.onPrimary} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={17} color={colors.onPrimary} /> : null}
          <Text style={{ color: colors.onPrimary, fontSize: 16, fontFamily: f.semibold }}>
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

/** Brand-gradient hero panel (dashboard pipeline, credits balance). */
export function GradientHero({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  const gradient = useBrandGradient();
  return (
    <LinearGradient
      colors={gradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[sharedStyles.hero, shadows.hero, style]}
    >
      {children}
    </LinearGradient>
  );
}

/** Inline error/info banner. */
export function Banner({ kind, text }: { kind: 'error' | 'info' | 'success'; text: string }) {
  const { colors, fonts: f } = useTheme();
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
      <Text style={{ color: map[kind].fg, fontSize: 13.5, fontFamily: f.semibold, lineHeight: 19 }}>
        {text}
      </Text>
    </View>
  );
}

const sharedStyles = StyleSheet.create({
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.lg,
  },
  searchInput: { flex: 1, paddingVertical: 11, fontSize: 14.5, fontFamily: fonts.medium },
  fieldWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: 14,
  },
  fieldInput: { flex: 1, paddingVertical: 12, fontSize: 15 },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: radius.full,
    minHeight: 52,
    overflow: 'hidden',
  },
  hero: {
    borderRadius: radius.xl,
    padding: spacing.xl,
    gap: 6,
  },
});
