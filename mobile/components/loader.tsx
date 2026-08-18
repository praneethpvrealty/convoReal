import MaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';
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
  shimmer = true,
  style,
}: {
  size?: number;
  label?: string;
  shimmer?: boolean;
  style?: ViewStyle;
}) {
  const { colors, fonts: f } = useTheme();
  const reduced = useReducedMotion();
  const [box, setBox] = useState({ width: 0, height: 0 });
  const x = useSharedValue(0);
  const { width: w, height: h } = box;

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
    lineHeight: Math.ceil(size * 1.25),
    color: colors.primary,
  } as const;

  const wordmark = (
    <Text numberOfLines={1} ellipsizeMode="clip" style={textStyle}>
      ConvoReal
    </Text>
  );

  // The wordmark itself owns the box, and the mask is laid over it —
  // so the mask is always exactly as wide as the glyphs it hides,
  // whatever font is resolved. Sizing the mask from an onLayout
  // measurement instead left it a mask-width behind the real
  // ExtraBold render (the boot screen mounts this while the custom
  // fonts are still loading) and the wordmark read "ConvoRe".
  // The measurement now only paces the shimmer: while it is stale the
  // band drifts, it never clips a letter.
  const masked = shimmer && !reduced && w > 0;

  return (
    <View accessibilityLabel={label} style={style}>
      <View
        style={{ alignSelf: 'flex-start' }}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          setBox((prev) =>
            Math.abs(prev.width - width) < 1 && Math.abs(prev.height - height) < 1
              ? prev
              : { width, height }
          );
        }}
      >
        <Text
          numberOfLines={1}
          ellipsizeMode="clip"
          style={[textStyle, masked && { opacity: 0 }]}
        >
          ConvoReal
        </Text>
        {masked ? (
          <MaskedView style={StyleSheet.absoluteFill} maskElement={wordmark}>
            <View style={{ flex: 1, overflow: 'hidden' }}>
              <AnimatedGradient
                colors={[colors.primary, colors.shimmer, colors.primary]}
                locations={[0.4, 0.5, 0.6]}
                start={{ x: 0, y: 0.3 }}
                end={{ x: 1, y: 0.7 }}
                style={[
                  { position: 'absolute', top: 0, left: 0, width: w * 2, height: h },
                  anim,
                ]}
              />
            </View>
          </MaskedView>
        ) : null}
      </View>
    </View>
  );
}
