import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { JourneyItem, JourneyStage } from '@/types';
import {
  focusBuckets,
  journeyRaceLabel,
  planEtaLabel,
  plannedIndexOf,
  sortItemsForRows,
  sortJourneys,
  splitItemsAtStage,
  stageIndexOf,
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
    lastUpdated: string
  ) => ({ id, priority, furthestStageIdx, lastUpdated });

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

  it('[JRN-008] wires the fold into the overview on web', () => {
    const section = readFileSync(
      join(process.cwd(), 'src/components/journey/journey-section.tsx'),
      'utf8'
    );
    const overview = readFileSync(
      join(process.cwd(), 'src/components/journey/journey-overview.tsx'),
      'utf8'
    );
    expect(section).toContain('splitItemsAtStage(visibleItems, focusStageId)');
    expect(section).toContain('more at other stages');
    expect(section).toContain('highlightStageId={focusStageId}');
    expect(overview).toContain(
      'focusStageId={showStage ? null : (stage?.id ?? null)}'
    );
  });
});
