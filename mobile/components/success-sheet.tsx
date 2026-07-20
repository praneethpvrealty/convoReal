import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withSpring } from 'react-native-reanimated';

import { Confetti } from '@/components/motion';
import { BottomSheet } from '@/components/sheet';
import { haptic } from '@/lib/haptics';
import { radius, spacing, useTheme } from '@/lib/theme';

export interface SuccessAction {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}

/** Check badge that springs in, then draws attention to the check. */
function SuccessBadge() {
  const { colors } = useTheme();
  const circle = useSharedValue(0);
  const check = useSharedValue(0);

  useEffect(() => {
    circle.value = withSpring(1, { damping: 12, stiffness: 180 });
    check.value = withDelay(140, withSpring(1, { damping: 11, stiffness: 260 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const circleStyle = useAnimatedStyle(() => ({ transform: [{ scale: circle.value }] }));
  const checkStyle = useAnimatedStyle(() => ({
    opacity: check.value,
    transform: [{ scale: check.value }],
  }));

  return (
    <Animated.View
      style={[
        styles.badge,
        { backgroundColor: colors.successSoft, borderColor: colors.success },
        circleStyle,
      ]}
    >
      <Animated.View style={checkStyle}>
        <Ionicons name="checkmark" size={34} color={colors.success} />
      </Animated.View>
    </Animated.View>
  );
}

/**
 * The one celebration surface: success haptic, springing check
 * badge, confetti-lite burst and next-action CTAs, so every "it
 * worked" moment (contact approved, deal won, payment landed)
 * feels like the same product.
 */
export function SuccessSheet({
  visible,
  onClose,
  title,
  message,
  actions = [],
  confetti = true,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  message: string;
  actions?: SuccessAction[];
  confetti?: boolean;
}) {
  const { colors, fonts: f } = useTheme();
  const [burst, setBurst] = useState(false);

  useEffect(() => {
    if (!visible) return;
    haptic.success();
    if (confetti) setBurst(true);
  }, [visible, confetti]);

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      contentStyle={{ paddingHorizontal: spacing.xl, gap: spacing.md, alignItems: 'center' }}
    >
      {burst ? (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}>
          <Confetti onDone={() => setBurst(false)} />
        </View>
      ) : null}
      <SuccessBadge />
      <Text style={[styles.title, { color: colors.text, fontFamily: f.extrabold }]}>{title}</Text>
      <Text style={[styles.message, { color: colors.textMuted }]}>{message}</Text>
      <View style={{ alignSelf: 'stretch', gap: spacing.sm, marginTop: spacing.sm }}>
        {actions.map((action, i) => {
          const primary = i === 0;
          return (
            <Pressable
              key={action.label}
              onPress={() => {
                haptic.tap();
                action.onPress();
              }}
              accessibilityRole="button"
              accessibilityLabel={action.label}
              style={({ pressed }) => [
                styles.action,
                primary
                  ? { backgroundColor: colors.primary }
                  : {
                      backgroundColor: colors.surface,
                      borderWidth: 1,
                      borderColor: colors.glassBorder,
                    },
                { opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <Ionicons
                name={action.icon}
                size={17}
                color={primary ? colors.onPrimary : colors.primary}
              />
              <Text
                style={{
                  fontSize: 15.5,
                  fontFamily: f.semibold,
                  color: primary ? colors.onPrimary : colors.primary,
                }}
              >
                {action.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  badge: {
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
  },
  title: { fontSize: 20, textAlign: 'center', letterSpacing: -0.3 },
  message: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: radius.full,
    minHeight: 50,
  },
});
