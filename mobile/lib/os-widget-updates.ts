import { Platform } from 'react-native';
import { getWidgetInfo, requestWidgetUpdate } from 'react-native-android-widget';

import { renderOsWidget } from '@/components/os-widget';
import { bubbleTime } from '@/lib/format';
import { OS_WIDGET_NAMES, WIDGET_IDS, type WidgetId } from '@/lib/home-widgets';
import { fetchWidgetSummary, hasSession } from '@/lib/widget-summaries';

export async function updateOsWidget(id: WidgetId): Promise<void> {
  // Skip the data fetch when no instance of this widget is on the home
  // screen — requestWidgetUpdate would silently draw nothing anyway.
  const instances = await getWidgetInfo(OS_WIDGET_NAMES[id]);
  if (instances.length === 0) return;

  const summary = (await hasSession())
    ? await fetchWidgetSummary(id).catch(() => null)
    : null;
  await requestWidgetUpdate({
    widgetName: OS_WIDGET_NAMES[id],
    renderWidget: () => renderOsWidget(id, summary, bubbleTime(new Date().toISOString())),
  });
}

/** Push fresh data to every ConvoReal widget on the home screen. Safe
 *  to fire-and-forget on app open — no-ops on iOS, and swallows the
 *  "not linked" error thrown inside Expo Go / builds without the
 *  native module. */
export async function updateAllOsWidgets(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await Promise.all(WIDGET_IDS.map((id) => updateOsWidget(id)));
  } catch {
    // Native widget module unavailable — nothing to update.
  }
}
