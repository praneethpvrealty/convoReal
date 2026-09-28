import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import Animated, {
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';

import { haptic } from '@/lib/haptics';
import {
  stageWheelMotion,
  wheelIndexForOffset,
  wrapStageIndex,
} from '@/lib/stage-wheel';
import { radius, spacing, useTheme } from '@/lib/theme';

export interface StageWheelItem {
  id: string;
  name: string;
  color: string;
  count: number;
}

const ITEM_WIDTH = 164;

export function StageWheel({
  stages,
  activeId,
  onSelect,
}: {
  stages: StageWheelItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  const { colors } = useTheme();
  const scrollRef = useRef<Animated.ScrollView>(null);
  const scrollX = useSharedValue(0);
  const [width, setWidth] = useState(0);
  const activeIndex = Math.max(
    0,
    stages.findIndex((stage) => stage.id === activeId)
  );

  const onScroll = useAnimatedScrollHandler((event) => {
    scrollX.value = event.contentOffset.x;
  });

  useEffect(() => {
    if (!width) return;
    scrollRef.current?.scrollTo({
      x: activeIndex * ITEM_WIDTH,
      animated: true,
    });
  }, [activeIndex, width]);

  function settle(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const index = wheelIndexForOffset(
      event.nativeEvent.contentOffset.x,
      ITEM_WIDTH,
      stages.length
    );
    const stage = stages[index];
    if (stage && stage.id !== activeId) {
      haptic.tap();
      onSelect(stage.id);
    }
  }

  function settleWithoutMomentum(
    event: NativeSyntheticEvent<NativeScrollEvent>
  ) {
    if (Math.abs(event.nativeEvent.velocity?.x ?? 0) < 0.05) settle(event);
  }

  function turn(step: number) {
    const stage = stages[wrapStageIndex(activeIndex + step, stages.length)];
    if (!stage) return;
    haptic.tap();
    onSelect(stage.id);
  }

  const inset = Math.max(0, (width - ITEM_WIDTH) / 2);

  return (
    <View style={styles.row}>
      <WheelArrow
        icon="chevron-back"
        label="Previous stage"
        onPress={() => turn(-1)}
      />
      <View
        style={styles.track}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      >
        {width ? (
          <Animated.ScrollView
            ref={scrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            snapToInterval={ITEM_WIDTH}
            decelerationRate="fast"
            scrollEventThrottle={16}
            onScroll={onScroll}
            onScrollEndDrag={settleWithoutMomentum}
            onMomentumScrollEnd={settle}
            contentOffset={{ x: activeIndex * ITEM_WIDTH, y: 0 }}
            contentContainerStyle={{ paddingHorizontal: inset }}
          >
            {stages.map((stage, index) => (
              <WheelFace
                key={stage.id}
                stage={stage}
                index={index}
                scrollX={scrollX}
                active={stage.id === activeId}
                activeColor={colors.primary}
                textColor={colors.text}
                mutedColor={colors.textMuted}
                surface={colors.glass}
                border={colors.glassBorder}
                onPress={() => {
                  haptic.tap();
                  onSelect(stage.id);
                }}
              />
            ))}
          </Animated.ScrollView>
        ) : null}
      </View>
      <WheelArrow
        icon="chevron-forward"
        label="Next stage"
        onPress={() => turn(1)}
      />
    </View>
  );
}

function WheelFace({
  stage,
  index,
  scrollX,
  active,
  activeColor,
  textColor,
  mutedColor,
  surface,
  border,
  onPress,
}: {
  stage: StageWheelItem;
  index: number;
  scrollX: SharedValue<number>;
  active: boolean;
  activeColor: string;
  textColor: string;
  mutedColor: string;
  surface: string;
  border: string;
  onPress: () => void;
}) {
  const { fonts: f } = useTheme();
  const reducedMotion = useReducedMotion();
  const motion = useAnimatedStyle(() => {
    if (reducedMotion) return { opacity: 1, transform: [] };
    const m = stageWheelMotion(
      (index * ITEM_WIDTH - scrollX.value) / ITEM_WIDTH
    );
    return {
      opacity: m.opacity,
      transform: [
        { perspective: 700 },
        { rotateY: `${m.rotateYDegrees}deg` },
        { scale: m.scale },
      ],
    };
  });

  return (
    <Animated.View style={[styles.slot, motion]}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${stage.name}, ${stage.count} deal${stage.count === 1 ? '' : 's'}`}
        accessibilityState={{ selected: active }}
        style={[
          styles.face,
          {
            backgroundColor: surface,
            borderColor: active ? activeColor : border,
          },
        ]}
      >
        <View style={[styles.stripe, { backgroundColor: stage.color }]} />
        <Text
          numberOfLines={1}
          style={[styles.name, { color: textColor, fontFamily: f.bold }]}
        >
          {stage.name}
        </Text>
        <Text style={[styles.count, { color: mutedColor }]}>
          {stage.count} deal{stage.count === 1 ? '' : 's'}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

function WheelArrow({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[
        styles.arrow,
        { backgroundColor: colors.glass, borderColor: colors.glassBorder },
      ]}
    >
      <Ionicons name={icon} size={18} color={colors.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  track: { flex: 1, height: 74 },
  slot: { width: ITEM_WIDTH, paddingHorizontal: 5, height: 74 },
  face: {
    flex: 1,
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    justifyContent: 'center',
    overflow: 'hidden',
    gap: 2,
  },
  stripe: { position: 'absolute', top: 0, left: 0, right: 0, height: 3 },
  name: { fontSize: 14 },
  count: { fontSize: 12 },
  arrow: {
    width: 34,
    height: 34,
    borderRadius: radius.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
