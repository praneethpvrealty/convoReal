import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/plus-jakarta-sans';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AuroraBackground } from '@/components/aurora-background';
import { AppErrorBoundary } from '@/components/error-boundary';
import { ConvoRealLoader } from '@/components/loader';
import { useAuthListener, useAuthStore } from '@/lib/auth-store';
import { usePushRegistration } from '@/lib/push';
import { asyncStoragePersister, queryClient } from '@/lib/query';
import { useTheme } from '@/lib/theme';

// Expo Router renders this instead of blanking the whole navigator when
// a screen throws while rendering (see components/error-boundary).
export function ErrorBoundary(props: React.ComponentProps<typeof AppErrorBoundary>) {
  return <AppErrorBoundary {...props} />;
}

export default function RootLayout() {
  useAuthListener();
  const { colors, dark } = useTheme();
  const session = useAuthStore((s) => s.session);
  usePushRegistration(!!session);
  const [fontsLoaded] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  // Session still being restored from secure storage — hold rendering so
  // the (app) guard doesn't flash the login screen for signed-in users.
  // Fonts load from the bundle (no network) — a frame or two at most.
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
        <ConvoRealLoader size={26} />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{ persister: asyncStoragePersister }}
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
        </View>
        <StatusBar style={dark ? 'light' : 'dark'} />
      </PersistQueryClientProvider>
    </GestureHandlerRootView>
  );
}
