import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { JourneyItem, JourneyStage } from '@/types';
import {
  DEFAULT_JOURNEY_SORT,
  JOURNEY_SORT_LABELS,
  focusBuckets,
  journeyEnquiryLabel,
  journeyEnquirySourceOptions,
  journeyViewCounts,
  matchesJourneyEnquirySource,
  normalizeJourneyEnquirySource,
  journeyRaceLabel,
  journeyStageBucketKey,
  planEtaLabel,
  plannedIndexOf,
  sortItemsForRows,
  sortJourneys,
  splitItemsAtStage,
  stageIndexOf,
  withFocusedItem,
  type JourneyPriority,
} from './shared';

function stage(id: string, position: number): JourneyStage {
  return {
    id,
    account_id: 'acc',
    name: id,
    color: '#000',
    position,
    stage_kind: 'prospecting',
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
  };
}

function item(
  id: string,
  stageId: string,
  status: 'active' | 'dropped',
  createdAt: string
): JourneyItem {
  return {
    id,
    account_id: 'acc',
    contact_id: 'c1',
    property_id: `p-${id}`,
    stage_id: stageId,
    status,
    source: 'manual',
    hidden: false,
    created_at: createdAt,
    updated_at: createdAt,
  };
}

const STAGES = [stage('shared', 0), stage('visited', 1), stage('token', 2)];

describe('journey overview loading', () => {
  it('[JRN-001] loads one SQL-aggregated row per journey subject', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/journey/journey-overview.tsx'),
      'utf8'
    );
    expect(source).toContain("supabase.rpc('journey_overview_groups'");
    expect(source).not.toContain('loadAllJourneyItems');
    expect(source).not.toContain('.limit(2000)');

    const migration = readFileSync(
      join(
        process.cwd(),
        'supabase/migrations/20260915024746_journey_overview_groups.sql'
      ),
      'utf8'
    );
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain('is_account_member(p_account_id)');
    expect(migration).toContain('jsonb_agg(');

    const contactScopeMigration = readFileSync(
      join(
        process.cwd(),
        'supabase/migrations/20260915030559_journey_overview_contact_scope.sql'
      ),
      'utf8'
    );
    expect(contactScopeMigration).toContain(
      "profile.org_role IN ('org_manager', 'org_coordinator')"
    );
    expect(contactScopeMigration).toContain(
      'contacts.assigned_agent_id = (SELECT auth.uid())'
    );
    expect(contactScopeMigration).toContain('contacts.assigned_team_id = (');
  });

  it('[JRN-001] lists a journey at its furthest live stage and, while anything is dropped, at the lost stage too', () => {
    const migration = readFileSync(
      join(
        process.cwd(),
        'supabase/migrations/20260924071006_journey_overview_live_and_lost.sql'
      ),
      'utf8'
    );
    expect(migration).toContain(
      "AND stages.stage_kind = 'lost'\n        AND stages.pipeline_stage_id IS NOT NULL"
    );
    expect(migration).toContain(
      "FILTER (\n          WHERE NOT items.hidden AND items.status = 'active'\n        ))[1] AS live_stage_id"
    );
    expect(migration).toContain(
      "'furthest_stage_id', COALESCE(\n            grouped.live_stage_id,"
    );
    expect(migration).toContain(
      "'lost_stage_id', CASE\n            WHEN grouped.dropped_count > 0\n              THEN (SELECT lost_stage.id FROM lost_stage)"
    );
    expect(migration).toContain('is_account_member(p_account_id)');
    expect(migration).toContain(
      'contacts.assigned_agent_id = (SELECT auth.uid())'
    );

    const overview = readFileSync(
      join(process.cwd(), 'src/components/journey/journey-overview.tsx'),
      'utf8'
    );
    expect(overview).toContain(
      'group.furthestStageIdx === index || group.lostStageId === stage.id'
    );
  });

  it('[JRN-001] classifies a journey with every item dropped at the lost stage', () => {
    const migration = readFileSync(
      join(
        process.cwd(),
        'supabase/migrations/20260924063001_journey_overview_all_dropped_lost.sql'
      ),
      'utf8'
    );
    expect(migration).toContain(
      "AND stages.stage_kind = 'lost'\n        AND stages.pipeline_stage_id IS NOT NULL"
    );
    expect(migration).toContain(
      'WHEN grouped.active_count = 0 AND grouped.dropped_count > 0'
    );
    expect(migration).toContain('(SELECT lost_stage.id FROM lost_stage),');
    expect(migration).toContain('grouped.furthest_stage_id\n              )');
    expect(migration).toContain('is_account_member(p_account_id)');
    expect(migration).toContain(
      'contacts.assigned_agent_id = (SELECT auth.uid())'
    );
  });
});

describe('journey stage note visibility', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/components/journey/journey-item-sheet.tsx'),
    'utf8'
  );

  it('[JRN-004] offers notes at every stage and keeps the complete history', () => {
    expect(source).toContain('const notesAtStage = stageNotes.filter');
    expect(source).toContain('aria-label={`Add note at ${s.name}`}');
    expect(source).toContain('? `Add note · ${notesAtStage.length}`');
    expect(source).not.toContain('canEdit && !future');
    expect(source).toContain('stageNotes.map((note)');
  });
});

describe('stageIndexOf', () => {
  it("[JRN-001] returns the stage's position in the ordered list", () => {
    expect(
      stageIndexOf(item('a', 'visited', 'active', '2026-01-01'), STAGES)
    ).toBe(1);
  });

  it('returns -1 for a stage id that no longer exists', () => {
    expect(
      stageIndexOf(item('a', 'gone', 'active', '2026-01-01'), STAGES)
    ).toBe(-1);
  });
});

describe('sortItemsForRows', () => {
  it('orders furthest-travelled first so the map reads as a funnel', () => {
    const rows = sortItemsForRows(
      [
        item('early', 'shared', 'active', '2026-01-01'),
        item('far', 'token', 'active', '2026-01-02'),
        item('mid', 'visited', 'active', '2026-01-03'),
      ],
      STAGES
    );
    expect(rows.map((r) => r.id)).toEqual(['far', 'mid', 'early']);
  });

  it('puts active before dropped at the same depth, then oldest first', () => {
    const rows = sortItemsForRows(
      [
        item('droppedOld', 'visited', 'dropped', '2026-01-01'),
        item('activeNew', 'visited', 'active', '2026-01-05'),
        item('activeOld', 'visited', 'active', '2026-01-02'),
      ],
      STAGES
    );
    expect(rows.map((r) => r.id)).toEqual([
      'activeOld',
      'activeNew',
      'droppedOld',
    ]);
  });

  it('planEtaLabel renders future, today, and overdue labels', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-17T10:00:00Z'));
    expect(planEtaLabel('2026-08-11')).toEqual({
      text: 'In 25 days',
      overdue: false,
    });
    expect(planEtaLabel('2026-07-18')).toEqual({
      text: 'Tomorrow',
      overdue: false,
    });
    expect(planEtaLabel('2026-07-17')).toEqual({
      text: 'Today',
      overdue: false,
    });
    expect(planEtaLabel('2026-07-14')).toEqual({
      text: '3 days overdue',
      overdue: true,
    });
    expect(planEtaLabel('2026-07-16')).toEqual({
      text: '1 day overdue',
      overdue: true,
    });
    vi.useRealTimers();
  });

  it('plannedIndexOf only accepts stages ahead of the frontier on active items', () => {
    const base = item('a', 'visited', 'active', '2026-01-01');
    expect(plannedIndexOf({ ...base, planned_stage_id: 'token' }, STAGES)).toBe(
      2
    );
    // same/behind the frontier → invalid
    expect(
      plannedIndexOf({ ...base, planned_stage_id: 'visited' }, STAGES)
    ).toBe(-1);
    expect(
      plannedIndexOf({ ...base, planned_stage_id: 'shared' }, STAGES)
    ).toBe(-1);
    // dropped items never show a ghost
    expect(
      plannedIndexOf(
        {
          ...item('b', 'visited', 'dropped', '2026-01-01'),
          planned_stage_id: 'token',
        },
        STAGES
      )
    ).toBe(-1);
    expect(plannedIndexOf(base, STAGES)).toBe(-1);
  });

  it('does not mutate the input array', () => {
    const input = [
      item('a', 'shared', 'active', '2026-01-01'),
      item('b', 'token', 'active', '2026-01-02'),
    ];
    const copy = [...input];
    sortItemsForRows(input, STAGES);
    expect(input).toEqual(copy);
  });
});

describe('sortJourneys', () => {
  const j = (
    id: string,
    priority: JourneyPriority | null,
    furthestStageIdx: number,
    lastUpdated: string,
    enquiryCount = 0,
    lastEnquiredAt: string | null = null
  ) => ({
    id,
    priority,
    furthestStageIdx,
    lastUpdated,
    enquiryCount,
    lastEnquiredAt,
  });

  const input = [
    j('unrated-far', null, 5, '2026-01-05'),
    j('low', 'low', 1, '2026-01-04'),
    j('high-old', 'high', 0, '2026-01-01'),
    j('high-new', 'high', 3, '2026-01-02'),
    j('medium', 'medium', 2, '2026-01-03'),
  ];

  it('puts high priority first and unrated last', () => {
    expect(sortJourneys(input, 'priority').map((x) => x.id)).toEqual([
      'high-new',
      'high-old',
      'medium',
      'low',
      'unrated-far',
    ]);
  });

  it('leads on the chosen key and still breaks ties by priority', () => {
    expect(sortJourneys(input, 'stage')[0].id).toBe('unrated-far');
    expect(sortJourneys(input, 'recent')[0].id).toBe('unrated-far');
    expect(sortJourneys(input, 'recent').map((x) => x.id)).toEqual([
      'unrated-far',
      'low',
      'medium',
      'high-new',
      'high-old',
    ]);
  });

  it('[JRN-003] respects persisted manual order before all tie-breakers', () => {
    const manuallyRanked = input.map((journey, index) => ({
      ...journey,
      sortOrder: input.length - index,
    }));
    expect(sortJourneys(manuallyRanked, 'manual').map((x) => x.id)).toEqual([
      'medium',
      'high-new',
      'high-old',
      'low',
      'unrated-far',
    ]);
  });

  it('[JRN-012] leads with the most enquired journey and breaks ties by the latest enquiry', () => {
    const enquired = [
      j('once-old', null, 0, '2026-01-09', 1, '2026-01-01'),
      j('none-fresh', 'high', 4, '2026-01-10'),
      j('thrice', null, 0, '2026-01-01', 3, '2026-01-02'),
      j('once-new', null, 0, '2026-01-02', 1, '2026-01-05'),
    ];
    expect(sortJourneys(enquired, 'enquiries').map((x) => x.id)).toEqual([
      'thrice',
      'once-new',
      'once-old',
      'none-fresh',
    ]);
  });

  it('[JRN-012] leads with the latest enquiry and breaks ties by enquiry count', () => {
    const enquired = [
      j('none-fresh', 'high', 4, '2026-01-10'),
      j('twice-old', null, 0, '2026-01-01', 2, '2026-01-02'),
      j('once-new', null, 0, '2026-01-01', 1, '2026-01-05'),
      j('thrice-new', null, 0, '2026-01-01', 3, '2026-01-05'),
    ];
    expect(sortJourneys(enquired, 'enquired').map((x) => x.id)).toEqual([
      'thrice-new',
      'once-new',
      'twice-old',
      'none-fresh',
    ]);
  });

  it('[JRN-012] defaults to the most enquired order', () => {
    expect(DEFAULT_JOURNEY_SORT).toBe('enquiries');
    expect(JOURNEY_SORT_LABELS.enquiries).toBe('Most enquired');
    expect(JOURNEY_SORT_LABELS.enquired).toBe('Recently enquired');
  });

  it('does not mutate the input array', () => {
    const copy = [...input];
    sortJourneys(input, 'priority');
    expect(input).toEqual(copy);
  });
});

describe('focusBuckets', () => {
  const buckets = [
    { key: 'stage:new', groups: 91 },
    { key: 'stage:negotiation', groups: 2 },
    { key: 'stage:won', groups: 1 },
  ];

  it('[JRN-006] shows every stage card until one is selected', () => {
    expect(focusBuckets(buckets, null)).toBe(buckets);
  });

  it('[JRN-006] hides the other stage cards while one is selected', () => {
    expect(focusBuckets(buckets, 'stage:negotiation')).toEqual([
      { key: 'stage:negotiation', groups: 2 },
    ]);
  });

  it('[JRN-006] falls back to every stage card when the selected one is gone', () => {
    expect(focusBuckets(buckets, 'closed:completed')).toBe(buckets);
    expect(focusBuckets([], 'stage:new')).toEqual([]);
  });

  it('[JRN-006] keeps the focus through a search and reads it from the address', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/journey/journey-overview.tsx'),
      'utf8'
    );
    expect(source).toContain('focusBuckets(buckets, focusedBucket)');
    expect(source).not.toContain('query.trim() ? null : focusedBucket');
    expect(source).toContain("searchParams.get('stage')");
    expect(source).toContain("params.set('stage', stageId)");
    expect(source).toContain(
      "(focusedBucket === 'stage:unclassified' && unclassifiedExists)"
    );
    expect(source).toContain(
      'onToggleCollapsed={() => toggleCollapsed(bucket.key)}'
    );
    expect(source).toContain(
      'onToggleFocus={() => setFocusedBucket(focused ? null : bucket.key)}'
    );
    expect(source).toContain(
      "{query ? 'Search all stages' : 'Show all stages'}"
    );
  });
});

describe('journeyRaceLabel', () => {
  const enquiry = (
    enquiryCount: number,
    lastEnquiredAt: string | null = null,
    lastEnquirySource: string | null = null,
    enquirySourceCount = lastEnquirySource ? 1 : 0
  ) => ({
    enquiryCount,
    lastEnquiredAt,
    lastEnquirySource,
    enquirySourceCount,
  });

  it('[JRN-012] labels the enquiry count and hides it when there is none', () => {
    expect(journeyEnquiryLabel(enquiry(0))).toBeNull();
    expect(journeyEnquiryLabel(enquiry(1))).toBe('1 enquiry');
    expect(journeyEnquiryLabel(enquiry(19))).toBe('19 enquiries');
  });

  it('[JRN-012] adds the last enquiry date, with the year only when it is not this year', () => {
    const now = new Date('2026-09-28T12:00:00Z');
    expect(journeyEnquiryLabel(enquiry(3, '2026-09-12T12:00:00Z'), now)).toBe(
      '3 enquiries · 12 Sep'
    );
    expect(journeyEnquiryLabel(enquiry(1, '2025-12-03T12:00:00Z'), now)).toBe(
      '1 enquiry · 3 Dec 2025'
    );
    expect(journeyEnquiryLabel(enquiry(2, 'not a date'), now)).toBe(
      '2 enquiries'
    );
    expect(
      journeyEnquiryLabel(enquiry(0, '2026-09-12T12:00:00Z', 'Housing'), now)
    ).toBeNull();
    const source = readFileSync(
      join(process.cwd(), 'src/components/journey/journey-overview.tsx'),
      'utf8'
    );
    expect(source).toContain('{journeyEnquiryLabel(group)}');
    expect(source).toContain('title={enquiredLabel(group)}');
    expect(source).toContain('onClick={onEnquiries}');
    expect(source).toContain('<EnquiriesDialog');
  });

  it('[JRN-012] names the latest enquiry source, counting any others', () => {
    const now = new Date('2026-09-28T12:00:00Z');
    expect(
      journeyEnquiryLabel(enquiry(3, '2026-09-12T12:00:00Z', 'Housing'), now)
    ).toBe('3 enquiries · Housing · 12 Sep');
    expect(
      journeyEnquiryLabel(
        enquiry(4, '2026-09-12T12:00:00Z', 'Magic Bricks', 3),
        now
      )
    ).toBe('4 enquiries · Magic Bricks +2 · 12 Sep');
    expect(journeyEnquiryLabel(enquiry(1, null, 'Manual'), now)).toBe(
      '1 enquiry · Manual'
    );
  });

  it('[JRN-007] counts what is still in the race and says so plainly at zero', () => {
    expect(journeyRaceLabel(3)).toBe('3 in the race');
    expect(journeyRaceLabel(1)).toBe('1 in the race');
    expect(journeyRaceLabel(0)).toBe('Nothing in the race');
  });

  it('[JRN-007] shows the race count instead of repeating the stage inside a stage group', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/journey/journey-overview.tsx'),
      'utf8'
    );
    expect(source).toContain("showStage={view !== 'active'}");
    expect(source).toContain('{showStage && stage ? (');
    expect(source).toContain('{journeyRaceLabel(group.active)}');
    expect(source).toContain('{canEdit && canDrag && (');
  });
});

describe('splitItemsAtStage', () => {
  const rows = [
    { id: 'a', stage_id: 'new', status: 'active' },
    { id: 'b', stage_id: 'token', status: 'active' },
    { id: 'c', stage_id: 'new', status: 'dropped' },
    { id: 'd', stage_id: 'token', status: 'dropped' },
  ];

  it('[JRN-008] leads with the live items on the group stage and folds the rest', () => {
    expect(splitItemsAtStage(rows, 'token')).toEqual({
      atStage: [rows[1]],
      elsewhere: [rows[0], rows[2], rows[3]],
    });
  });

  it('[JRN-008] shows everything when there is no group stage or nothing live on it', () => {
    expect(splitItemsAtStage(rows, null)).toEqual({
      atStage: rows,
      elsewhere: [],
    });
    expect(splitItemsAtStage(rows, 'visited')).toEqual({
      atStage: rows,
      elsewhere: [],
    });
  });

  it('[JRN-008] leads with the dropped items inside the lost stage group', () => {
    expect(splitItemsAtStage(rows, 'lost', true)).toEqual({
      atStage: [rows[2], rows[3]],
      elsewhere: [rows[0], rows[1]],
    });
    const onLost = [...rows, { id: 'e', stage_id: 'lost', status: 'active' }];
    expect(splitItemsAtStage(onLost, 'lost', true).atStage).toEqual([
      rows[2],
      rows[3],
      onLost[4],
    ]);
    expect(splitItemsAtStage(rows.slice(0, 2), 'lost', true)).toEqual({
      atStage: rows.slice(0, 2),
      elsewhere: [],
    });
  });

  it('[JRN-008] wires the fold into the overview on web', () => {
    const section = readFileSync(
      join(process.cwd(), 'src/components/journey/journey-section.tsx'),
      'utf8'
    );
    const overview = readFileSync(
      join(process.cwd(), 'src/components/journey/journey-overview.tsx'),
      'utf8'
    );
    expect(section).toContain(
      'splitItemsAtStage(visibleItems, focusStageId, focusDropped)'
    );
    expect(section).toContain('more at other stages');
    expect(section).toContain('highlightStageId={focusStageId}');
    expect(section).toContain('highlightDropped={focusDropped}');
    const canvas = readFileSync(
      join(process.cwd(), 'src/components/journey/journey-canvas.tsx'),
      'utf8'
    );
    expect(canvas).toContain(
      'item.status === "dropped" || stage.id === highlightStageId'
    );
    expect(canvas).toContain(
      'stage.id === highlightStageId && item.status !== "dropped"'
    );
    expect(overview).toContain(
      'focusStageId={showStage ? null : (bucketStage?.id ?? null)}'
    );
    expect(overview).toContain('bucketStage?.id === group.lostStageId');
  });
});

describe('journey enquiry source filter', () => {
  const g = (id: string, enquirySources: string[]) => ({ id, enquirySources });
  const groups = [
    g('a', ['Housing', 'Manual']),
    g('b', ['Housing']),
    g('c', ['Magic Bricks']),
    g('d', []),
  ];

  it('[JRN-012] offers each source with how many journeys have it, most common first', () => {
    expect(journeyEnquirySourceOptions(groups)).toEqual([
      { source: 'Housing', count: 2 },
      { source: 'Magic Bricks', count: 1 },
      { source: 'Manual', count: 1 },
    ]);
    expect(journeyEnquirySourceOptions([])).toEqual([]);
  });

  it('[JRN-012] keeps a chosen source offered when no journey in view has it', () => {
    expect(journeyEnquirySourceOptions([g('d', [])], '99acres')).toEqual([
      { source: '99acres', count: 0 },
    ]);
  });

  it('[JRN-012] keeps journeys with any enquiry from the chosen source', () => {
    expect(
      groups
        .filter((group) => matchesJourneyEnquirySource(group, 'Housing'))
        .map((group) => group.id)
    ).toEqual(['a', 'b']);
    expect(
      groups.filter((group) => matchesJourneyEnquirySource(group, null))
    ).toHaveLength(4);
  });
  it('[JRN-012] restores only a usable remembered source', () => {
    expect(normalizeJourneyEnquirySource(' Housing ')).toBe('Housing');
    expect(normalizeJourneyEnquirySource('')).toBeNull();
    expect(normalizeJourneyEnquirySource('   ')).toBeNull();
    expect(normalizeJourneyEnquirySource(null)).toBeNull();
    expect(normalizeJourneyEnquirySource(42)).toBeNull();
    expect(normalizeJourneyEnquirySource('x'.repeat(300))).toBe(
      'x'.repeat(300)
    );
  });
});

describe('journeyViewCounts', () => {
  const g = (
    lifecycleStatus: string,
    archivedAt: string | null,
    enquirySources: string[]
  ) => ({ lifecycleStatus, archivedAt, enquirySources });
  const groups = [
    g('active', null, ['Housing']),
    g('active', null, ['Magic Bricks']),
    g('active', null, []),
    g('won', null, ['Housing']),
    g('lost', null, ['Manual']),
    g('active', '2026-09-01', ['Housing']),
  ];

  it('[JRN-012] counts every journey per view when no source is chosen', () => {
    expect(journeyViewCounts(groups, null)).toEqual({
      active: 3,
      closed: 2,
      archived: 1,
    });
  });

  it('[JRN-012] counts only journeys from the chosen source in each view', () => {
    expect(journeyViewCounts(groups, 'Housing')).toEqual({
      active: 1,
      closed: 1,
      archived: 1,
    });
    expect(journeyViewCounts(groups, 'Gone')).toEqual({
      active: 0,
      closed: 0,
      archived: 0,
    });
  });
});

describe('focus after a stage move', () => {
  const atStage = [{ id: 'a' }, { id: 'b' }];
  const elsewhere = [{ id: 'c' }, { id: 'd' }];

  it('[JRN-013] keeps the moved item on the map when it leaves the fold', () => {
    expect(withFocusedItem(atStage, elsewhere, 'd')).toEqual([
      { id: 'a' },
      { id: 'b' },
      { id: 'd' },
    ]);
    expect(withFocusedItem(atStage, elsewhere, 'a')).toBe(atStage);
    expect(withFocusedItem(atStage, elsewhere, null)).toBe(atStage);
  });

  it('[JRN-013] finds the stage group the moved journey now sits in', () => {
    const stages = [stage('new', 0), stage('visit', 1)];
    expect(journeyStageBucketKey(1, stages)).toBe('stage:visit');
    expect(journeyStageBucketKey(-1, stages)).toBe('stage:unclassified');
    expect(journeyStageBucketKey(5, stages)).toBe('stage:unclassified');
  });

  it('[JRN-013] centres the map on the fresh step and scrolls the overview to it', () => {
    const read = (file: string) =>
      readFileSync(join(process.cwd(), 'src/components/journey', file), 'utf8');
    const canvas = read('journey-canvas.tsx');
    const section = read('journey-section.tsx');
    const overview = read('journey-overview.tsx');
    expect(canvas).toContain('nodes: [{ id: focusNodeId }]');
    expect(section).toContain('setFocusItemId(item.id);');
    expect(section).toContain('onItemMoved?.(item.id);');
    expect(section).toContain(
      'withFocusedItem(atStage, elsewhere, focusItemId)'
    );
    expect(overview).toContain(
      'journeyStageBucketKey(spotlightGroup.furthestStageIdx, stages)'
    );
    expect(overview).toContain('`journey-row-${spotlightKey}-${subjectId}`');
    expect(overview).toContain('id={rowId}');
    expect(overview).toContain(
      'setSpotlight({ subjectId: fullscreenGroup.subjectId, itemId })'
    );
    expect(section).toContain('setFocusItemId(spotlightItemId);');
  });
});
