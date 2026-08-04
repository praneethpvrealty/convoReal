import { FlexWidget, TextWidget, type WidgetRepresentation } from 'react-native-android-widget';

import { WIDGET_DEEP_LINKS, WIDGET_DEFS, type WidgetId } from '@/lib/home-widgets';
import type { WidgetSummary, WidgetSummaryLine } from '@/lib/widget-summaries';

/**
 * Android home-screen widget UI. Rendered by the headless widget task
 * (no React runtime on the launcher), so it only uses the
 * react-native-android-widget primitives — never RN components, hooks
 * or useTheme(). Colors are hex from the aurora-glass palette; widgets
 * sit on the wallpaper, so fills are solid, not glass.
 */

export interface OsWidgetPalette {
  background: `#${string}`;
  text: `#${string}`;
  muted: `#${string}`;
  accent: `#${string}`;
}

const LIGHT: OsWidgetPalette = {
  background: '#FFFFFF',
  text: '#111B21',
  muted: '#5D6E66',
  accent: '#075E54',
};

const DARK: OsWidgetPalette = {
  background: '#102119',
  text: '#F2FBF4',
  muted: '#9DB4A9',
  accent: '#C6F68D',
};

export function osWidgetPalette(dark: boolean): OsWidgetPalette {
  return dark ? DARK : LIGHT;
}

/** How many summary lines fit under the header + hero number + footer
 *  (~114dp of chrome, ~22dp per line). Sized from the launcher-reported
 *  widget height so a small widget stays a clean stat card while a
 *  taller one fills with the latest chats. */
export function visibleLineCount(heightDp: number | undefined): number {
  if (!heightDp) return 0;
  return Math.max(0, Math.min(4, Math.floor((heightDp - 114) / 22)));
}

function OsWidgetLine({ line, palette }: { line: WidgetSummaryLine; palette: OsWidgetPalette }) {
  return (
    <FlexWidget
      style={{
        width: 'match_parent',
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 6,
      }}
    >
      <TextWidget
        text={line.title}
        maxLines={1}
        truncate="END"
        style={{ fontSize: 12, fontWeight: '700', color: palette.text }}
      />
      <FlexWidget style={{ flex: 1, marginLeft: 6, marginRight: 6 }}>
        <TextWidget
          text={line.detail}
          maxLines={1}
          truncate="END"
          style={{ fontSize: 12, color: palette.muted }}
        />
      </FlexWidget>
      <TextWidget text={line.time} style={{ fontSize: 10, color: palette.muted }} />
    </FlexWidget>
  );
}

export function OsWidgetView({
  id,
  summary,
  updatedAt,
  palette,
  height,
}: {
  id: WidgetId;
  /** null = signed out or fetch failed — show the sign-in nudge. */
  summary: WidgetSummary | null;
  updatedAt: string;
  palette: OsWidgetPalette;
  /** Launcher-reported widget height in dp — gates the summary lines. */
  height?: number;
}) {
  const def = WIDGET_DEFS[id];
  const lines = summary?.lines?.slice(0, visibleLineCount(height)) ?? [];
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
      {lines.length > 0 ? (
        <FlexWidget style={{ width: 'match_parent', flexDirection: 'column' }}>
          {lines.map((line, index) => (
            <OsWidgetLine key={`${line.title}-${index}`} line={line} palette={palette} />
          ))}
        </FlexWidget>
      ) : null}
      <TextWidget text={`Updated ${updatedAt}`} style={{ fontSize: 10, color: palette.muted }} />
    </FlexWidget>
  );
}

/** Light + dark variants — the launcher picks per system theme. */
export function renderOsWidget(
  id: WidgetId,
  summary: WidgetSummary | null,
  updatedAt: string,
  height?: number
): WidgetRepresentation {
  return {
    light: (
      <OsWidgetView id={id} summary={summary} updatedAt={updatedAt} palette={LIGHT} height={height} />
    ),
    dark: (
      <OsWidgetView id={id} summary={summary} updatedAt={updatedAt} palette={DARK} height={height} />
    ),
  };
}
