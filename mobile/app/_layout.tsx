import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
} from '@expo-google-fonts/inter';
import {
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/plus-jakarta-sans';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AppDialogHost } from '@/components/app-dialog';
import { AuroraBackground } from '@/components/aurora-background';
import { AppErrorBoundary } from '@/components/error-boundary';
import { ConvoRealLoader } from '@/components/loader';
import { OfflineBar } from '@/components/offline-bar';
import { useAuthListener, useAuthStore } from '@/lib/auth-store';
import { usePushRegistration } from '@/lib/push';
import {
  asyncStoragePersister,
  queryCacheBuster,
  queryClient,
} from '@/lib/query';
import { useTheme } from '@/lib/theme';
import { Sentry } from '@/lib/monitoring';
import { useOnlineTracking } from '@/lib/online';

// Expo Router renders this instead of blanking the whole navigator when
// a screen throws while rendering (see components/error-boundary).
export function ErrorBoundary(
  props: React.ComponentProps<typeof AppErrorBoundary>
) {
  return <AppErrorBoundary {...props} />;
}

function RootLayout() {
  useAuthListener();
  useOnlineTracking();
  const { colors, dark } = useTheme();
  const session = useAuthStore((s) => s.session);
  usePushRegistration(!!session);
  const [fontsLoaded] = useFonts({
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
  });

  // Session still being restored from secure storage — hold rendering so
  // the (app) guard doesn't flash the login screen for signed-in users.
  // Fonts load from the bundle (no network) — a frame or two at most.
  // The wordmark waits for them: Fabric caches a text measurement by the
  // string and its style, font family name included, so a wordmark
  // measured with the fallback typeface keeps that narrower width once
  // the ExtraBold font arrives and reads "ConvoRea".
  if (session === undefined || !fontsLoaded) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.background,
        }}
      >
        {fontsLoaded ? <ConvoRealLoader size={26} shimmer={false} /> : null}
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister: asyncStoragePersister,
          buster: queryCacheBuster,
        }}
      >
        <View style={{ flex: 1 }}>
          <AuroraBackground />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: 'transparent' },
              // Swipe-back everywhere: iOS gets full-screen swipe, Android
              // rides the system predictive back gesture (app.json flag);
              // content slides with the gesture instead of the default fade.
              animation: 'slide_from_right',
              gestureEnabled: true,
              fullScreenGestureEnabled: true,
            }}
          >
            <Stack.Screen name="(auth)" />
            <Stack.Screen name="(app)" />
          </Stack>
          <OfflineBar />
        </View>
        <StatusBar style={dark ? 'light' : 'dark'} />
        <AppDialogHost />
      </PersistQueryClientProvider>
    </GestureHandlerRootView>
  );
}

export default Sentry.wrap(RootLayout);
