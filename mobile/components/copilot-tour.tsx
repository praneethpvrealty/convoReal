import { router, usePathname, type Href } from 'expo-router';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ViewStyle,
} from 'react-native';

import {
  getMobileTour,
  screenPathname,
  type MobileTour,
} from '@/lib/copilot-tours';
import { haptic } from '@/lib/haptics';
import { radius, spacing, useTheme } from '@/lib/theme';

// ------------------------------------------------------------------
// Native port of the web copilot's guided-tour engine
// (src/components/copilot/copilot-context.tsx + tour-overlay.tsx).
// Screens wrap their spotlit elements in <TourTarget id="…">; the
// engine navigates to each step's screen itself (no nav steps on
// mobile), measures the target in window coordinates, and draws a
// four-rect scrim with a tooltip. Touches inside the hole reach the
// real element — a press-target step advances off that touch.
// ------------------------------------------------------------------

type EndReason = 'completed' | 'aborted' | 'lost';

interface TargetRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TourContextValue {
  activeTour: MobileTour | null;
  startTour: (tourId: string) => void;
  registerTarget: (id: string, ref: RefObject<View | null>) => void;
  unregisterTarget: (id: string, ref: RefObject<View | null>) => void;
  /** The active step's target id when it advances on press. */
  pressTargetId: string | null;
  advance: () => void;
  endTour: (reason: EndReason) => void;
}

const TourContext = createContext<TourContextValue | null>(null);

/** How long a step may wait for its target to register + measure
 *  (covers navigation, data loads and list mounting). */
const TARGET_TIMEOUT_MS = 8_000;
const MEASURE_POLL_MS = 200;
const HOLE_PADDING = 6;

export function CopilotTourProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [activeTour, setActiveTour] = useState<MobileTour | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<TargetRect | null>(null);

  const targets = useRef(new Map<string, Set<RefObject<View | null>>>());
  const navigatedFor = useRef<string | null>(null);

  const registerTarget = useCallback(
    (id: string, ref: RefObject<View | null>) => {
      const set = targets.current.get(id) ?? new Set();
      set.add(ref);
      targets.current.set(id, set);
    },
    []
  );
  const unregisterTarget = useCallback(
    (id: string, ref: RefObject<View | null>) => {
      targets.current.get(id)?.delete(ref);
    },
    []
  );

  const endTour = useCallback((reason: EndReason) => {
    setActiveTour(null);
    setStepIndex(0);
    setRect(null);
    navigatedFor.current = null;
    if (reason === 'completed') haptic.success();
  }, []);

  const advance = useCallback(() => {
    setActiveTour((tour) => {
      if (!tour) return tour;
      setStepIndex((i) => {
        if (i + 1 >= tour.steps.length) {
          queueMicrotask(() => endTour('completed'));
          return i;
        }
        return i + 1;
      });
      return tour;
    });
    setRect(null);
  }, [endTour]);

  const startTour = useCallback((tourId: string) => {
    const tour = getMobileTour(tourId);
    if (!tour) return;
    navigatedFor.current = null;
    setActiveTour(tour);
    setStepIndex(0);
    setRect(null);
  }, []);

  const step = activeTour?.steps[stepIndex] ?? null;

  // Per-step lifecycle: navigate to the step's screen once, then poll
  // for a measurable target. The poll keeps running while the step is
  // showing so the spotlight follows scrolled content.
  useEffect(() => {
    if (!activeTour || !step) return;
    const stepKey = `${activeTour.id}:${stepIndex}`;

    if (pathname !== screenPathname(step.screen)) {
      if (navigatedFor.current !== stepKey) {
        navigatedFor.current = stepKey;
        router.push(step.screen as Href);
      }
    }

    let found = false;
    const measure = () => {
      const refs = targets.current.get(step.target);
      if (!refs) return;
      for (const ref of refs) {
        const node = ref.current;
        if (!node) continue;
        node.measureInWindow((x, y, width, height) => {
          if (!(width > 0 && height > 0)) return;
          found = true;
          setRect((prev) =>
            prev &&
            Math.abs(prev.x - x) < 1 &&
            Math.abs(prev.y - y) < 1 &&
            Math.abs(prev.width - width) < 1 &&
            Math.abs(prev.height - height) < 1
              ? prev
              : { x, y, width, height }
          );
        });
        break;
      }
    };

    measure();
    const interval = setInterval(measure, MEASURE_POLL_MS);
    const timeout = setTimeout(() => {
      if (!found) endTour('lost');
    }, TARGET_TIMEOUT_MS);
    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [activeTour, step, stepIndex, pathname, endTour]);

  const pressTargetId =
    step && step.advanceOn === 'press-target' && rect ? step.target : null;

  const value = useMemo(
    () => ({
      activeTour,
      startTour,
      registerTarget,
      unregisterTarget,
      pressTargetId,
      advance,
      endTour,
    }),
    [
      activeTour,
      startTour,
      registerTarget,
      unregisterTarget,
      pressTargetId,
      advance,
      endTour,
    ]
  );

  return (
    <TourContext.Provider value={value}>
      {children}
      {activeTour && step && rect ? (
        <TourSpotlight
          rect={rect}
          title={step.title}
          body={step.body}
          stepNumber={stepIndex + 1}
          stepCount={activeTour.steps.length}
          showNext={step.advanceOn === 'next'}
          isLast={stepIndex + 1 >= activeTour.steps.length}
          onNext={advance}
          onSkip={() => endTour('aborted')}
        />
      ) : null}
    </TourContext.Provider>
  );
}

export function useCopilotTour(): TourContextValue {
  const ctx = useContext(TourContext);
  if (!ctx) {
    throw new Error('useCopilotTour must be used within CopilotTourProvider');
  }
  return ctx;
}

/**
 * Marks a spotlightable element. Wraps children in a measurable View
 * (collapsable={false} keeps it in the native tree on Android); when
 * the active step advances on press, the wrapper listens for the
 * touch that activates its child.
 */
export function TourTarget({
  id,
  children,
  style,
}: {
  id: string;
  children: ReactNode;
  style?: ViewStyle;
}) {
  const { registerTarget, unregisterTarget, pressTargetId, advance } =
    useCopilotTour();
  const ref = useRef<View>(null);

  useEffect(() => {
    registerTarget(id, ref);
    return () => unregisterTarget(id, ref);
  }, [id, registerTarget, unregisterTarget]);

  return (
    <View
      ref={ref}
      collapsable={false}
      style={style}
      onTouchEnd={pressTargetId === id ? () => advance() : undefined}
    >
      {children}
    </View>
  );
}

/** Splits the tours' **bold** markers the same way the web overlay
 *  renders them. */
export function TourBodyText({
  text,
  color,
  boldColor,
  fontSize = 13.5,
}: {
  text: string;
  color: string;
  boldColor: string;
  fontSize?: number;
}) {
  const { fonts: f } = useTheme();
  const parts = text.split('**');
  return (
    <Text
      style={{
        fontSize,
        lineHeight: fontSize * 1.45,
        fontFamily: f.regular,
        color,
      }}
    >
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <Text key={i} style={{ fontFamily: f.bold, color: boldColor }}>
            {part}
          </Text>
        ) : (
          part
        )
      )}
    </Text>
  );
}

function TourSpotlight({
  rect,
  title,
  body,
  stepNumber,
  stepCount,
  showNext,
  isLast,
  onNext,
  onSkip,
}: {
  rect: TargetRect;
  title: string;
  body: string;
  stepNumber: number;
  stepCount: number;
  showNext: boolean;
  isLast: boolean;
  onNext: () => void;
  onSkip: () => void;
}) {
  const { colors, fonts: f, shadows } = useTheme();
  const { width: winW, height: winH } = useWindowDimensions();

  const hole = {
    x: Math.max(0, rect.x - HOLE_PADDING),
    y: Math.max(0, rect.y - HOLE_PADDING),
    width: rect.width + HOLE_PADDING * 2,
    height: rect.height + HOLE_PADDING * 2,
  };
  const scrim = 'rgba(8,5,20,0.72)';
  const below = hole.y + hole.height < winH * 0.55;
  const cardWidth = Math.min(winW - spacing.lg * 2, 340);
  const cardLeft = Math.min(
    Math.max(spacing.lg, hole.x + hole.width / 2 - cardWidth / 2),
    winW - cardWidth - spacing.lg
  );

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Four scrim rectangles around the hole — touches inside the
          hole fall through to the real element. */}
      <Pressable
        style={[styles.scrim, { top: 0, left: 0, right: 0, height: hole.y, backgroundColor: scrim }]}
        onPress={onSkip}
        accessibilityLabel="End tour"
      />
      <Pressable
        style={[
          styles.scrim,
          { top: hole.y + hole.height, left: 0, right: 0, bottom: 0, backgroundColor: scrim },
        ]}
        onPress={onSkip}
        accessibilityLabel="End tour"
      />
      <Pressable
        style={[
          styles.scrim,
          { top: hole.y, left: 0, width: hole.x, height: hole.height, backgroundColor: scrim },
        ]}
        onPress={onSkip}
        accessibilityLabel="End tour"
      />
      <Pressable
        style={[
          styles.scrim,
          {
            top: hole.y,
            left: hole.x + hole.width,
            right: 0,
            height: hole.height,
            backgroundColor: scrim,
          },
        ]}
        onPress={onSkip}
        accessibilityLabel="End tour"
      />

      <View
        pointerEvents="none"
        style={[
          styles.ring,
          {
            left: hole.x,
            top: hole.y,
            width: hole.width,
            height: hole.height,
            borderColor: colors.primary,
          },
        ]}
      />

      <View
        style={[
          styles.card,
          shadows.card,
          {
            width: cardWidth,
            left: cardLeft,
            backgroundColor: colors.surfaceWell,
            borderColor: colors.glassBorder,
            ...(below
              ? { top: hole.y + hole.height + spacing.md }
              : { bottom: winH - hole.y + spacing.md }),
          },
        ]}
        accessibilityViewIsModal
      >
        <View style={styles.cardHead}>
          <Text style={[styles.cardTitle, { fontFamily: f.bold, color: colors.text }]}>
            {title}
          </Text>
          {stepCount > 1 ? (
            <Text style={[styles.stepCount, { fontFamily: f.semibold, color: colors.textFaint }]}>
              {stepNumber}/{stepCount}
            </Text>
          ) : null}
        </View>
        <TourBodyText
          text={body}
          color={colors.textMuted}
          boldColor={colors.text}
        />
        <View style={styles.cardActions}>
          <Pressable
            onPress={onSkip}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Skip tour"
          >
            <Text style={[styles.skip, { fontFamily: f.semibold, color: colors.textFaint }]}>
              Skip
            </Text>
          </Pressable>
          {showNext ? (
            <Pressable
              onPress={onNext}
              accessibilityRole="button"
              style={[styles.nextBtn, { backgroundColor: colors.primary }]}
            >
              <Text style={[styles.nextLabel, { fontFamily: f.bold, color: colors.onPrimary }]}>
                {isLast ? 'Done' : 'Next'}
              </Text>
            </Pressable>
          ) : (
            <Text style={[styles.skip, { fontFamily: f.semibold, color: colors.textMuted }]}>
              {'Tap the highlight \u{1F446}'}
            </Text>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { position: 'absolute' },
  ring: {
    position: 'absolute',
    borderWidth: 2.5,
    borderRadius: radius.md,
  },
  card: {
    position: 'absolute',
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  cardTitle: { fontSize: 16, flex: 1 },
  stepCount: { fontSize: 11 },
  cardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  skip: { fontSize: 12.5 },
  nextBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
  },
  nextLabel: { fontSize: 13.5 },
});
