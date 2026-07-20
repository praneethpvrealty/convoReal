import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { haptic } from '@/lib/haptics';

/**
 * Press physics: content scales to ~0.97 with a spring while pressed.
 * The Pressable itself keeps a flat style (so it stays safe as a
 * <Link asChild> child — see the Slot flatten rule); the animation
 * lives on an inner Animated.View.
 */
export function PressScale({
  children,
  style,
  contentStyle,
  onPress,
  onPressIn,
  onPressOut,
  hapticOn = true,
  ...rest
}: {
  children: React.ReactNode;
  /** Flat style for the outer Pressable (hit area). */
  style?: ViewStyle;
  /** Visual style (card chrome) — animated. */
  contentStyle?: ViewStyle | ViewStyle[];
  onPress?: () => void;
  hapticOn?: boolean;
} & Omit<React.ComponentProps<typeof Pressable>, 'style' | 'onPress' | 'children'>) {
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Pressable
      style={style}
      onPress={() => {
        if (hapticOn) haptic.tap();
        onPress?.();
      }}
      onPressIn={(e) => {
        scale.value = withSpring(0.965, { damping: 18, stiffness: 300 });
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.value = withSpring(1, { damping: 14, stiffness: 220 });
        onPressOut?.(e);
      }}
      {...rest}
    >
      <Animated.View style={[animated, StyleSheet.flatten(contentStyle)]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}

/**
 * Staggered list entrance — wrap a row, pass its index.
 *
 * Opacity-only on purpose: translate-based entering animations
 * (FadeInDown etc.) can leave rows stuck mid-transform on Android's
 * new architecture in Expo Go, visually displacing content inside
 * list cells. Fade never touches layout, so it cannot.
 */
export function EnterRow({
  index,
  children,
  animateLayout = false,
}: {
  index: number;
  children: React.ReactNode;
  /** Animate position shifts (e.g. a sibling expanding above) instead
   *  of jumping — used by lists with inline hold-to-peek expansion. */
  animateLayout?: boolean;
}) {
  // Cap the stagger so deep scroll positions don't wait forever.
  const delay = Math.min(index, 10) * 26;
  return (
    <Animated.View
      layout={animateLayout ? LinearTransition.duration(180) : undefined}
      entering={FadeIn.duration(200).delay(delay)}
    >
      {children}
    </Animated.View>
  );
}

/**
 * One expanding-fading ring of the pulse. Rings restart from 0 each
 * loop; the second ring's initial delay offsets its phase so the
 * pulse reads as a continuous heartbeat.
 */
function Ring({ size, color, delay }: { size: number; color: string; delay: number }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      delay,
      withRepeat(withTiming(1, { duration: 1900, easing: Easing.out(Easing.quad) }), -1, false)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const style = useAnimatedStyle(() => ({
    opacity: 0.65 * (1 - progress.value),
    transform: [{ scale: 1 + 0.55 * progress.value }],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 2,
          borderColor: color,
        },
        style,
      ]}
    />
  );
}

/**
 * Pulsating attention ring — wraps a circular control (approve
 * button, status dot) with soft radiating rings that say "waiting
 * for you" without alarming. Size the wrapper to the child.
 */
export function PulseRing({
  size,
  color,
  children,
}: {
  size: number;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Ring size={size} color={color} delay={0} />
      <Ring size={size} color={color} delay={950} />
      {children}
    </View>
  );
}

/** Count-up number for stat cards. Counts from 0 on mount, then from
 *  the previously shown value on live updates — so refreshing stats
 *  tick upward instead of restarting. */
export function AnimatedCounter({
  value,
  format,
  style,
}: {
  value: number;
  format?: (n: number) => string;
  style?: React.ComponentProps<typeof Text>['style'];
}) {
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);

  useEffect(() => {
    const from = fromRef.current;
    if (from === value) {
      setDisplay(value);
      return;
    }
    const duration = 650;
    const startTime = Date.now();
    let raf: number;
    const tick = () => {
      const t = Math.min(1, (Date.now() - startTime) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = Math.round(from + (value - from) * eased);
      fromRef.current = next;
      setDisplay(next);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return <Text style={style}>{format ? format(display) : String(display)}</Text>;
}

// ------------------------------------------------------------------
// Confetti — self-contained celebration (no lottie asset needed).
// ------------------------------------------------------------------

// Glass-brand celebration palette: WhatsApp greens + lime + warm accents.
const CONFETTI_COLORS = ['#075E54', '#25D366', '#C6F68D', '#FFC24B', '#FF7A6B'];
const PIECES = 26;

function ConfettiPiece({ seed }: { seed: number }) {
  const progress = useSharedValue(0);
  // Deterministic pseudo-random per piece (Date.now/Math.random-free
  // math keeps renders stable).
  const rand = (n: number) => {
    const x = Math.sin(seed * 127.1 + n * 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  const startX = rand(1) * 320 - 160;
  const drift = rand(2) * 140 - 70;
  const fall = 420 + rand(3) * 260;
  const size = 7 + rand(4) * 6;
  const color = CONFETTI_COLORS[Math.floor(rand(5) * CONFETTI_COLORS.length)];
  const spin = 360 + rand(6) * 720;

  useEffect(() => {
    progress.value = withDelay(
      rand(7) * 250,
      withTiming(1, { duration: 1400 + rand(8) * 600, easing: Easing.out(Easing.quad) })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const style = useAnimatedStyle(() => ({
    opacity: 1 - Math.max(0, progress.value - 0.7) / 0.3,
    transform: [
      { translateX: startX + drift * progress.value },
      { translateY: -40 + fall * progress.value },
      { rotate: `${spin * progress.value}deg` },
    ],
  }));

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          top: 0,
          left: '50%',
          width: size,
          height: size * 0.6,
          borderRadius: 2,
          backgroundColor: color,
        },
        style,
      ]}
    />
  );
}

/** Full-screen celebration overlay; auto-dismisses via onDone. */
export function Confetti({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2100);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {Array.from({ length: PIECES }, (_, i) => (
        <ConfettiPiece key={i} seed={i + 1} />
      ))}
    </View>
  );
}
