import { ExtensionStorage } from '@bacons/apple-targets';
import { Platform } from 'react-native';
import { getWidgetInfo, requestWidgetUpdate } from 'react-native-android-widget';

import { renderOsWidget } from '@/components/os-widget';
import { bubbleTime } from '@/lib/format';
import { OS_WIDGET_NAMES, WIDGET_IDS, type WidgetId } from '@/lib/home-widgets';
import { fetchWidgetSummary, hasSession, type WidgetSummary } from '@/lib/widget-summaries';

/** Shared App Group defaults the WidgetKit extension reads — both
 *  constants must match targets/widgets/index.swift. */
export const IOS_APP_GROUP = 'group.com.convoreal.app';
const IOS_STORE_KEY = 'home-widget-summaries';

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
    renderWidget: (info) =>
      renderOsWidget(id, summary, bubbleTime(new Date().toISOString()), info.height),
  });
}

/** iOS widgets can't fetch for themselves — the app pushes one JSON
 *  blob with every summary into the shared defaults, then asks
 *  WidgetKit to redraw all timelines from it. */
async function updateIosWidgets(): Promise<void> {
  const summaries: Partial<Record<WidgetId, WidgetSummary>> = {};
  if (await hasSession()) {
    await Promise.all(
      WIDGET_IDS.map(async (id) => {
        const summary = await fetchWidgetSummary(id).catch(() => null);
        if (summary) summaries[id] = summary;
      })
    );
  }
  const storage = new ExtensionStorage(IOS_APP_GROUP);
  storage.set(
    IOS_STORE_KEY,
    JSON.stringify({ updatedAt: bubbleTime(new Date().toISOString()), summaries })
  );
  ExtensionStorage.reloadWidget();
}

/** Push fresh data to every ConvoReal widget on the home screen. Safe
 *  to fire-and-forget on app open — swallows the "not linked" errors
 *  thrown inside Expo Go / builds without the native modules. */
export async function updateAllOsWidgets(): Promise<void> {
  try {
    if (Platform.OS === 'android') {
      await Promise.all(WIDGET_IDS.map((id) => updateOsWidget(id)));
    } else if (Platform.OS === 'ios') {
      await updateIosWidgets();
    }
  } catch {
    // Native widget module unavailable — nothing to update.
  }
}
