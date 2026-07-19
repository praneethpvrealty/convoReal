import { BlurView } from 'expo-blur';
import { Platform, StyleSheet, View, type ViewStyle } from 'react-native';

import { radius, useTheme } from '@/lib/theme';

interface GlassCardProps {
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
  /** Corner radius; defaults to radius.lg (20). */
  r?: number;
  /**
   * Enable a real BlurView — ONLY for floating bars over scrolling
   * content (tab bar, chat composer, sticky bottom bars). The aurora
   * background is a static image, so anything inside a scroll view
   * looks identical with just the translucent fill and stays 60fps
   * on Android.
   */
  blurred?: boolean;
  blurIntensity?: number;
}

/** Frosted-glass container — the workhorse surface of the glass UI. */
export function GlassCard({
  children,
  style,
  r = radius.lg,
  blurred = false,
  blurIntensity,
}: GlassCardProps) {
  const { colors, dark } = useTheme();
  // No shadow on purpose: elevation/shadow renders UNDER the view and
  // bleeds through a translucent fill as a grey band. Glass depth
  // comes from the fill + 1px border.
  return (
    <View
      style={[
        styles.frame,
        {
          borderColor: colors.glassBorder,
          borderRadius: r,
          backgroundColor: colors.glass,
        },
        ...(Array.isArray(style) ? style : [style]),
      ]}
    >
      {blurred ? (
        <BlurView
          intensity={blurIntensity ?? (dark ? 18 : 16)}
          tint={dark ? 'dark' : 'light'}
          experimentalBlurMethod={
            Platform.OS === 'android' ? 'dimezisBlurView' : undefined
          }
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    borderWidth: 1,
    overflow: 'hidden',
  },
});
