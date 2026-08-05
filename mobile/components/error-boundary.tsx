import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import type { ErrorBoundaryProps } from 'expo-router';
import { router, usePathname } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, useColorScheme, View } from 'react-native';

import { brand } from '@/lib/theme';

/**
 * App-wide fallback for a screen that throws while rendering. Expo Router
 * mounts this (exported as `ErrorBoundary` from the root layout) instead
 * of unmounting the tree to a blank screen. Self-contained styling — it
 * must not depend on app context that may itself be the thing that broke.
 *
 * It reports the route, the stack and the build alongside the message,
 * because the message alone does not identify the bug: "undefined is not
 * a function" is the same string whichever screen and whichever call
 * produced it. Everything is copyable in one tap so a user can hand over
 * a report that is actually actionable, and the same payload goes to the
 * console for anyone watching device logs.
 */
export function AppErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const dark = useColorScheme() === 'dark';
  const pathname = usePathname();
  const [copied, setCopied] = useState(false);
  const [showStack, setShowStack] = useState(false);
  // Static brand constants, not useTheme() — the provider may be the
  // thing that just threw.
  const c = dark
    ? { bg: brand.ink, card: brand.inkWell, border: brand.borderOnInk, fg: brand.textOnInk, muted: brand.textDimOnInk }
    : { bg: brand.paper, card: brand.white, border: brand.border, fg: brand.text, muted: brand.textDim };
  const primary = dark ? brand.violetSoft : brand.violet;
  const wellBg = dark ? brand.ink : brand.paperWell;

  // runtimeVersion is the resolved fingerprint in a build, but stays the
  // unresolved `{ policy }` object in Expo Go — print it only when it is
  // the string that identifies which binary this is.
  const runtime = Constants.expoConfig?.runtimeVersion;
  const build = [
    Constants.expoConfig?.version ?? 'unknown',
    typeof runtime === 'string' ? runtime : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const headline = [error?.name, error?.message || String(error)].filter(Boolean).join(': ');
  const details = [
    `Screen: ${pathname || 'unknown'}`,
    `Error: ${headline}`,
    `App: ${build}`,
    `Platform: ${Platform.OS} ${String(Platform.Version)}`,
    '',
    error?.stack || 'No stack captured.',
  ].join('\n');

  useEffect(() => {
    console.error('[error-boundary] screen crashed\n' + details);
  }, [details]);

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

        <View style={{ borderRadius: 10, backgroundColor: wellBg, padding: 10, gap: 6 }}>
          <Text style={{ fontSize: 11.5, lineHeight: 17, color: c.muted }}>
            {pathname || 'unknown screen'}
          </Text>
          <Text style={{ fontSize: 12.5, lineHeight: 18, color: c.fg }}>{headline}</Text>
        </View>

        {showStack ? (
          <ScrollView
            style={{ maxHeight: 180, borderRadius: 10, backgroundColor: wellBg }}
            contentContainerStyle={{ padding: 10 }}
          >
            <Text style={{ fontSize: 10.5, lineHeight: 16, color: c.muted }}>{details}</Text>
          </ScrollView>
        ) : null}

        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pressable
            onPress={() => setShowStack((s) => !s)}
            accessibilityRole="button"
            style={{
              flex: 1,
              borderRadius: 999,
              paddingVertical: 11,
              alignItems: 'center',
              borderColor: c.border,
              borderWidth: 1,
            }}
          >
            <Text style={{ color: c.muted, fontWeight: '700', fontSize: 13 }}>
              {showStack ? 'Hide details' : 'Show details'}
            </Text>
          </Pressable>
          <Pressable
            onPress={async () => {
              try {
                await Clipboard.setStringAsync(details);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
            accessibilityRole="button"
            style={{
              flex: 1,
              borderRadius: 999,
              paddingVertical: 11,
              alignItems: 'center',
              borderColor: c.border,
              borderWidth: 1,
            }}
          >
            <Text style={{ color: c.muted, fontWeight: '700', fontSize: 13 }}>
              {copied ? 'Copied' : 'Copy report'}
            </Text>
          </Pressable>
        </View>

        <Pressable
          onPress={retry}
          accessibilityRole="button"
          style={{ backgroundColor: primary, borderRadius: 999, paddingVertical: 13, alignItems: 'center', marginTop: 4 }}
        >
          <Text style={{ color: dark ? brand.ink : brand.white, fontWeight: '700', fontSize: 15 }}>
            Try again
          </Text>
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
