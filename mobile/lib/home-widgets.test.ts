import { describe, expect, it } from 'vitest';

import {
  addWidget,
  availableWidgets,
  DEFAULT_WIDGETS,
  isWidgetId,
  moveWidget,
  normalizeWidgetIds,
  removeWidget,
  WIDGET_DEFS,
  WIDGET_IDS,
  type WidgetId,
} from './home-widgets';

describe('registry', () => {
  it('has a definition for every widget id', () => {
    for (const id of WIDGET_IDS) {
      expect(WIDGET_DEFS[id].id).toBe(id);
      expect(WIDGET_DEFS[id].label).toBeTruthy();
      expect(WIDGET_DEFS[id].description).toBeTruthy();
    }
  });

  it('defaults are valid ids', () => {
    for (const id of DEFAULT_WIDGETS) expect(isWidgetId(id)).toBe(true);
  });
});

describe('normalizeWidgetIds', () => {
  it('falls back to defaults when nothing usable was stored', () => {
    expect(normalizeWidgetIds(undefined)).toEqual(DEFAULT_WIDGETS);
    expect(normalizeWidgetIds(null)).toEqual(DEFAULT_WIDGETS);
    expect(normalizeWidgetIds('inbox')).toEqual(DEFAULT_WIDGETS);
    expect(normalizeWidgetIds({ ids: ['inbox'] })).toEqual(DEFAULT_WIDGETS);
  });

  it('keeps an intentionally emptied list empty', () => {
    expect(normalizeWidgetIds([])).toEqual([]);
  });

  it('drops unknown ids and non-strings, preserving order', () => {
    expect(normalizeWidgetIds(['deals', 'bogus', 42, 'inbox'])).toEqual(['deals', 'inbox']);
  });

  it('dedupes repeated ids', () => {
    expect(normalizeWidgetIds(['inbox', 'inbox', 'calendar'])).toEqual(['inbox', 'calendar']);
  });
});

describe('addWidget / removeWidget', () => {
  it('appends a new widget at the end', () => {
    expect(addWidget(['inbox'], 'deals')).toEqual(['inbox', 'deals']);
  });

  it('is a no-op for an already-added widget', () => {
    const list: WidgetId[] = ['inbox', 'deals'];
    expect(addWidget(list, 'deals')).toBe(list);
  });

  it('removes only the given widget', () => {
    expect(removeWidget(['inbox', 'deals', 'calendar'], 'deals')).toEqual([
      'inbox',
      'calendar',
    ]);
  });
});

describe('moveWidget', () => {
  const list: WidgetId[] = ['inbox', 'calendar', 'deals'];

  it('swaps with the neighbour in the given direction', () => {
    expect(moveWidget(list, 'calendar', 'up')).toEqual(['calendar', 'inbox', 'deals']);
    expect(moveWidget(list, 'calendar', 'down')).toEqual(['inbox', 'deals', 'calendar']);
  });

  it('clamps at the edges', () => {
    expect(moveWidget(list, 'inbox', 'up')).toBe(list);
    expect(moveWidget(list, 'deals', 'down')).toBe(list);
  });

  it('ignores ids not in the list', () => {
    expect(moveWidget(list, 'broadcasts', 'up')).toBe(list);
  });

  it('does not mutate the input', () => {
    moveWidget(list, 'calendar', 'up');
    expect(list).toEqual(['inbox', 'calendar', 'deals']);
  });
});

describe('availableWidgets', () => {
  it('returns the registry order minus chosen widgets', () => {
    expect(availableWidgets(['calendar', 'inbox'])).toEqual([
      'contacts',
      'properties',
      'deals',
      'broadcasts',
    ]);
  });

  it('is empty when everything is chosen', () => {
    expect(availableWidgets([...WIDGET_IDS])).toEqual([]);
  });
});
