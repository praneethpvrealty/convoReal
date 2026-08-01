import type { WidgetTaskHandlerProps } from 'react-native-android-widget';

import { renderOsWidget } from '@/components/os-widget';
import { bubbleTime } from '@/lib/format';
import { widgetIdForOsName } from '@/lib/home-widgets';
import { fetchWidgetSummary, hasSession } from '@/lib/widget-summaries';

/**
 * Headless entry for Android home-screen widgets (registered in
 * index.js): the OS asks for a redraw — widget added, periodic update,
 * resize — and gets fresh RLS-scoped data via the normal Supabase
 * client. Taps deep-link through OPEN_URI click actions, so
 * WIDGET_CLICK never reaches this handler.
 */
export async function widgetTaskHandler(props: WidgetTaskHandlerProps): Promise<void> {
  const id = widgetIdForOsName(props.widgetInfo.widgetName);
  if (!id) return;

  switch (props.widgetAction) {
    case 'WIDGET_ADDED':
    case 'WIDGET_UPDATE':
    case 'WIDGET_RESIZED': {
      const summary = (await hasSession())
        ? await fetchWidgetSummary(id).catch(() => null)
        : null;
      props.renderWidget(renderOsWidget(id, summary, bubbleTime(new Date().toISOString())));
      break;
    }
    default:
      break;
  }
}
