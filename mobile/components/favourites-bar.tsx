import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { useFavorites } from '@/lib/favorites-store';
import { haptic } from '@/lib/haptics';
import { favoriteLinks } from '@/lib/menu';
import { radius, spacing, useTheme } from '@/lib/theme';

/**
 * The pinned-destinations strip, summoned by the Favourites tab and
 * floating just above the tab bar in the same glass as it.
 *
 * Stays mounted and animates between states rather than unmounting:
 * a spring that has to wait for a fresh mount to start reads as lag on
 * a control this small. It is hidden from touches AND from the
 * accessibility tree while closed, so a collapsed bar is not a
 * screenful of invisible buttons to a screen reader.
 *
 * Pinning itself lives on the More rows — this is the fast way back to
 * what you pinned, not where you manage the list.
 */

/** Drag far enough (or fast enough) downward and the bar dismisses. */
const DISMISS_DISTANCE = 40;
const DISMISS_VELOCITY = 600;

export function FavouritesBar({
  open,
  onClose,
  bottomOffset,
}: {
  open: boolean;
  onClose: () => void;
  /** Distance from the screen bottom to the top of the tab bar. */
  bottomOffset: number;
}) {
  const { colors, dark, fonts: f, shadows } = useTheme();
  const favorites = favoriteLinks(useFavorites((s) => s.ids));

  const progress = useSharedValue(0);
  const drag = useSharedValue(0);

  // The drag offset is owned entirely by the gesture — it always
  // settles itself on release, so closing the bar never has to reach in
  // and reset it.
  const pan = Gesture.Pan()
    .onUpdate((e) => {
      drag.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      const dismissed =
        e.translationY > DISMISS_DISTANCE || e.velocityY > DISMISS_VELOCITY;
      if (dismissed) {
        drag.value = withTiming(0, { duration: 140 });
        runOnJS(onClose)();
      } else {
        drag.value = withSpring(0, { damping: 18, stiffness: 240 });
      }
    });

  useEffect(() => {
    progress.value = withSpring(open ? 1 : 0, { damping: 16, stiffness: 220 });
  }, [open, progress]);

  const shellStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [
      { translateY: (1 - progress.value) * 24 + drag.value },
      { scale: 0.96 + progress.value * 0.04 },
    ],
  }));

  function go(href: string) {
    haptic.tap();
    onClose();
    router.push(href as Parameters<typeof router.push>[0]);
  }

  return (
    <Animated.View
      pointerEvents={open ? 'auto' : 'none'}
      accessibilityElementsHidden={!open}
      importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}
      style={[
        styles.shell,
        {
          bottom: bottomOffset + spacing.sm,
          backgroundColor: colors.tabBar,
          borderColor: colors.glassBorder,
          shadowColor: shadows.card.shadowColor,
        },
        shellStyle,
      ]}
    >
      <BlurView
        intensity={40}
        tint={dark ? 'dark' : 'light'}
        blurMethod="none"
        style={StyleSheet.absoluteFill}
      />

      <GestureDetector gesture={pan}>
        <Pressable
          onPress={() => {
            haptic.tap();
            onClose();
          }}
          accessibilityRole="button"
          accessibilityLabel="Collapse favourites"
          style={styles.grabArea}
        >
          <View
            style={[styles.grabber, { backgroundColor: colors.textFaint }]}
          />
        </Pressable>
      </GestureDetector>

      {favorites.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="star-outline" size={16} color={colors.textFaint} />
          <Text style={{ flex: 1, fontSize: 13, color: colors.textMuted }}>
            Nothing pinned yet.
          </Text>
          <Pressable
            onPress={() => go('/(app)/(tabs)/more')}
            accessibilityRole="button"
            accessibilityLabel="Open More to pin favourites"
            hitSlop={8}
          >
            <Text
              style={{
                fontSize: 13,
                fontFamily: f.bold,
                color: colors.primary,
              }}
            >
              Pin from More
            </Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
          keyboardShouldPersistTaps="handled"
        >
          {favorites.map((fav) => (
            <Pressable
              key={fav.id}
              onPress={() => go(fav.href)}
              accessibilityRole="button"
              accessibilityLabel={fav.label}
              style={({ pressed }) => [
                styles.chip,
                {
                  backgroundColor: colors.primarySoft,
                  borderColor: colors.glassBorder,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Ionicons name={fav.icon} size={16} color={colors.primary} />
              <Text
                style={{
                  fontSize: 13,
                  fontFamily: f.semibold,
                  color: colors.text,
                }}
                numberOfLines={1}
              >
                {fav.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  shell: {
    position: 'absolute',
    left: 18,
    right: 18,
    borderRadius: 26,
    borderWidth: 1,
    overflow: 'hidden',
    paddingBottom: spacing.md,
    elevation: 10,
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  // A wide, shallow target: the grabber is 4px tall but the tap area
  // around it is finger-sized.
  grabArea: { alignItems: 'center', paddingTop: 8, paddingBottom: 6 },
  grabber: { width: 36, height: 4, borderRadius: 2, opacity: 0.5 },
  chips: {
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 13,
    paddingVertical: 9,
  },
  empty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: 2,
  },
});
