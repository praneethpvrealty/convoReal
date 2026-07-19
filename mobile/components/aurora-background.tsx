import { Image, StyleSheet, View } from 'react-native';

import { useTheme } from '@/lib/theme';

/**
 * The app-wide canvas: solid underlay + pre-baked aurora gradient
 * image (RN can't render radial gradients without extra deps — see
 * docs/design/GLASS_UI_IMPLEMENTATION_SPEC.md; regenerate with
 * scratch/gen_aurora.py). Rendered ONCE behind the root navigator;
 * screens keep transparent backgrounds so it shows through.
 */
export function AuroraBackground() {
  const { colors, dark } = useTheme();
  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]}
    >
      <Image
        source={
          dark
            ? require('@/assets/images/aurora-dark.png')
            : require('@/assets/images/aurora-light.png')
        }
        style={StyleSheet.absoluteFill}
        resizeMode="cover"
        fadeDuration={0}
      />
    </View>
  );
}
