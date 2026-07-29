import MaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { Text, View, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '@/lib/theme';

const AnimatedGradient = Animated.createAnimatedComponent(LinearGradient);

/**
 * Port of the web's ConvoRealLoader (convoreal-loader.tsx): the
 * wordmark with a bright band sweeping through the letters. CSS does
 * it with background-clip:text; here the animated gradient shows
 * through a text mask. Same 1.6s linear loop, same primary→white→
 * primary band, sized by `size` (font px) like the web.
 */
export function ConvoRealLoader({
  size = 22,
  label = 'Loading',
  style,
}: {
  size?: number;
  label?: string;
  style?: ViewStyle;
}) {
  const { colors, fonts: f } = useTheme();
  const reduced = useReducedMotion();
  const [measured, setMeasured] = useState<{ size: number; width: number } | null>(null);
  const x = useSharedValue(0);
  const h = Math.ceil(size * 1.25);
  // A measurement taken at another font size is stale — fall back to 0
  // so the measurer's next layout pass supplies the right one.
  const w = measured?.size === size ? measured.width : 0;

  useEffect(() => {
    if (!w || reduced) return;
    x.value = -w;
    x.value = withRepeat(withTiming(0, { duration: 1600, easing: Easing.linear }), -1, false);
  }, [w, reduced, x]);

  const anim = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  const textStyle = {
    fontSize: size,
    fontFamily: f.extrabold,
    letterSpacing: -0.02 * size,
    lineHeight: h,
    color: colors.primary,
  } as const;

  // Invisible copy that owns measurement for the whole lifetime — NOT
  // just the first layout. The boot screen mounts this loader while the
  // custom fonts are still loading, so the first layout measures the
  // narrower system-fallback glyphs; freezing that width left the real
  // ExtraBold render wrapping inside a too-small mask box, and the
  // one-line-tall mask clipped it to "ConvoRe". Re-measuring on every
  // layout change means the font swap simply resizes the mask.
  // The wide zero-height frame matters: Yoga clamps an absolute child
  // to its parent's width, and the parent is the mask-sized box — a
  // clamped measurer would just echo the stale width back forever.
  // (+2 slack: Android's reported width can land a hair under the real
  // glyph advance.)
  const measurer = (
    <View pointerEvents="none" style={{ position: 'absolute', width: 9999, height: 0, opacity: 0 }}>
      <Text
        numberOfLines={1}
        style={[textStyle, { alignSelf: 'flex-start' }]}
        onLayout={(e) => {
          const width = Math.ceil(e.nativeEvent.layout.width) + 2;
          setMeasured((prev) =>
            prev?.size === size && prev.width === width ? prev : { size, width },
          );
        }}
      >
        ConvoReal
      </Text>
    </View>
  );

  const wordmark = (
    <Text numberOfLines={1} ellipsizeMode="clip" style={textStyle}>
      ConvoReal
    </Text>
  );

  // First render measures the wordmark; reduced motion keeps it static
  // (the web's prefers-reduced-motion fallback is plain primary text).
  if (reduced || !w) {
    return (
      <View accessibilityLabel={label} style={style}>
        {measurer}
        {wordmark}
      </View>
    );
  }

  return (
    <View accessibilityLabel={label} style={style}>
      {measurer}
      <MaskedView style={{ width: w, height: h }} maskElement={wordmark}>
        <View style={{ width: w, height: h, overflow: 'hidden' }}>
          <AnimatedGradient
            colors={[colors.primary, '#FFFFFF', colors.primary]}
            locations={[0.4, 0.5, 0.6]}
            start={{ x: 0, y: 0.3 }}
            end={{ x: 1, y: 0.7 }}
            style={[{ position: 'absolute', top: 0, left: 0, width: w * 2, height: h }, anim]}
          />
        </View>
      </MaskedView>
    </View>
  );
}
