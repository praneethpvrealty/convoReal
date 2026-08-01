import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { getWidgetInfo, WidgetPreview } from 'react-native-android-widget';

import { HOME_WIDGET_QUERY_KEY } from '@/components/home-widgets';
import { OsWidgetView, osWidgetPalette } from '@/components/os-widget';
import { EmptyState, SectionLabel } from '@/components/ui';
import { haptic } from '@/lib/haptics';
import { OS_WIDGET_NAMES, WIDGET_DEFS, WIDGET_IDS, type WidgetId } from '@/lib/home-widgets';
import { updateAllOsWidgets } from '@/lib/os-widget-updates';
import { bubbleTime } from '@/lib/format';
import { radius, spacing, useTheme } from '@/lib/theme';
import { fetchWidgetSummary } from '@/lib/widget-summaries';

export default function OsWidgetsScreen() {
  const { colors, fonts: f } = useTheme();

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.container}>
      <Stack.Screen options={{ headerShown: true, title: 'Home-screen widgets' }} />

      {Platform.OS !== 'android' ? (
        <EmptyState
          icon="phone-portrait-outline"
          title="Android only, for now"
          subtitle="Home-screen widgets are available on the Android app. iPhone widgets need a native WidgetKit extension and are on the roadmap."
        />
      ) : (
        <>
          <View
            style={[styles.card, { backgroundColor: colors.glass, borderColor: colors.glassBorder }]}
          >
            <View style={styles.introRow}>
              <Ionicons name="grid-outline" size={20} color={colors.primary} />
              <Text style={{ flex: 1, fontSize: 13.5, lineHeight: 19, color: colors.textMuted }}>
                Put any ConvoReal screen on your phone's home screen: long-press an empty spot on
                the home screen, choose{' '}
                <Text style={{ fontFamily: f.bold, color: colors.text }}>Widgets</Text>, find{' '}
                <Text style={{ fontFamily: f.bold, color: colors.text }}>ConvoReal</Text> and drag
                the one you want. Widgets refresh every 30 minutes, whenever you open the app, and
                when you tap Update below. Tapping a widget opens its screen.
              </Text>
            </View>
            <UpdateAllButton />
          </View>

          <SectionLabel text="Available widgets" style={{ marginTop: spacing.sm }} />
          {WIDGET_IDS.map((id) => (
            <OsWidgetCard key={id} id={id} />
          ))}
        </>
      )}
    </ScrollView>
  );
}

function UpdateAllButton() {
  const { colors, fonts: f } = useTheme();
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');

  async function updateAll() {
    if (state === 'busy') return;
    haptic.tap();
    setState('busy');
    await updateAllOsWidgets();
    setState('done');
  }

  return (
    <Pressable
      onPress={updateAll}
      accessibilityRole="button"
      accessibilityLabel="Update all home-screen widgets now"
      style={({ pressed }) => [
        styles.updateAll,
        { backgroundColor: colors.primarySoft, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      {state === 'busy' ? (
        <ActivityIndicator size="small" color={colors.primary} />
      ) : (
        <Ionicons
          name={state === 'done' ? 'checkmark-circle' : 'refresh'}
          size={17}
          color={colors.primary}
        />
      )}
      <Text style={{ fontSize: 14, fontFamily: f.bold, color: colors.primary }}>
        {state === 'done' ? 'Widgets updated' : 'Update all widgets now'}
      </Text>
    </Pressable>
  );
}

function OsWidgetCard({ id }: { id: WidgetId }) {
  const { colors, dark, fonts: f } = useTheme();
  const { width } = useWindowDimensions();
  const def = WIDGET_DEFS[id];

  const { data: summary } = useQuery({
    queryKey: [HOME_WIDGET_QUERY_KEY, id],
    staleTime: 30_000,
    queryFn: () => fetchWidgetSummary(id),
  });

  // How many instances of this widget are on the home screen. Throws in
  // Expo Go (native module not linked) — surface that once per card.
  const { data: instances, isError } = useQuery({
    queryKey: ['os-widget-info', id],
    queryFn: () => getWidgetInfo(OS_WIDGET_NAMES[id]),
    retry: false,
  });

  const previewWidth = Math.min(width - spacing.lg * 2 - spacing.md * 2, 340);

  return (
    <View style={[styles.card, { backgroundColor: colors.glass, borderColor: colors.glassBorder }]}>
      <View style={styles.cardHead}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ fontSize: 15.5, fontFamily: f.bold, color: colors.text }}>
            {def.label}
          </Text>
          <Text style={{ fontSize: 12.5, color: colors.textMuted }}>{def.description}</Text>
        </View>
        <Text style={{ fontSize: 12, fontFamily: f.semibold, color: colors.textFaint }}>
          {isError
            ? 'needs full app build'
            : instances
              ? instances.length > 0
                ? `${instances.length} on home screen`
                : 'not added yet'
              : '…'}
        </Text>
      </View>
      <View style={styles.preview}>
        <WidgetPreview
          width={previewWidth}
          height={120}
          renderWidget={() => (
            <OsWidgetView
              id={id}
              summary={summary ?? null}
              updatedAt={bubbleTime(new Date().toISOString())}
              palette={osWidgetPalette(dark)}
            />
          )}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  card: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.md,
  },
  introRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  updateAll: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    paddingVertical: 12,
  },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  preview: { alignItems: 'center' },
});
