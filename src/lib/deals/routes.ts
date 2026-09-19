export type DealsView = 'board' | 'journey' | 'records';

export const DEALS_VIEWS: ReadonlyArray<{
  id: DealsView;
  label: string;
  lede: string;
}> = [
  {
    id: 'board',
    label: 'Board',
    lede: 'Every deal on its pipeline stage. Drag a card to move it; a closing stage asks for brokerage first.',
  },
  {
    id: 'journey',
    label: 'Journey',
    lede: "Each buyer's search as a map: what was shared, what was dropped, and what is still in the race.",
  },
  {
    id: 'records',
    label: 'Records',
    lede: 'The closing record for every commercially active deal: milestones, timeline, papers, tasks and money.',
  },
];

export function parseDealsView(value: string | null | undefined): DealsView {
  return DEALS_VIEWS.some((v) => v.id === value)
    ? (value as DealsView)
    : 'board';
}

export function dealsHref(
  view: DealsView,
  params?: Record<string, string | null | undefined>
): string {
  const search = new URLSearchParams({ view });
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value) search.set(key, value);
  }
  return `/deals?${search.toString()}`;
}

export function legacyJourneyHref(search: URLSearchParams): string {
  return dealsHref('journey', {
    contact: search.get('contact'),
    property: search.get('property'),
    item: search.get('item'),
    journeys: search.get('view') === 'properties' ? 'properties' : null,
  });
}

export function legacyPipelinesHref(search: URLSearchParams): string {
  return dealsHref('board', {
    new: search.get('new'),
    dealId: search.get('dealId'),
  });
}
