import { FlexWidget, TextWidget, type WidgetRepresentation } from 'react-native-android-widget';

import { WIDGET_DEEP_LINKS, WIDGET_DEFS, type WidgetId } from '@/lib/home-widgets';
import { brand } from '@/lib/theme';
import type { WidgetSummary } from '@/lib/widget-summaries';

/**
 * Android home-screen widget UI. Rendered by the headless widget task
 * (no React runtime on the launcher), so it only uses the
 * react-native-android-widget primitives — never RN components, hooks
 * or useTheme(). Colours come from the static `brand` constants rather
 * than literals so the widget cannot drift from the app; widgets sit on
 * the wallpaper, so fills are solid, not glass.
 */

export interface OsWidgetPalette {
  background: `#${string}`;
  text: `#${string}`;
  muted: `#${string}`;
  accent: `#${string}`;
}

const LIGHT: OsWidgetPalette = {
  background: brand.white,
  text: brand.text,
  muted: brand.textDim,
  accent: brand.violet,
};

const DARK: OsWidgetPalette = {
  background: brand.inkWell,
  text: brand.textOnInk,
  muted: brand.textDimOnInk,
  accent: brand.violetSoft,
};

export function osWidgetPalette(dark: boolean): OsWidgetPalette {
  return dark ? DARK : LIGHT;
}

export function OsWidgetView({
  id,
  summary,
  updatedAt,
  palette,
}: {
  id: WidgetId;
  /** null = signed out or fetch failed — show the sign-in nudge. */
  summary: WidgetSummary | null;
  updatedAt: string;
  palette: OsWidgetPalette;
}) {
  const def = WIDGET_DEFS[id];
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri: `convoreal://${WIDGET_DEEP_LINKS[id]}` }}
      style={{
        width: 'match_parent',
        height: 'match_parent',
        backgroundColor: palette.background,
        borderRadius: 24,
        padding: 16,
        flexDirection: 'column',
        justifyContent: 'space-between',
      }}
    >
      <FlexWidget
        style={{
          width: 'match_parent',
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <TextWidget
          text={def.label.toUpperCase()}
          style={{ fontSize: 11, fontWeight: '700', letterSpacing: 0.1, color: palette.accent }}
        />
        <TextWidget text="ConvoReal" style={{ fontSize: 10, color: palette.muted }} />
      </FlexWidget>
      <FlexWidget style={{ width: 'match_parent', flexDirection: 'column' }}>
        <TextWidget
          text={summary ? summary.value : '—'}
          maxLines={1}
          truncate="END"
          style={{ fontSize: 28, fontWeight: '800', color: palette.text }}
        />
        <TextWidget
          text={summary ? summary.sub : 'Open ConvoReal and sign in'}
          maxLines={1}
          truncate="END"
          style={{ fontSize: 12, color: palette.muted, marginTop: 2 }}
        />
      </FlexWidget>
      <TextWidget text={`Updated ${updatedAt}`} style={{ fontSize: 10, color: palette.muted }} />
    </FlexWidget>
  );
}

/** Light + dark variants — the launcher picks per system theme. */
export function renderOsWidget(
  id: WidgetId,
  summary: WidgetSummary | null,
  updatedAt: string
): WidgetRepresentation {
  return {
    light: <OsWidgetView id={id} summary={summary} updatedAt={updatedAt} palette={LIGHT} />,
    dark: <OsWidgetView id={id} summary={summary} updatedAt={updatedAt} palette={DARK} />,
  };
}
