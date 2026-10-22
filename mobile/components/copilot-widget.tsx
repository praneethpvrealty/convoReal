import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, usePathname, type Href } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CopilotSheet } from '@/components/copilot-sheet';
import { useCopilotTour } from '@/components/copilot-tour';
import {
  COPILOT_FAB_SIZE,
  clampCopilotFabBottom,
  copilotFabLeft,
  defaultCopilotFabPlacement,
  isCopilotFabDrag,
  parseCopilotFabPlacement,
  snapCopilotFab,
  type CopilotFabFrame,
  type CopilotFabPlacement,
} from '@/lib/copilot-fab';
import { appHrefForWebRoute } from '@/lib/copilot';
import { openCopilotDesktopWeb } from '@/lib/copilot-links';
import { nudgeCtaTarget } from '@/lib/copilot-nudges';
import { ENV } from '@/lib/env';
import { haptic } from '@/lib/haptics';
import { useCopilotNudges } from '@/lib/use-copilot-nudges';
import { useT } from '@/lib/use-t';
import { radius, spacing, useTheme } from '@/lib/theme';

// ------------------------------------------------------------------
// The floating helper button + its chat sheet. Mounted once in the
// Engine layout inside CopilotTourProvider. The button keeps out of
// screens where it would sit on a composer or a full-screen flow —
// detail and editor screens reach the helper from a list screen.
// Drag it anywhere; it snaps to the nearer edge and remembers where.
// ------------------------------------------------------------------

const PLACEMENT_KEY = 'copilot-fab-placement';
const NUDGE_AUTO_HIDE_MS = 20_000;
const NUDGE_WIDTH = 280;

const VISIBLE_PATHNAMES = new Set([
  '/',
  '/contacts',
  '/properties',
  '/calendar',
  '/more',
  '/dashboard',
  '/broadcasts',
  '/pulse',
  '/radar',
  '/today',
  '/journey',
  '/deals',
  '/automations',
  '/agents',
]);

export function CopilotWidget() {
  const { colors, shadows, fonts: f } = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const { activeTour, startTour } = useCopilotTour();
  const { nudge, dismiss, accept } = useCopilotNudges();
  const [open, setOpen] = useState(false);
  const { width, height } = useWindowDimensions();
  const [saved, setSaved] = useState<CopilotFabPlacement>(() =>
    defaultCopilotFabPlacement(insets.bottom)
  );
  const [pan] = useState(() => new Animated.ValueXY());
  const frame = useMemo<CopilotFabFrame>(
    () => ({
      screenWidth: width,
      screenHeight: height,
      insetTop: insets.top,
      insetBottom: insets.bottom,
    }),
    [width, height, insets.top, insets.bottom]
  );
  const placement = useMemo(
    () => ({
      side: saved.side,
      bottom: clampCopilotFabBottom(saved.bottom, frame),
    }),
    [saved, frame]
  );

  useEffect(() => {
    AsyncStorage.getItem(PLACEMENT_KEY)
      .then((raw) => {
        const stored = parseCopilotFabPlacement(raw);
        if (stored) setSaved(stored);
      })
      .catch(() => {});
  }, []);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => isCopilotFabDrag(g.dx, g.dy),
        onMoveShouldSetPanResponderCapture: (_, g) =>
          isCopilotFabDrag(g.dx, g.dy),
        onPanResponderGrant: () => haptic.tap(),
        onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], {
          useNativeDriver: false,
        }),
        onPanResponderRelease: (_, g) => {
          const next = snapCopilotFab(placement, g.dx, g.dy, frame);
          pan.setValue({
            x:
              copilotFabLeft(placement.side, frame.screenWidth) +
              g.dx -
              copilotFabLeft(next.side, frame.screenWidth),
            y: g.dy + (next.bottom - placement.bottom),
          });
          setSaved(next);
          AsyncStorage.setItem(PLACEMENT_KEY, JSON.stringify(next)).catch(
            () => {}
          );
          Animated.spring(pan, {
            toValue: { x: 0, y: 0 },
            useNativeDriver: false,
            friction: 7,
          }).start();
        },
        onPanResponderTerminate: () => {
          Animated.spring(pan, {
            toValue: { x: 0, y: 0 },
            useNativeDriver: false,
          }).start();
        },
      }),
    [pan, placement, frame]
  );

  const handleStartTour = (tourId: string) => {
    setOpen(false);
    // Let the sheet's modal dismiss before the overlay takes over —
    // the spotlight renders under an open Modal otherwise.
    setTimeout(() => startTour(tourId), 250);
  };

  const showButton = VISIBLE_PATHNAMES.has(pathname) && !activeTour && !open;

  useEffect(() => {
    if (!nudge || !showButton) return;
    const timer = setTimeout(() => dismiss(), NUDGE_AUTO_HIDE_MS);
    return () => clearTimeout(timer);
  }, [nudge, showButton, dismiss]);

  const onAcceptNudge = () => {
    if (!nudge) return;
    const cta = nudge.cta;
    haptic.tap();
    accept();
    if (!cta) return;
    const target = nudgeCtaTarget(cta, appHrefForWebRoute);
    if (!target) return;
    if (target.kind === 'tour') setTimeout(() => startTour(target.tourId), 250);
    else if (target.kind === 'app') router.push(target.href as Href);
    else
      void openCopilotDesktopWeb(`${ENV.apiBaseUrl}${target.path}`).catch(() =>
        haptic.warn()
      );
  };

  const nudgeLeft =
    placement.side === 'left'
      ? Math.max(spacing.md, copilotFabLeft('left', width))
      : Math.max(spacing.md, width - NUDGE_WIDTH - spacing.md);

  return (
    <>
      {showButton && nudge ? (
        <View
          testID="copilot-nudge"
          style={[
            styles.nudge,
            shadows.card,
            {
              left: Math.min(
                nudgeLeft,
                Math.max(spacing.md, width - NUDGE_WIDTH - spacing.md)
              ),
              bottom: placement.bottom + COPILOT_FAB_SIZE + spacing.sm,
              backgroundColor: colors.surface,
              borderColor: colors.glassBorder,
            },
          ]}
        >
          <Pressable
            onPress={() => {
              haptic.tap();
              dismiss();
            }}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Dismiss tip"
            style={styles.nudgeClose}
          >
            <Ionicons name="close" size={16} color={colors.textFaint} />
          </Pressable>
          <Text
            style={[
              styles.nudgeText,
              { color: colors.text, fontFamily: f.regular },
            ]}
          >
            {nudge.message}
          </Text>
          {nudge.cta ? (
            <Pressable
              onPress={onAcceptNudge}
              accessibilityRole="button"
              style={[styles.nudgeCta, { backgroundColor: colors.primary }]}
            >
              <Text
                style={{
                  color: colors.onPrimary,
                  fontSize: 12.5,
                  fontFamily: f.bold,
                }}
              >
                {nudge.cta.label}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {showButton ? (
        <Animated.View
          {...responder.panHandlers}
          style={[
            styles.fab,
            shadows.card,
            {
              left: copilotFabLeft(placement.side, width),
              bottom: placement.bottom,
              transform: pan.getTranslateTransform(),
            },
          ]}
        >
          <Pressable
            onPress={() => {
              haptic.tap();
              setOpen(true);
            }}
            accessibilityRole="button"
            accessibilityLabel={t('copilot.open')}
            style={[styles.fabButton, { backgroundColor: colors.primary }]}
          >
            <Ionicons name="sparkles" size={22} color={colors.onPrimary} />
          </Pressable>
        </Animated.View>
      ) : null}
      <CopilotSheet
        visible={open}
        onClose={() => setOpen(false)}
        onStartTour={handleStartTour}
      />
    </>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    width: COPILOT_FAB_SIZE,
    height: COPILOT_FAB_SIZE,
    borderRadius: COPILOT_FAB_SIZE / 2,
    elevation: 8,
  },
  fabButton: {
    flex: 1,
    borderRadius: COPILOT_FAB_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nudge: {
    position: 'absolute',
    width: NUDGE_WIDTH,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
    paddingRight: spacing.lg + spacing.sm,
    gap: spacing.sm,
    elevation: 8,
  },
  nudgeClose: { position: 'absolute', top: spacing.sm, right: spacing.sm },
  nudgeText: { fontSize: 13.5, lineHeight: 19 },
  nudgeCta: {
    alignSelf: 'flex-start',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
});
