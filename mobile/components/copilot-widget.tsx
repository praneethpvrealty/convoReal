import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { usePathname } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  useWindowDimensions,
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
import { haptic } from '@/lib/haptics';
import { useT } from '@/lib/use-t';
import { useTheme } from '@/lib/theme';

// ------------------------------------------------------------------
// The floating helper button + its chat sheet. Mounted once in the
// Engine layout inside CopilotTourProvider. The button keeps out of
// screens where it would sit on a composer or a full-screen flow —
// detail and editor screens reach the helper from a list screen.
// Drag it anywhere; it snaps to the nearer edge and remembers where.
// ------------------------------------------------------------------

const PLACEMENT_KEY = 'copilot-fab-placement';

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
  const { colors, shadows } = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const { activeTour, startTour } = useCopilotTour();
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

  return (
    <>
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
});
