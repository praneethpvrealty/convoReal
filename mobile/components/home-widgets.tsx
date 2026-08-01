import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PressScale } from '@/components/motion';
import { BottomSheet } from '@/components/sheet';
import { SectionLabel } from '@/components/ui';
import { haptic } from '@/lib/haptics';
import { useHomeWidgets } from '@/lib/home-widget-store';
import { availableWidgets, WIDGET_DEFS, type WidgetId } from '@/lib/home-widgets';
import { fonts, radius, spacing, useTheme } from '@/lib/theme';
import { fetchWidgetSummary } from '@/lib/widget-summaries';

const WIDGET_ICONS: Record<WidgetId, keyof typeof Ionicons.glyphMap> = {
  inbox: 'chatbubbles-outline',
  calendar: 'calendar-outline',
  contacts: 'people-outline',
  properties: 'home-outline',
  deals: 'trending-up-outline',
  broadcasts: 'megaphone-outline',
};

/** Tapping a widget opens the screen it summarizes. */
const WIDGET_ROUTES: Record<WidgetId, string> = {
  inbox: '/(app)/(tabs)',
  calendar: '/(app)/(tabs)/calendar',
  contacts: '/(app)/(tabs)/contacts',
  properties: '/(app)/(tabs)/properties',
  deals: '/(app)/deals',
  broadcasts: '/(app)/broadcasts',
};

/** Invalidation prefix for every widget query — the Overview screen's
 *  pull-to-refresh invalidates ['home-widget'] to refresh them all. */
export const HOME_WIDGET_QUERY_KEY = 'home-widget';

export function HomeWidgets() {
  const { colors, fonts: f } = useTheme();
  const ids = useHomeWidgets((s) => s.ids);
  const [customizing, setCustomizing] = useState(false);

  return (
    <View style={{ gap: spacing.md }}>
      <View style={styles.headerRow}>
        <SectionLabel text="My widgets" />
        <Pressable
          onPress={() => {
            haptic.tap();
            setCustomizing(true);
          }}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Customize widgets"
          style={({ pressed }) => [styles.customize, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Ionicons name="options-outline" size={15} color={colors.primary} />
          <Text style={{ fontSize: 13, fontFamily: f.bold, color: colors.primary }}>
            Customize
          </Text>
        </Pressable>
      </View>

      {ids.length === 0 ? (
        <Pressable
          onPress={() => setCustomizing(true)}
          accessibilityRole="button"
          accessibilityLabel="Add widgets"
          style={[styles.emptyCard, { backgroundColor: colors.glass, borderColor: colors.glassBorder }]}
        >
          <Ionicons name="grid-outline" size={20} color={colors.textFaint} />
          <Text style={{ fontSize: 13, lineHeight: 18, color: colors.textMuted, textAlign: 'center' }}>
            No widgets yet. Add Inbox, Calendar or any screen you use most for a live summary
            right here.
          </Text>
        </Pressable>
      ) : (
        <View style={styles.grid}>
          {ids.map((id) => (
            <WidgetCard key={id} id={id} />
          ))}
        </View>
      )}

      <CustomizeSheet visible={customizing} onClose={() => setCustomizing(false)} />
    </View>
  );
}

function WidgetCard({ id }: { id: WidgetId }) {
  const { data } = useQuery({
    queryKey: [HOME_WIDGET_QUERY_KEY, id],
    staleTime: 30_000,
    queryFn: () => fetchWidgetSummary(id),
  });
  return <WidgetShell id={id} value={data?.value} sub={data?.sub} />;
}

function WidgetShell({
  id,
  value,
  sub,
}: {
  id: WidgetId;
  value: string | undefined;
  sub: string | undefined;
}) {
  const { colors, fonts: f } = useTheme();
  const def = WIDGET_DEFS[id];
  return (
    <PressScale
      onPress={() => router.push(WIDGET_ROUTES[id])}
      accessibilityRole="button"
      accessibilityLabel={`Open ${def.label}`}
      style={styles.cell}
      contentStyle={StyleSheet.flatten([
        styles.card,
        { backgroundColor: colors.glass, borderColor: colors.glassBorder },
      ])}
    >
      <View style={styles.cardHead}>
        <Ionicons name={WIDGET_ICONS[id]} size={17} color={colors.primary} />
        <Text style={[styles.cardLabel, { color: colors.textMuted, fontFamily: f.bold }]}>
          {def.label}
        </Text>
        <Ionicons name="chevron-forward" size={14} color={colors.textFaint} />
      </View>
      <Text
        style={{ fontSize: 21, fontFamily: f.extrabold, color: colors.text }}
        numberOfLines={1}
      >
        {value ?? '…'}
      </Text>
      <Text style={{ fontSize: 12, color: colors.textMuted }} numberOfLines={1}>
        {sub ?? ' '}
      </Text>
    </PressScale>
  );
}

function CustomizeSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors, fonts: f } = useTheme();
  const ids = useHomeWidgets((s) => s.ids);
  const add = useHomeWidgets((s) => s.add);
  const remove = useHomeWidgets((s) => s.remove);
  const move = useHomeWidgets((s) => s.move);
  const available = availableWidgets(ids);

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Customize widgets">
      <ScrollView contentContainerStyle={styles.sheetBody}>
        <Text style={{ fontSize: 13, lineHeight: 18, color: colors.textMuted }}>
          Pick the screens you want a live summary of on your Overview. Reorder with the
          arrows — the top widget shows first.
        </Text>

        {ids.length > 0 ? (
          <>
            <SectionLabel text="On your overview" />
            <View style={[styles.sheetCard, { backgroundColor: colors.surfaceSunken }]}>
              {ids.map((id, index) => (
                <View
                  key={id}
                  style={[styles.sheetRow, index > 0 && { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth }]}
                >
                  <Ionicons name={WIDGET_ICONS[id]} size={19} color={colors.primary} />
                  <Text style={[styles.sheetLabel, { color: colors.text, fontFamily: f.bold }]}>
                    {WIDGET_DEFS[id].label}
                  </Text>
                  <RowButton
                    icon="chevron-up"
                    label={`Move ${WIDGET_DEFS[id].label} up`}
                    disabled={index === 0}
                    onPress={() => move(id, 'up')}
                  />
                  <RowButton
                    icon="chevron-down"
                    label={`Move ${WIDGET_DEFS[id].label} down`}
                    disabled={index === ids.length - 1}
                    onPress={() => move(id, 'down')}
                  />
                  <RowButton
                    icon="remove-circle-outline"
                    label={`Remove ${WIDGET_DEFS[id].label} widget`}
                    tint={colors.danger}
                    onPress={() => remove(id)}
                  />
                </View>
              ))}
            </View>
          </>
        ) : null}

        {available.length > 0 ? (
          <>
            <SectionLabel text="Available widgets" />
            <View style={[styles.sheetCard, { backgroundColor: colors.surfaceSunken }]}>
              {available.map((id, index) => (
                <View
                  key={id}
                  style={[styles.sheetRow, index > 0 && { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth }]}
                >
                  <Ionicons name={WIDGET_ICONS[id]} size={19} color={colors.textMuted} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[styles.sheetLabel, { color: colors.text, fontFamily: f.bold }]}>
                      {WIDGET_DEFS[id].label}
                    </Text>
                    <Text style={{ fontSize: 12, color: colors.textMuted }}>
                      {WIDGET_DEFS[id].description}
                    </Text>
                  </View>
                  <RowButton
                    icon="add-circle-outline"
                    label={`Add ${WIDGET_DEFS[id].label} widget`}
                    tint={colors.primary}
                    onPress={() => add(id)}
                  />
                </View>
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>
    </BottomSheet>
  );
}

function RowButton({
  icon,
  label,
  onPress,
  disabled,
  tint,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tint?: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={() => {
        haptic.tap();
        onPress();
      }}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      style={({ pressed }) => [styles.rowButton, { opacity: disabled ? 0.25 : pressed ? 0.5 : 1 }]}
    >
      <Ionicons name={icon} size={21} color={tint ?? colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  customize: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  cell: { flexGrow: 1, flexBasis: '47%' },
  card: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: 4,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardLabel: { flex: 1, fontSize: 12.5, fontFamily: fonts.bold },
  emptyCard: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
  },
  sheetBody: { paddingHorizontal: spacing.lg, gap: spacing.md, paddingBottom: spacing.md },
  sheetCard: { borderRadius: radius.lg, overflow: 'hidden' },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  sheetLabel: { flex: 1, fontSize: 15, fontFamily: fonts.bold },
  rowButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
});
