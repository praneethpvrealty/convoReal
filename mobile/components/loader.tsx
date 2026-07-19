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
  const [w, setW] = useState(0);
  const x = useSharedValue(0);
  const h = Math.ceil(size * 1.25);

  useEffect(() => {
    if (!w || reduced) return;
    x.value = -w;
    x.value = withRepeat(withTiming(0, { duration: 1600, easing: Easing.linear }), -1, false);
  }, [w, reduced, x]);

  const anim = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  const wordmark = (
    <Text
      onLayout={(e) => setW(Math.ceil(e.nativeEvent.layout.width))}
      style={{
        fontSize: size,
        fontFamily: f.extrabold,
        letterSpacing: -0.02 * size,
        lineHeight: h,
        color: colors.primary,
      }}
    >
      ConvoReal
    </Text>
  );

  // First render measures the wordmark; reduced motion keeps it static
  // (the web's prefers-reduced-motion fallback is plain primary text).
  if (reduced || !w) {
    return (
      <View accessibilityLabel={label} style={style}>
        {wordmark}
      </View>
    );
  }

  return (
    <View accessibilityLabel={label} style={style}>
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
