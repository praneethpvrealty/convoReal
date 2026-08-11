import { Ionicons } from '@expo/vector-icons';
import { usePathname } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CopilotSheet } from '@/components/copilot-sheet';
import { useCopilotTour } from '@/components/copilot-tour';
import { haptic } from '@/lib/haptics';
import { useTheme } from '@/lib/theme';

// ------------------------------------------------------------------
// The floating helper button + its chat sheet. Mounted once in the
// Engine layout inside CopilotTourProvider. The button keeps out of
// screens where it would sit on a composer or a full-screen flow —
// detail and editor screens reach the helper from a list screen.
// ------------------------------------------------------------------

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
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const { activeTour, startTour } = useCopilotTour();
  const [open, setOpen] = useState(false);

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
        <Pressable
          onPress={() => {
            haptic.tap();
            setOpen(true);
          }}
          accessibilityRole="button"
          accessibilityLabel="Open the helper"
          style={[
            styles.fab,
            shadows.card,
            {
              backgroundColor: colors.primary,
              bottom: Math.max(insets.bottom, 12) + 74 + 16,
            },
          ]}
        >
          <Ionicons name="sparkles" size={22} color={colors.onPrimary} />
        </Pressable>
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
    right: 18,
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8,
  },
});
