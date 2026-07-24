import type { ErrorBoundaryProps } from 'expo-router';
import { router } from 'expo-router';
import { Pressable, ScrollView, Text, useColorScheme, View } from 'react-native';

/**
 * App-wide fallback for a screen that throws while rendering. Expo Router
 * mounts this (exported as `ErrorBoundary` from the root layout) instead
 * of unmounting the tree to a blank screen. Self-contained styling — it
 * must not depend on app context that may itself be the thing that broke.
 */
export function AppErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const dark = useColorScheme() === 'dark';
  const c = dark
    ? { bg: '#0A1512', card: '#12211C', border: '#22332C', fg: '#E7ECEA', muted: '#9DB0A8' }
    : { bg: '#EEF5F1', card: '#FFFFFF', border: '#DCE7E1', fg: '#0A1F16', muted: '#5B6B63' };
  const primary = '#0F7A54';

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: c.bg,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <View
        style={{
          width: '100%',
          maxWidth: 440,
          backgroundColor: c.card,
          borderColor: c.border,
          borderWidth: 1,
          borderRadius: 20,
          padding: 24,
          gap: 12,
        }}
      >
        <Text style={{ fontSize: 34 }}>😕</Text>
        <Text style={{ fontSize: 19, fontWeight: '800', color: c.fg }}>This screen hit a snag</Text>
        <Text style={{ fontSize: 13.5, lineHeight: 20, color: c.muted }}>
          Something went wrong loading this page. Try again, or head back to your inbox.
        </Text>

        <ScrollView
          style={{ maxHeight: 130, borderRadius: 10, backgroundColor: dark ? '#0A1512' : '#F2F7F4' }}
          contentContainerStyle={{ padding: 10 }}
        >
          <Text style={{ fontSize: 11.5, lineHeight: 17, color: c.muted }}>
            {String(error?.message || error)}
          </Text>
        </ScrollView>

        <Pressable
          onPress={retry}
          accessibilityRole="button"
          style={{ backgroundColor: primary, borderRadius: 999, paddingVertical: 13, alignItems: 'center', marginTop: 4 }}
        >
          <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 15 }}>Try again</Text>
        </Pressable>
        <Pressable
          onPress={() => router.replace('/(app)/(tabs)')}
          accessibilityRole="button"
          style={{ paddingVertical: 10, alignItems: 'center' }}
        >
          <Text style={{ color: primary, fontWeight: '700', fontSize: 14 }}>Go to inbox</Text>
        </Pressable>
      </View>
    </View>
  );
}
