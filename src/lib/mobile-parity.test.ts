/**
 * Drift guard for the mobile app's hand-ported mirrors of web logic.
 *
 * `mobile/` is a separate Expo project with its own package.json and
 * Metro root, so it cannot import from `src/` — several modules there
 * are maintained as copies and say so in their own header comments.
 * Copies rot silently: before this suite existed the mobile plan card
 * advertised Starter as "50 contacts" (really 150) and Agency as
 * "unlimited broadcasts" (really 5,000).
 *
 * These tests read the mobile sources as text and assert they still
 * agree with the web sources of truth. They run in `npm test`, which
 * the pre-commit hook already executes.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';
import * as ts from 'typescript';

import { PLAN_CONFIG, PLAN_ORDER } from '@/lib/billing/plan-config';
import {
  activeEntityQuery,
  insertEntityReference,
  type EntityReference,
} from '@/lib/copilot/entities';
import { TOURS } from '@/lib/copilot/tours';
import { JOURNEY_ITEM_SOURCE_LABELS } from '@/lib/journey/captured';
import { MESSAGES } from '@/lib/i18n/messages';
import {
  AMENITIES_BY_CATEGORY,
  AREA_UNITS,
  COMMERCIAL_TYPES,
  FACING_DIRECTIONS,
  NEARBY_HIGHLIGHTS_OPTIONS,
  PROPERTY_TYPE_GROUPS,
  LAND_OWNERSHIP_TYPES,
  LAND_LEGAL_STATUSES,
  LAND_CONVERSION_TYPES,
  LEGACY_RESIDENTIAL_LAND_PLOT,
  hasBedsBaths,
  isApartmentType,
  isLandType,
  isRawLandType,
} from '@/lib/inventory/property-options';
import { PROPERTY_TYPE_VALUES } from '@/lib/property-types';
import { BUDGET_OPTIONS } from '@/lib/contacts/budget-options';
import {
  budgetToRupees,
  rupeesToBudgetAmount,
} from '@/lib/contacts/budget-amount';
import {
  DEAL_DOCUMENT_CATEGORIES,
  DEAL_DOCUMENT_MIME_TYPES,
  INVOICE_STATUS_LABELS,
} from '@/lib/invoices/types';
import { brokerageAmount } from '@/lib/pipelines/brokerage';
import { DEAL_WORKSPACE_TABS } from '@/components/deals/deal-workspace';
import {
  isClosingRecord,
  transactionSubtitle,
  transactionTitle,
} from '@/lib/deals/index-row';
import {
  UPDATE_CHANNEL_LABELS,
  UPDATE_STAGE_LABELS,
} from '@/lib/deals/updates';
import { DEAL_DOCUMENT_STATUS_LABELS } from '@/lib/deals/documents';
import { DEAL_EVENT_LABELS } from '@/lib/deals/events';
import { TDS_STATUS_LABELS } from '@/lib/deals/financials';
import { DEAL_MILESTONE_STATUS_LABELS } from '@/lib/deals/milestones';
import {
  DEAL_SHARE_TTL_CHOICES,
  SHARE_ACCESS_LABELS,
} from '@/lib/deals/share-links';
import {
  STAKEHOLDER_ROLE_LABELS,
  STAKEHOLDER_SIDE_LABELS,
  defaultSideForRole,
  type StakeholderRole,
} from '@/lib/deals/stakeholders';
import { DEAL_VISIBILITY_LABELS } from '@/lib/deals/visibility';
import {
  DIGEST_PAUSE_COMMAND,
  DIGEST_RESUME_COMMAND,
  OWNER_DETAILS_SECTIONS,
  OWNER_DETAILS_SECTION_TITLES,
  buildOwnerDetailsRequestMessage,
  ownerDetailsSectionItems,
} from '@/lib/owners/details-request';
import {
  CONSENT_HINTS,
  CONSENT_LABELS,
  CONSENT_OVERRIDE_WARNING,
  CONSENT_STATES,
} from '@/lib/contacts/alerts-consent';
import { GREETING_MESSAGE_MAX, GREETING_TONES } from '@/lib/greetings/generate';
import { OCCASIONS } from '@/lib/greetings/occasions';
import { PERSONAL_GREETING_CARD_LABEL } from '@/lib/greetings/personal-share';
import { priceInWords } from '@/lib/currency-utils';
import { confidentialityNote } from '@/lib/share-message-builder';
import {
  gateRequestStatusLabel,
  gateSummary,
} from '@/lib/inventory/gate-stats';
import { buildShowcaseShareLink } from '@/lib/inventory/showcase-share-link';
import {
  MONTHLY_PRICED_LISTING_TYPES,
  rentalYieldPercent,
} from '@/lib/inventory/rental-yield';
import {
  FLOW_CHECKBOX_MAX_ITEMS,
  PROPERTY_INTEREST_FLOW_IDS,
  PROPERTY_INTEREST_OPTIONS,
  PROPERTY_INTEREST_SHORT_TITLES,
} from '@/lib/property-interests';
import { CUSTOMER_WINDOW_EXPIRED_MESSAGE } from '@/lib/whatsapp/customer-window';
import {
  DELIVERY_FAILURE_MARKER,
  META_MARKETING_FREQUENCY_ERROR,
} from '@/lib/whatsapp/delivery-failure';
import {
  HIDE_ACTION_LABEL,
  HIDE_CONFIRM_MESSAGE,
  MAX_PINNED_PER_CONVERSATION,
} from '@/lib/whatsapp/message-state';
import { JOURNEY_LIFECYCLE_STATUSES } from '@/lib/journey/overview-state';
import { CONVERSATION_CLOSE_REASONS } from '@/lib/conversations/closure';

function mobileSource(relativePath: string): string {
  return readFileSync(join(process.cwd(), 'mobile', relativePath), 'utf8');
}

function webSource(relativePath: string): string {
  return readFileSync(join(process.cwd(), 'src', relativePath), 'utf8');
}

function mobileCopilotEntityComposer(): {
  activeCopilotEntityQuery: (
    input: string,
    selected?: EntityReference[]
  ) => ReturnType<typeof activeEntityQuery>;
  insertCopilotEntity: typeof insertEntityReference;
} {
  const output = ts.transpileModule(mobileSource('lib/copilot-entities.ts'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const sandboxModule = { exports: {} };
  runInNewContext(output, {
    module: sandboxModule,
    exports: sandboxModule.exports,
  });
  return sandboxModule.exports as ReturnType<
    typeof mobileCopilotEntityComposer
  >;
}

function mobileConversationClosure(): {
  CONVERSATION_CLOSE_REASONS: typeof CONVERSATION_CLOSE_REASONS;
} {
  const output = ts.transpileModule(
    mobileSource('lib/conversation-closure.ts'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }
  ).outputText;
  const sandboxModule = { exports: {} };
  runInNewContext(output, {
    module: sandboxModule,
    exports: sandboxModule.exports,
  });
  return sandboxModule.exports as ReturnType<typeof mobileConversationClosure>;
}

/** The `[ ... ]` body of an `export const <name> = [ ... ];` block. */
function constBody(source: string, name: string): string {
  const start = source.indexOf(`export const ${name}`);
  if (start === -1) throw new Error(`${name} not found in mobile source`);
  const open = source.indexOf('[', start);
  const end = source.indexOf('];', open);
  if (open === -1 || end === -1)
    throw new Error(`${name} is not an array literal`);
  return source.slice(open, end);
}

/** String literals inside an `export const <name> = [ ... ];` block. */
function stringLiteralsInConst(source: string, name: string): string[] {
  return stringLiterals(constBody(source, name));
}

function stringLiterals(block: string): string[] {
  return Array.from(
    block.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)
  ).map((m) => (m[1] ?? m[2]).replace(/\\'/g, "'").replace(/\\"/g, '"'));
}

describe('mobile Copilot entity tokens mirror the web composer', () => {
  const mobile = mobileCopilotEntityComposer();
  const selected: EntityReference[] = [
    {
      kind: 'property',
      id: '11111111-1111-4111-8111-111111111111',
      label: 'JP Nagar Plot',
    },
  ];

  it.each([
    'Open #JP Nag',
    'Message @',
    'View &Site visit',
    'No entity token',
    'Open #JP Nagar Plot ',
  ])('parses %s identically', (input) => {
    expect(mobile.activeCopilotEntityQuery(input, selected)).toEqual(
      activeEntityQuery(input, selected)
    );
  });

  it('inserts the same canonical token', () => {
    const input = 'Please open #jp';
    const webActive = activeEntityQuery(input, selected)!;
    const mobileActive = mobile.activeCopilotEntityQuery(input, selected)!;
    expect(mobile.insertCopilotEntity(input, mobileActive, selected[0])).toBe(
      insertEntityReference(input, webActive, selected[0])
    );
  });
});

describe('property shortlist sharing remains available on both surfaces', () => {
  it('[PRP-002] opens selected inventory directly as a hand-picked share', () => {
    const mobileScreen = mobileSource('app/(app)/(tabs)/properties.tsx');
    const mobileBar = mobileSource('components/bulk-tag-bar.tsx');
    const webInventory = webSource(
      'app/(dashboard)/inventory/inventory-content.tsx'
    );
    const webBar = webSource('components/inventory/bulk-tag-bar.tsx');

    expect(mobileScreen).toContain('initialPicked={selectedProperties}');
    expect(mobileBar).toContain('Share shortlist');
    expect(webInventory).toContain('initialPickedIds={selectedForTagging}');
    expect(webBar).toContain('Share shortlist');
  });

  it('[PRP-009] attributes contact-card inventory links to their recipient', () => {
    const mobile = mobileSource('components/agent-inventory-share-sheet.tsx');
    const web = webSource('components/contacts/share-inventory-dialog.tsx');

    expect(mobile).toContain("audience: 'agent'");
    expect(mobile).toContain('visitorId: contact.id');
    expect(mobile).toContain('baseUrl: trackedBaseUrl');
    expect(web).toContain('mode=view&v=${encodeURIComponent(contactId)}');
  });

  it('[PRP-010] requires a named contact for personal WhatsApp property shares', () => {
    const mobile = mobileSource('components/property-share-sheet.tsx');
    const webProperty = webSource(
      'components/inventory/property-share-dialog.tsx'
    );
    const webShowcase = webSource(
      'components/inventory/showcase-share-dialog.tsx'
    );
    const mobileShowcase = mobileSource('components/showcase-share-sheet.tsx');
    const broadcastRoute = webSource('app/api/whatsapp/broadcast/route.ts');

    expect(mobile).toContain('recipientId: contact.id');
    expect(mobile).not.toContain('Open WhatsApp without a contact');
    expect(mobile).not.toContain("label: 'More apps…'");
    expect(mobile).not.toContain("label: 'Share photo'");
    expect(mobileShowcase).not.toContain('Share showcase anywhere');
    expect(mobileShowcase).toContain('rendered.includes(url)');
    expect(webShowcase).toContain('rendered.includes(link)');
    expect(webShowcase).toContain("button.url.includes('{{1}}')");
    expect(webProperty).toContain(
      'Choose the recipient below so their Showcase link is tracked.'
    );
    expect(webShowcase).toContain(
      'disabled={!generatedLink || sendableContacts.length === 0}'
    );
    expect(broadcastRoute).toContain('ensureTrackedPropertyShowcaseLink(');
    expect(broadcastRoute).toContain('trackedPropertyButtonParam(');
  });
});

describe('contact merge remains available on both surfaces', () => {
  it('[CTM-001] exposes survivor selection and the shared merge route on mobile', () => {
    const mobileContact = mobileSource('app/(app)/contact/[id].tsx');
    const mobileMerge = mobileSource('components/contact-merge-sheet.tsx');
    const webMerge = webSource('components/contacts/duplicates-panel.tsx');

    expect(mobileContact).toContain('Merge with another contact');
    expect(mobileContact).toContain('<ContactMergeSheet');
    expect(mobileMerge).toContain("'/api/contacts/merge'");
    expect(mobileMerge).toContain('Keep this record');
    expect(webMerge).toContain("'/api/contacts/merge'");
  });
});

describe('the portal link invite is one server draft on both surfaces', () => {
  it('[CTM-002] offers business and personal WhatsApp from the same route on web and mobile', () => {
    const mobileContact = mobileSource('app/(app)/contact/[id].tsx');
    const mobileSheet = mobileSource('components/portal-invite-sheet.tsx');
    const webContact = webSource('components/contacts/contact-detail-view.tsx');
    const webDialog = webSource('components/contacts/portal-invite-dialog.tsx');

    expect(mobileContact).toContain('label="Share Portal"');
    expect(mobileContact).toContain('<PortalInviteSheet');
    expect(webContact).toContain('Share Portal');
    expect(webContact).toContain('<PortalInviteDialog');
    for (const source of [mobileSheet, webDialog]) {
      expect(source).toContain('/portal-invite`');
      expect(source).toContain("channel: 'business'");
      expect(source).toContain("channel: 'personal'");
      expect(source).toContain('https://wa.me/${digits}?text=');
    }
  });
});

describe('Google locality picks run the same nearby search on both surfaces', () => {
  it('[PRP-003] makes the suggestion row geographic and keeps exact areas explicit', () => {
    const mobileScreen = mobileSource('app/(app)/(tabs)/properties.tsx');
    const mobileStore = mobileSource('lib/property-search-store.ts');
    const webInventory = webSource(
      'app/(dashboard)/inventory/inventory-content.tsx'
    );

    expect(mobileScreen).toContain('onPress={() => pick(s)}');
    expect(mobileScreen).toContain('Search near ${s.main_text}');
    expect(mobileScreen).toContain('onPress={() => add(s)}');
    expect(mobileScreen).toContain(
      'Add ${s.main_text} as an exact area filter'
    );
    expect(mobileStore).toContain('DEFAULT_LOCALITY_RADIUS_KM = 10');
    expect(webInventory).toContain('DEFAULT_LOCALITY_RADIUS_KM = 10');
    expect(
      webInventory.match(/setRadiusKm\(DEFAULT_LOCALITY_RADIUS_KM\)/g)
    ).toHaveLength(2);
  });
});

describe('mobile journey lifecycle mirrors the web overview', () => {
  const screen = mobileSource('app/(app)/journey.tsx');

  it('[JRN-001] groups both buyer and property journeys at the furthest stage', () => {
    expect(screen).toContain("type JourneyMode = 'buyer' | 'property'");
    expect(screen).toContain("supabase.rpc('journey_overview_groups'");
    expect(screen).toContain('captured: Number(row.captured_count)');
    expect(screen).toContain('stageIndexById.get(row.furthest_stage_id)');
    expect(screen).not.toContain('.limit(2000)');
    expect(screen).not.toContain('JOURNEY_PAGE_SIZE');
    expect(screen).toContain("query = query.gt('id', afterId)");
  });

  it('[JRN-002] keeps the same lifecycle statuses', () => {
    const source = mobileSource('lib/journey-overview.ts');
    expect(stringLiteralsInConst(source, 'JOURNEY_LIFECYCLE_STATUSES')).toEqual(
      JOURNEY_LIFECYCLE_STATUSES
    );
  });

  it('[JRN-002] does not render mutation controls for viewer accounts', () => {
    expect(screen).toContain("profile.account_role !== 'viewer'");
    expect(screen).toContain('.enabled(canEdit)');
    expect(screen).toContain('{canEdit ? (');
    expect(screen).toContain('{itemStage ? (');
    expect(screen).toContain("{canEdit ? 'Add or view' : 'View'} notes");
  });

  it('[JRN-005] reviews captured shares in a tray with show, show all and remove', () => {
    const helpers = mobileSource('lib/journey-captured.ts');
    for (const [source, label] of Object.entries(JOURNEY_ITEM_SOURCE_LABELS)) {
      expect(helpers).toContain(`${source}: '${label}'`);
    }
    expect(screen).toContain(
      'loadJourneyItems(mode, trayGroup!.subjectId, true)'
    );
    expect(screen).toContain('loadJourneyItems(mode, group.subjectId, false)');
    expect(screen).toContain(".eq('hidden', hidden)");
    expect(screen).toContain('Captured — not on the journey yet');
    expect(screen).toContain("supabase.rpc('journey_show_captured'");
    expect(screen).toContain('p_item_ids: items.map((item) => item.id)');
    expect(screen).not.toContain('.update({ hidden: false })');
    expect(screen).not.toContain("from('journey_events')");
    expect(screen).toContain('label={`Show all ${capturedItems.length}`}');
    expect(screen).toContain('.delete()');
    expect(screen).toContain('accessibilityLabel="Remove from journey"');
    expect(screen).toContain('{canEdit && confirming ? (');
    expect(screen).toContain('{canEdit && !confirming ? (');
    expect(screen).toContain('copilotFabClearance(insets.bottom)');
  });

  it('[JRN-006] focuses one stage from its own control, searches within it, and collapses from the header', () => {
    const helpers = mobileSource('lib/journey-overview.ts');
    expect(helpers).toContain('export function focusBuckets');
    expect(helpers).toContain('return focused.length ? focused : buckets;');
    expect(screen).toContain('focusBuckets(buckets, focusedBucket)');
    expect(screen).not.toContain('query.trim() ? null : focusedBucket');
    expect(screen).toContain(
      'bucket.groups.length > 0 || bucket.key === focusedBucket'
    );
    expect(screen).toContain('const focused = bucket.key === focusedBucket;');
    expect(screen).toContain(
      'const collapsed = !focused && collapsedBuckets.has(bucket.key);'
    );
    expect(screen).toContain(
      'const showBody = !collapsed && (bucket.groups.length > 0 || focused);'
    );
    expect(screen).toContain('setFocusedBucket(focused ? null : bucket.key)');
    expect(screen).toContain(
      'borderColor: focused ? bucket.color : colors.glassBorder'
    );
    expect(screen).toContain(
      "focused ? 'Show all stages' : `Show only ${bucket.label}`"
    );
    expect(screen).toContain('{focused && bucket.groups.length === 0 ? (');
    expect(screen).toContain(
      "{query.trim() ? 'Search all stages' : 'Show all stages'}"
    );
    expect(screen).not.toContain('closedBuckets');
  });

  it('[JRN-007] shows the same in-the-race count instead of repeating the stage inside a stage group', () => {
    const helpers = mobileSource('lib/journey-overview.ts');
    const webShared = webSource('components/journey/shared.ts');
    const body = (source: string) =>
      source.slice(source.indexOf('export function journeyRaceLabel'));
    expect(body(helpers).split('\n').slice(0, 3)).toEqual(
      body(webShared).split('\n').slice(0, 3)
    );
    expect(screen).toContain("stageInHeader={view === 'active'}");
    expect(screen).toContain('journeyRaceLabel(group.active)');
    const webOverview = webSource('components/journey/journey-overview.tsx');
    expect(webOverview).toContain("showStage={view !== 'active'}");
    expect(webOverview).toContain('journeyRaceLabel(group.active)');
  });

  it('[JRN-008] folds items at other stages behind the same count inside a stage group', () => {
    const helpers = mobileSource('lib/journey-overview.ts');
    const webShared = webSource('components/journey/shared.ts');
    const body = (source: string) =>
      source
        .slice(source.indexOf('export function splitItemsAtStage'))
        .split('export function focusBuckets')[0];
    expect(body(helpers)).toEqual(body(webShared));
    expect(screen).toContain('stageInHeader ? (stage?.id ?? null) : null');
    expect(screen).toContain(
      'atStage.map((item) => renderItem(item, elsewhere.length > 0))'
    );
    expect(screen).toContain('more at other stages');
    const webSection = webSource('components/journey/journey-section.tsx');
    expect(webSection).toContain('more at other stages');
  });

  it('[JRN-004] offers every stage while retaining the complete note history', () => {
    expect(screen).toContain('Journey stage notes');
    expect(screen).toContain('stages.map((stage)');
    expect(screen).toContain('current ? { ...current, stage } : current');
    expect(screen).toContain('const notesByStage = useMemo');
    expect(screen).toContain('const latestNote = stageNotes[0]');
    expect(screen).toContain('{latestNote.note}');
    expect(screen).toContain('loadJourneyStageNotes(noteTarget!.item.id)');
    expect(screen).toContain('.range(from, from + JOURNEY_NOTE_PAGE_SIZE - 1)');
    expect(screen).toContain('Complete journey history');
    expect(screen).toContain('(notesQuery.data ?? []).map((note)');
  });
});

describe('mobile conversation closure mirrors the web inbox', () => {
  it('[INB-001] keeps the same structured close reasons', () => {
    expect(mobileConversationClosure().CONVERSATION_CLOSE_REASONS).toEqual(
      CONVERSATION_CLOSE_REASONS
    );
  });

  it('[INB-001] clears closure details on inbound customer replies', () => {
    const webhook = readFileSync(
      join(process.cwd(), 'src/lib/whatsapp/webhook-handler.ts'),
      'utf8'
    );
    expect(webhook).toContain("status: 'open'");
    expect(webhook).toContain('close_reason: null');
    expect(webhook).toContain('close_note: null');
    expect(webhook).toContain('closed_at: null');
  });
});

describe('mobile/lib/plan-meta.ts mirrors plan-config', () => {
  const source = mobileSource('lib/plan-meta.ts');

  /** The `PLAN_META` entry body for one plan, e.g. everything between
   *  `starter: {` and its closing brace. */
  function planBlock(plan: string): string {
    const start = source.indexOf(`  ${plan}: {`);
    expect(start, `no PLAN_META entry for ${plan}`).toBeGreaterThan(-1);
    const end = source.indexOf('\n  },', start);
    return source.slice(start, end);
  }

  it.each(PLAN_ORDER)('%s keeps the web label and tagline', (plan) => {
    const block = planBlock(plan);
    expect(block).toContain(`label: '${PLAN_CONFIG[plan].name}'`);
    expect(block).toContain(`tagline: '${PLAN_CONFIG[plan].tagline}'`);
  });

  // Perks are editorial prose, so we can't derive the string — but every
  // number quoted in it must be that plan's real limit, and a capped
  // plan must never be sold as "unlimited".
  const LIMIT_BY_UNIT: Record<string, keyof (typeof PLAN_CONFIG)['starter']> = {
    user: 'maxUsers',
    users: 'maxUsers',
    member: 'maxUsers',
    members: 'maxUsers',
    contact: 'maxContacts',
    contacts: 'maxContacts',
    property: 'maxProperties',
    properties: 'maxProperties',
    broadcast: 'maxBroadcastsPerMonth',
    broadcasts: 'maxBroadcastsPerMonth',
  };

  it.each(PLAN_ORDER)('%s quotes real limits in its perks line', (plan) => {
    const perks = /perks: '([^']*)'/.exec(planBlock(plan))?.[1];
    expect(perks, `no perks string for ${plan}`).toBeDefined();

    const quoted = Array.from(
      perks!.matchAll(
        /([\d,]+)\s+(users?|members?|contacts?|properties|broadcasts?)/g
      )
    );
    expect(
      quoted.length,
      `perks for ${plan} quote no limits at all`
    ).toBeGreaterThan(0);

    for (const [, rawCount, unit] of quoted) {
      const field = LIMIT_BY_UNIT[unit];
      expect(
        Number(rawCount.replace(/,/g, '')),
        `${plan} perks "${unit}"`
      ).toBe(PLAN_CONFIG[plan][field]);
    }

    for (const unit of Object.keys(LIMIT_BY_UNIT)) {
      if (new RegExp(`unlimited\\s+${unit}\\b`, 'i').test(perks!)) {
        expect(
          PLAN_CONFIG[plan][LIMIT_BY_UNIT[unit]],
          `${plan} perks say unlimited ${unit} but the plan is capped`
        ).toBe(Number.POSITIVE_INFINITY);
      }
    }
  });
});

describe('mobile/lib/property-options.ts mirrors the web option catalog', () => {
  const source = mobileSource('lib/property-options.ts');

  it('offers the same property types in the same groups', () => {
    const groups = Array.from(
      source.matchAll(/group: '([^']+)',\s*options: \[([\s\S]*?)\]/g)
    ).map(([, group, body]) => ({ group, options: stringLiterals(body) }));

    // The Commercial group spreads COMMERCIAL_TYPES rather than listing
    // them, so fill it in from the const the spread refers to.
    const commercial = stringLiteralsInConst(source, 'COMMERCIAL_TYPES');
    const resolved = groups.map((g) =>
      g.options.length === 0 ? { ...g, options: commercial } : g
    );

    expect(resolved).toEqual(
      PROPERTY_TYPE_GROUPS.map((g) => ({
        group: g.group,
        options: g.options.map((o) => o.value),
      }))
    );
  });

  it('gates commercial fields on the same type list', () => {
    expect(stringLiteralsInConst(source, 'COMMERCIAL_TYPES')).toEqual(
      COMMERCIAL_TYPES
    );
  });

  it.each([
    ['FACING_DIRECTIONS', FACING_DIRECTIONS],
    ['AREA_UNITS', AREA_UNITS],
    ['NEARBY_HIGHLIGHTS_OPTIONS', NEARBY_HIGHLIGHTS_OPTIONS],
    ['LAND_OWNERSHIP_TYPES', LAND_OWNERSHIP_TYPES],
    ['LAND_LEGAL_STATUSES', LAND_LEGAL_STATUSES],
    ['LAND_CONVERSION_TYPES', LAND_CONVERSION_TYPES],
  ])('keeps %s in sync', (name, expected) => {
    expect(stringLiteralsInConst(source, name)).toEqual(expected);
  });

  // The type predicates decide which field groups an editor renders.
  // Mobile shipped without them, so a plot's editor asked for bedrooms
  // and a super-built area — fields a vacant parcel cannot have.
  // Compared by behaviour across the whole taxonomy rather than by
  // literal, since the mobile lists reference a shared legacy const.
  it.each([
    ['BEDS_BATHS_TYPES', hasBedsBaths],
    ['LAND_TYPES', isLandType],
    ['RAW_LAND_TYPES', isRawLandType],
    ['APARTMENT_TYPES', isApartmentType],
  ])(
    'classifies every property type the same way as %s',
    (name, webPredicate) => {
      const body = constBody(source, name);
      const members = new Set(stringLiterals(body));
      if (body.includes('LEGACY_RESIDENTIAL_LAND_PLOT')) {
        members.add(LEGACY_RESIDENTIAL_LAND_PLOT);
      }

      for (const type of PROPERTY_TYPE_VALUES) {
        expect(members.has(type), `${name} disagrees on "${type}"`).toBe(
          webPredicate(type)
        );
      }
    }
  );

  it('offers the same amenities under the same categories', () => {
    const categories = Array.from(
      source.matchAll(
        /category: '((?:[^'\\]|\\.)*)',\s*\n\s*items: \[([\s\S]*?)\]/g
      )
    ).map(([, category, body]) => [
      category.replace(/\\'/g, "'"),
      stringLiterals(body),
    ]);

    expect(Object.fromEntries(categories)).toEqual(AMENITIES_BY_CATEGORY);
  });
});

describe('mobile property editor field parity', () => {
  const source = mobileSource('app/(app)/property-edit.tsx');

  it('round-trips road width and its unit for non-apartment properties', () => {
    expect(source).toContain(
      "'dimensions, road_width, road_width_unit, facing_direction"
    );
    expect(source).toContain('road_width: isApartment ? null : num(roadWidth)');
    expect(source).toContain(
      "road_width_unit: isApartment ? null : roadWidthUnit || 'Feet'"
    );
    expect(source).toContain('label="Road width"');
  });
});

describe('mobile/lib/consent.ts mirrors the alerts-consent wording', () => {
  // Consent is a compliance state. Two surfaces describing the same
  // state in different words — or warning differently before undoing a
  // contact's own opt-out — is worse than either wording alone.
  const source = mobileSource('lib/consent.ts');

  it('carries the same label for every state', () => {
    for (const state of CONSENT_STATES) {
      expect(source, state).toContain(`'${CONSENT_LABELS[state]}'`);
    }
  });

  it('carries the same hint for every state', () => {
    for (const state of CONSENT_STATES) {
      for (const fragment of CONSENT_HINTS[state].split('. ')) {
        const trimmed = fragment.trim();
        if (trimmed.length > 24) expect(source, state).toContain(trimmed);
      }
    }
  });

  it('warns with the same words before undoing an opt-out', () => {
    for (const fragment of CONSENT_OVERRIDE_WARNING.split(' — ')) {
      expect(source).toContain(fragment.trim());
    }
  });

  it('offers exactly the states the column allows', () => {
    expect(stringLiteralsInConst(source, 'CONSENT_STATES')).toEqual([
      ...CONSENT_STATES,
    ]);
  });
});

describe('mobile/lib/greetings.ts mirrors the greeting composer limits', () => {
  // The occasion catalog itself is served over the API rather than
  // copied, so the only thing that can drift is the composer's own
  // limits. A mobile cap larger than the web's would let an agent write
  // a greeting the API then rejects, after they had already paid the
  // credits to generate it.
  const source = mobileSource('lib/greetings.ts');

  it('caps the greeting at the same length the API enforces', () => {
    expect(source).toContain(`GREETING_MESSAGE_MAX = ${GREETING_MESSAGE_MAX}`);
  });

  it('offers the same tones the prompt builder accepts', () => {
    expect(stringLiteralsInConst(source, 'GREETING_TONES')).toEqual([
      ...GREETING_TONES,
    ]);
  });

  it('labels the personal WhatsApp card link the same way', () => {
    expect(source).toContain(
      `PERSONAL_GREETING_CARD_LABEL = '${PERSONAL_GREETING_CARD_LABEL}'`
    );
  });

  it('does not copy the occasion catalog, which shifts every year', () => {
    for (const occasion of OCCASIONS) {
      expect(
        source.includes(`'${occasion.label}'`),
        `mobile hardcodes the occasion "${occasion.label}" — it must come from /api/greetings/occasions`
      ).toBe(false);
    }
  });
});

describe('mobile/lib/customer-window.ts mirrors customer-window', () => {
  // Meta rejects the send when this is wrong, so the two copies have to
  // agree on the window length, the error markers, and the pre-flight
  // message that `isReengagementError` has to keep recognising.
  const source = mobileSource('lib/customer-window.ts');

  it('uses the same 24-hour window', () => {
    expect(source).toContain(`CUSTOMER_WINDOW_MS = 24 * 60 * 60 * 1000`);
  });

  it('matches the same re-engagement markers', () => {
    for (const marker of ['131047', '24 hours', 're-engagement']) {
      expect(source, `missing marker ${marker}`).toContain(marker);
    }
  });

  it('throws the same pre-flight message', () => {
    expect(source).toContain(CUSTOMER_WINDOW_EXPIRED_MESSAGE);
  });
});

describe('mobile/lib/reply-state.ts mirrors reply-state', () => {
  // Both inboxes decide "does this thread need a human?" from the same
  // conversation columns. If the copies disagree, a thread shows as
  // handled on one surface and waiting on the other.
  const source = mobileSource('lib/reply-state.ts');
  const web = readFileSync(
    join(process.cwd(), 'src/lib/whatsapp/reply-state.ts'),
    'utf8'
  );

  it.each([
    'needsReply',
    'waitingShort',
    'needsReplyLabel',
    'unanswered',
    'unansweredLabel',
  ])('keeps the %s body identical to the web source', (name) => {
    const body = (s: string) => {
      const start = s.indexOf(`export function ${name}`);
      expect(start, `${name} missing`).toBeGreaterThan(-1);
      const end = s.indexOf('\n}', start);
      return s.slice(start, end);
    };
    expect(body(source)).toBe(body(web));
  });
});

describe('mobile/lib/message-actions.ts mirrors delivery-failure', () => {
  // The marker is what a resend or forward cuts the failure note off at.
  // If the webhook's wording changes and the mobile copy doesn't, the
  // agent's own error report goes back out to the customer.
  it('cuts at the same marker', () => {
    expect(mobileSource('lib/message-actions.ts')).toContain(
      DELIVERY_FAILURE_MARKER
    );
  });

  it('[INB-008] blocks the same Meta marketing-frequency error', () => {
    expect(mobileSource('lib/message-actions.ts')).toContain(
      `META_MARKETING_FREQUENCY_ERROR = ${META_MARKETING_FREQUENCY_ERROR}`
    );
    expect(mobileSource('lib/message-actions.ts')).toContain(
      'canRetryDeliveryFailure(message)'
    );
  });
});

describe('mobile/lib/message-reactions.ts mirrors the web quick-reaction bar', () => {
  // Both surfaces sit on the same message rows and the same
  // /api/whatsapp/react route. An emoji offered on one and missing on
  // the other reads as a broken thread to whoever reached for the
  // second surface, so the bars have to stay identical.
  it('offers the same quick reactions the web thread does', () => {
    const web = stringLiterals(
      readFileSync(
        join(process.cwd(), 'src/components/inbox/message-actions.tsx'),
        'utf8'
      ).match(/const QUICK_EMOJIS = \[[^\]]*\]/)?.[0] ?? ''
    );

    expect(web.length).toBeGreaterThan(0);
    expect(
      stringLiteralsInConst(
        mobileSource('lib/message-reactions.ts'),
        'QUICK_EMOJIS'
      )
    ).toEqual(web);
  });
});

describe('mobile/lib/message-state.ts mirrors message-state', () => {
  // Pin and hide are Engine-local: WhatsApp has no revoke endpoint and
  // no pin outside a group. If either copy stops saying so, an agent
  // tells a customer their message was deleted when it is still on
  // their phone — so the wording is pinned, not just the cap.
  const source = mobileSource('lib/message-state.ts');

  it('uses the same pin ceiling', () => {
    expect(source).toContain(
      `MAX_PINNED_PER_CONVERSATION = ${MAX_PINNED_PER_CONVERSATION}`
    );
  });

  it('carries the same confirmation copy, verbatim', () => {
    expect(source).toContain(HIDE_CONFIRM_MESSAGE);
  });

  it('names the action the same way on both surfaces', () => {
    expect(source).toContain(HIDE_ACTION_LABEL);
  });

  it('still warns, in its own header, that neither reaches WhatsApp', () => {
    expect(source).toMatch(/no revoke endpoint/i);
  });
});

describe('mobile/lib/share-message.ts mirrors share-message-builder', () => {
  it('exports every function the web builder does', () => {
    const exportedFunctions = (source: string) =>
      Array.from(source.matchAll(/export function (\w+)/g))
        .map((m) => m[1])
        .sort();

    const web = exportedFunctions(
      readFileSync(
        join(process.cwd(), 'src/lib/share-message-builder.ts'),
        'utf8'
      )
    );
    const mobile = exportedFunctions(mobileSource('lib/share-message.ts'));

    // Mobile may add surface-specific builders on top; it must never be
    // missing one the web share dialog relies on.
    expect(mobile).toEqual(expect.arrayContaining(web));
  });

  // The confidentiality note is the customer-facing explanation of why a
  // listing is gated. Two surfaces telling a buyer two different stories
  // about the owner's instruction is worse than either story alone, so
  // this is pinned verbatim rather than merely "present".
  it('carries the same confidentiality note, verbatim', () => {
    // Both files build the note by concatenating literals across source
    // lines, so neither the whole string nor a fragment spanning a `+`
    // appears verbatim. Splicing the concatenation joints back out gives
    // a source to match the web builder's own output against.
    const source = mobileSource('lib/share-message.ts')
      .replace(/['"`]\s*\+\s*['"`]/g, '')
      // The TTL is interpolated on both sides; the note reads the same
      // without it, and the empty-TTL case is what the web emits here.
      .replace(/\$\{validity\}/g, '');
    const fragments = [
      ...confidentialityNote('client').split('\n'),
      ...confidentialityNote('agent').split('\n'),
    ]
      .flatMap((line) => line.split(/(?<=[.,]) /))
      .map((f) => f.trim())
      .filter((f) => f.length > 24);

    expect(fragments.length).toBeGreaterThan(4);
    for (const fragment of fragments) {
      expect(source, `mobile is missing: ${fragment}`).toContain(fragment);
    }
  });

  it('reduces a gated listing to the same stub the web builder does', () => {
    const source = mobileSource('lib/share-message.ts');
    // Both must band the price and rebuild the title rather than pasting
    // the stored one — a share message is more forwardable than the page.
    expect(source).toContain("showcase_visibility === 'teaser'");
    expect(source).toContain('Guide price *${band}*');
    expect(source).toContain('teaserTitle(property)');
  });
});

describe('mobile/lib/owner-details-request.ts mirrors details-request', () => {
  // The seller reads this once and answers it once. If the two surfaces
  // ask for different papers, an owner messaged from the phone hands
  // over a different file than one messaged from the desktop — and the
  // agent has no way to tell which list they were given.
  const source = mobileSource('lib/owner-details-request.ts');

  it('asks for exactly the same items in every section, land or built', () => {
    for (const type of ['Residential Plot', 'Flat/ Apartment']) {
      for (const section of OWNER_DETAILS_SECTIONS) {
        for (const item of ownerDetailsSectionItems(section, type)) {
          expect(source, `mobile is missing: ${item}`).toContain(item);
        }
      }
    }
  });

  it('titles the sections the same way', () => {
    for (const section of OWNER_DETAILS_SECTIONS) {
      expect(source).toContain(`'${OWNER_DETAILS_SECTION_TITLES[section]}'`);
    }
  });

  // The promise and the opt-out are the same sentence. A mobile copy
  // that advertises different words hands the owner a command the
  // webhook will not honour.
  it('quotes the same digest commands', () => {
    expect(source).toContain(`'${DIGEST_PAUSE_COMMAND}'`);
    expect(source).toContain(`'${DIGEST_RESUME_COMMAND}'`);
  });

  // Everything else in the message is prose held in string literals, so
  // the copies are compared literal by literal rather than by sampling
  // one rendered body. The import path is the one line allowed to
  // differ — Metro cannot resolve the web alias.
  it('carries every literal the web module does', () => {
    // Comments are stripped first: the two headers deliberately differ,
    // and an apostrophe in prose reads as a quote to the extractor.
    const literals = (text: string) =>
      new Set(
        stringLiterals(text.replace(/^\s*(\/\/|\*|\/\*).*$/gm, '')).filter(
          (s) => !s.startsWith('@/')
        )
      );
    const web = literals(
      readFileSync(
        join(process.cwd(), 'src/lib/owners/details-request.ts'),
        'utf8'
      )
    );
    const mobile = literals(source);

    expect(web.size).toBeGreaterThan(30);
    for (const literal of web) {
      expect(mobile.has(literal), `mobile is missing: ${literal}`).toBe(true);
    }
  });

  it('renders a message the web builder would recognise', () => {
    const web = buildOwnerDetailsRequestMessage({
      ownerName: 'Mr Nadeem',
      propertyLabel: 'a corner site',
      propertyType: 'Residential Plot',
      agentName: 'Praneeth',
    });
    expect(web).toContain('*1. The property itself*');
    expect(web).not.toContain('What is built on it');
    expect(source).toContain(
      '*${i + 1}. ${OWNER_DETAILS_SECTION_TITLES[section]}*'
    );
  });
});

describe('mobile/lib/map-links.ts mirrors the pin resolver', () => {
  // The marker the app drops, the showcase iframe and the pin in the
  // WhatsApp reveal are all the same claim about where a property is.
  // Mobile ports this rather than importing it — `@shared/` is a
  // types-only alias, so a value import does not survive Metro — which
  // makes drift between the two copies the thing to guard.
  const source = mobileSource('lib/map-links.ts');
  const web = readFileSync(
    join(process.cwd(), 'src/lib/maps/map-links.ts'),
    'utf8'
  );

  it('resolves pins in the same order of truth', () => {
    for (const line of [
      'const linkCoordinates = link ? extractCoordinatesFromMapUrl(link) : null;',
      'linkCoordinates ?? toCoordinates(source.latitude ?? NaN, source.longitude ?? NaN);',
      'if (!linkCoordinates && link) {',
    ]) {
      expect(source).toContain(line);
      expect(web).toContain(line);
    }
  });

  it('builds the same link and embed URLs', () => {
    for (const literal of [
      '`https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`',
      '`https://maps.google.com/maps?q=${pair}&z=16&output=embed`',
    ]) {
      expect(source).toContain(literal);
      expect(web).toContain(literal);
    }
  });

  it('contains the decode that would otherwise throw on a bad escape', () => {
    expect(source).toContain('decodedPath = decodeURIComponent(');
    expect(source).toContain('decodedPath = null;');
  });
});

describe('mobile/lib/photo-sources.ts mirrors photo-sources', () => {
  // Both galleries have to find a gated listing's photos in the guarded
  // bucket, in the same order, at the same proxy index — the index IS
  // the identifier the route reads.
  const source = mobileSource('lib/photo-sources.ts');

  it('builds the same proxy path', () => {
    expect(source).toContain(
      '`/api/properties/${propertyId}/private-images/${index}`'
    );
  });

  it('orders public photos before guarded ones', () => {
    expect(source).toContain('[...pub, ...guarded]');
  });

  it('indexes guarded photos by their place in private_images', () => {
    expect(source).toContain('guardedPhotoPath(p.id, i)');
  });

  // An agent who sees "2 photos · confidential" on the desktop and a
  // bare tile on the phone has no way to tell which surface is lying
  // about the listing they are about to pitch.
  it('withholds photos with the same wording', () => {
    expect(source).toContain(
      "`${withheld} photo${withheld === 1 ? '' : 's'} · confidential`"
    );
    expect(source).toContain("'No photos uploaded'");
  });

  it('applies the same guard before labelling', () => {
    expect(source).toContain('internalPhotoCount(p) > 0 || withheld <= 0');
  });
});

describe('mobile/lib/gate-stats.ts mirrors gate-stats', () => {
  // The card summary is a number an agent acts on. "3 asked · 1 open"
  // on the phone and something else on the desktop would leave them not
  // knowing which to trust, so the wording is pinned rather than the
  // mere presence of a helper.
  const source = mobileSource('lib/gate-stats.ts');

  it('produces the same summary for the same counts', () => {
    const cases = [
      { requested: 3, pending: 1, approved: 2, rejected: 0, liveGrants: 2 },
      { requested: 4, pending: 0, approved: 4, rejected: 0, liveGrants: 0 },
      { requested: 0, pending: 0, approved: 0, rejected: 0, liveGrants: 2 },
    ];
    // The mobile port is text here; assert the literals it builds from
    // match what the web builder emits for the same input.
    for (const c of cases) {
      const web = gateSummary({ ...c, lastRequestedAt: null });
      if (!web) continue;
      for (const part of web.split(' · ')) {
        const unit = part.replace(/^\d+ /, '');
        expect(source, `mobile is missing the "${unit}" wording`).toContain(
          `${unit}\``
        );
      }
    }
  });

  it('keeps the same activity threshold', () => {
    expect(source).toContain('s.requested > 0 || s.liveGrants > 0');
  });

  it('joins the parts the same way', () => {
    expect(source).toContain("parts.join(' · ')");
  });

  // Both request drawers label a request from this one function. A
  // timed-out consent chain reading "Rejected" on one surface and "No
  // answer" on the other would report two different things about the
  // same row.
  it.each(['pending', 'approved', 'rejected', 'expired', 'anything-else'])(
    'labels %s the same way',
    (status) => {
      expect(source).toContain(`'${gateRequestStatusLabel(status)}'`);
    }
  );
});

describe('mobile/lib/rental-yield.ts mirrors rental-yield', () => {
  // A rental's price is its monthly rent, so the naive sum reads 1200%.
  // The two surfaces showing a different yield for the same listing is
  // the drift that produced PROP-1205 in the first place.
  const source = mobileSource('lib/rental-yield.ts');

  it.each([
    ['Sale', 30_000_000, 150_000],
    ['Rent', 1_548_000, 1_548_000],
    ['Built to Suit', 1_548_000, 1_548_000],
    ['JV/JD', 30_000_000, 150_000],
    [null, 13_500_000, 62_000],
  ] as const)('agrees on %s', (listingType, price, rentalIncome) => {
    // The mobile copy is text here, so the shape is asserted rather than
    // executed: same excluded types, same formula, same rounding.
    expect(rentalYieldPercent(listingType, price, rentalIncome)).toBe(
      listingType === 'Sale' || listingType === null
        ? Number((((rentalIncome * 12) / price) * 100).toFixed(2))
        : null
    );
  });

  it('excludes the same listing types', () => {
    for (const type of MONTHLY_PRICED_LISTING_TYPES) {
      expect(source).toContain(`'${type}'`);
    }
    expect(source).toContain("return value === 'Sale'");
  });

  it('uses the same formula and rounding', () => {
    expect(source).toContain('(((r * 12) / p) * 100).toFixed(2)');
  });
});

describe('mobile/lib/format.ts mirrors priceInWords', () => {
  // Both platforms put this readout under every price input, so a drift
  // here shows the same amount two different ways — "₹1.2 Crore" on the
  // web and something else in the app, for the same field.
  const source = mobileSource('lib/format.ts');
  const block = source.slice(
    source.indexOf('export function priceInWords'),
    source.indexOf('/** Indian price notation')
  );

  it('exists', () => {
    expect(block, 'priceInWords not found in mobile format.ts').toContain(
      'priceInWords'
    );
  });

  it('uses the same crore and lakh thresholds and wording', () => {
    expect(block).toContain('10000000');
    expect(block).toContain('Crore');
    expect(block).toContain('100000');
    expect(block).toContain('Lakhs');
    expect(block).toContain('en-IN');
  });

  it('trims trailing zeros the same way, so 12000000 is ₹1.2 Crore', () => {
    expect(block).toContain(
      `toFixed(2).replace(/\\.00$/, '').replace(/\\.(\\d)0$/, '.$1')`
    );
  });

  it('agrees with the web output across the range', () => {
    // The mobile copy is checked as text (the web tsconfig excludes
    // mobile/), so pin the web side's answers here: these are the strings
    // the assertions above are guarding.
    expect(priceInWords(160000000)).toBe('₹16 Crore');
    expect(priceInWords(12000000)).toBe('₹1.2 Crore');
    expect(priceInWords(8500000)).toBe('₹85 Lakhs');
    expect(priceInWords(45000)).toBe('₹45,000');
    expect(priceInWords('')).toBe('');
  });
});

describe('mobile/lib/budget-amount.ts mirrors the budget amount+unit split', () => {
  // Both surfaces store rupees but capture an amount against a unit. A
  // drift in the multipliers means "6 Crore" typed on one device is a
  // different number of rupees than on the other.
  const source = mobileSource('lib/budget-amount.ts');

  it('uses the same multipliers', () => {
    expect(source).toContain('rupee: 1');
    expect(source).toContain('lakh: 100000');
    expect(source).toContain('crore: 10000000');
  });

  it('offers the same units in the same order', () => {
    expect(stringLiterals(constBody(source, 'BUDGET_UNIT_OPTIONS'))).toEqual([
      'crore',
      'Crore',
      'lakh',
      'Lakh',
      'rupee',
      '\u20b9',
    ]);
  });

  it('agrees with the web conversion across the units', () => {
    expect(budgetToRupees('6', 'crore')).toBe(60000000);
    expect(budgetToRupees('45', 'lakh')).toBe(4500000);
    expect(budgetToRupees('40000', 'rupee')).toBe(40000);
    expect(rupeesToBudgetAmount(60000000)).toEqual({
      amount: '6',
      unit: 'crore',
    });
  });
});

describe('mobile/lib/money-ladder.ts mirrors the Contacts budget ladder', () => {
  // Both platforms filter by the same money bounds — contact budgets on
  // Contacts, asking price on Properties. A drift means the same row
  // falls inside the band on one device and outside it on the other.
  const source = mobileSource('lib/money-ladder.ts');

  it("offers exactly the web ladder's steps, in the same order", () => {
    const steps = constBody(source, 'BUDGET_STEPS')
      .replace(/[[\]\s]/g, '')
      .split(',')
      .filter(Boolean)
      .map(Number);
    expect(steps).toEqual(BUDGET_OPTIONS.map((o) => Number(o.value)));
  });
});

describe('mobile contact screen mirrors the property-interest vocabulary', () => {
  const source = mobileSource('app/(app)/contact/[id].tsx');

  it("offers exactly the web's in-app interest options, in the same order", () => {
    // Declared as a plain `const` inside the screen, so it is sliced here
    // rather than through constBody's `export const` lookup.
    const start = source.indexOf('const PROPERTY_INTEREST_OPTIONS');
    expect(start).toBeGreaterThan(-1);
    const open = source.indexOf('[', start);
    const end = source.indexOf('];', open);

    expect(stringLiterals(source.slice(open, end))).toEqual([
      ...PROPERTY_INTEREST_OPTIONS,
    ]);
  });
});

describe('property-interest vocabulary split', () => {
  it('keeps every Flow id inside the in-app option list', () => {
    // The Flow subset is what Meta renders; anything in it that the
    // in-app pickers do not offer would be unreachable for an agent.
    const inApp = new Set<string>(PROPERTY_INTEREST_OPTIONS);
    for (const id of PROPERTY_INTEREST_FLOW_IDS) {
      expect(inApp.has(id)).toBe(true);
    }
  });

  it("stays within Meta's 30-char CheckboxGroup item limit", () => {
    for (const id of PROPERTY_INTEREST_FLOW_IDS) {
      const title = PROPERTY_INTEREST_SHORT_TITLES[id] ?? id;
      expect(title.length).toBeLessThanOrEqual(30);
    }
  });

  it("stays within Meta's CheckboxGroup item count", () => {
    // The options arrive as dynamic data, so overshooting this shows up
    // in a buyer's WhatsApp client rather than at publish time. Fail
    // here instead. The in-app list is free to exceed it — that is the
    // whole reason the two lists are separate.
    expect(PROPERTY_INTEREST_FLOW_IDS.length).toBeLessThanOrEqual(
      FLOW_CHECKBOX_MAX_ITEMS
    );
    expect(PROPERTY_INTEREST_OPTIONS.length).toBeGreaterThan(
      FLOW_CHECKBOX_MAX_ITEMS
    );
  });
});

describe("mobile/lib/copilot-tours.ts mirrors the tour registry's mobileSteps", () => {
  // \u{...} escapes in the mobile source are resolved so emoji-carrying
  // bodies compare equal to the web registry's runtime strings.
  const source = mobileSource('lib/copilot-tours.ts').replace(
    /\\u\{([0-9a-fA-F]+)\}/g,
    (_, hex) => String.fromCodePoint(parseInt(hex, 16))
  );
  const mobileCapable = TOURS.filter((t) => t.mobileSteps?.length);

  it('carries every mobile-capable tour, and nothing else', () => {
    const ids = stringLiteralsInConst(source, 'MOBILE_TOURS').filter(
      (s) =>
        mobileCapable.some((t) => t.id === s) || TOURS.some((t) => t.id === s)
    );
    for (const tour of mobileCapable) {
      expect(ids, tour.id).toContain(tour.id);
    }
    for (const tour of TOURS.filter((t) => !t.mobileSteps?.length)) {
      expect(ids, `${tour.id} has no mobileSteps`).not.toContain(tour.id);
    }
  });

  it.each(mobileCapable.map((t) => [t.id, t] as const))(
    '%s keeps the web copy and step data',
    (_id, tour) => {
      expect(source).toContain(`title: '${tour.title.replace(/'/g, "\\'")}'`);
      expect(source).toContain(tour.description);
      for (const step of tour.mobileSteps!) {
        expect(source).toContain(`screen: '${step.screen}'`);
        expect(source).toContain(`target: '${step.target}'`);
        expect(source).toContain(step.body);
        expect(source).toContain(`advanceOn: '${step.advanceOn}'`);
      }
    }
  );
});

describe('mobile/lib/contact-interest.ts mirrors the web project axis', () => {
  // Both surfaces derive the project picker from the same function; a
  // divergence would make the two lists disagree on dedupe or order.
  function projectOptionsBody(source: string): string {
    const start = source.indexOf('export function projectOptions');
    expect(start).toBeGreaterThan(-1);
    const end = source.indexOf('\n}', start);
    return source.slice(start, end).replace(/\s+/g, ' ');
  }

  it('keeps projectOptions byte-equivalent to the web implementation', () => {
    const web = readFileSync(
      join(process.cwd(), 'src/lib/contacts/contact-interest.ts'),
      'utf8'
    );
    expect(projectOptionsBody(mobileSource('lib/contact-interest.ts'))).toBe(
      projectOptionsBody(web)
    );
  });
});

describe("mobile/lib/i18n.ts mirrors the web catalogue's copilot slice", () => {
  // Importing the module would make vitest transform a file governed by
  // mobile/tsconfig.json, which extends expo/tsconfig.base — absent
  // unless mobile deps are installed (the web CI job does not). The
  // catalogue is emitted with JSON.stringify, so its entry lines parse
  // back losslessly as JSON instead.
  const source = mobileSource('lib/i18n.ts');

  function parsedCatalogue(lang: string): Record<string, string> {
    const decl = `\n  ${lang}: {\n`;
    const start = source.indexOf(decl);
    expect(start, `no ${lang} catalogue in mobile i18n`).toBeGreaterThan(-1);
    const end = source.indexOf('\n  },', start);
    const body = source
      .slice(start + decl.length, end)
      .trim()
      .replace(/,$/, '');
    return JSON.parse(`{${body}}`) as Record<string, string>;
  }

  it('keeps every ported key byte-equal in every language', () => {
    const en = parsedCatalogue('en');
    expect(Object.keys(en).length).toBeGreaterThanOrEqual(20);
    for (const lang of Object.keys(MESSAGES)) {
      const catalogue = parsedCatalogue(lang);
      expect(Object.keys(catalogue).sort(), lang).toEqual(
        Object.keys(en).sort()
      );
      const web = MESSAGES[lang as keyof typeof MESSAGES] as Record<
        string,
        string
      >;
      for (const [key, value] of Object.entries(catalogue)) {
        expect(
          web[key],
          `${lang}/${key} missing from web catalogue`
        ).toBeDefined();
        expect(value, `${lang}/${key}`).toBe(web[key]);
      }
    }
  });
});

describe('the contact form offers the same buy-or-rent choices on both surfaces', () => {
  // The matcher gates hard on contacts.pref_listing_types, so a value
  // one surface can write and the other cannot read back — or a label
  // that means something different — silently hides half the inventory
  // from the contact.
  const mobile = mobileSource('app/(app)/contact/[id].tsx');
  const web = readFileSync(
    join(process.cwd(), 'src/components/contacts/contact-form.tsx'),
    'utf8'
  );

  it('writes the same vocabulary from both editors', () => {
    const mobileBlock = mobile.slice(
      mobile.indexOf('const LISTING_INTENT_OPTIONS'),
      mobile.indexOf('type UpdateChannelValue')
    );
    const mobileValues = Array.from(
      mobileBlock.matchAll(/value: \[([^\]]*)\]/g)
    ).map((m) => stringLiterals(m[1]).join(','));

    const webBlock = web.slice(
      web.indexOf('id="cf-listing-intent"'),
      web.indexOf('{/* Budget Fields */}')
    );
    const webValues = Array.from(webBlock.matchAll(/<option value="([^"]*)"/g))
      .map((m) => m[1])
      .filter(Boolean);

    expect(mobileValues).toEqual(['Sale', 'Rent', 'Sale,Rent']);
    expect(webValues).toEqual(mobileValues);
  });

  it('is persisted by the API both editors save through', () => {
    // The web form posts to these handlers, which destructure an
    // explicit field list — a field missing from it is dropped in
    // silence, and the selector becomes decoration.
    for (const route of [
      'src/app/api/contacts/route.ts',
      'src/app/api/contacts/[id]/route.ts',
    ]) {
      const handler = readFileSync(join(process.cwd(), route), 'utf8');
      expect(handler, route).toContain(
        'pref_listing_types: sanitizeListingTypes(pref_listing_types)'
      );
    }
  });

  it('is read back before the mobile editor can overwrite it', () => {
    // The mobile screen seeds its state from this projection and writes
    // the state back on save, so a column missing here is cleared by
    // any unrelated edit.
    expect(mobile).toMatch(/select\([\s\S]*?pref_listing_types/);
  });

  it('lets both surfaces clear the answer back to unstated', () => {
    // Unset must stay reachable: it is the honest value for a contact
    // nobody has asked, and the matcher treats it as "no gate".
    expect(web).toContain('<option value="">Not stated</option>');
    expect(mobile).toContain('setListingTypes(active ? [] : opt.value)');
  });
});

describe('mobile/lib/showcase-scope.ts mirrors the showcase share link', () => {
  // A shared catalog link is a promise about what the recipient will
  // open. If the phone spelled a param differently, or let a category
  // survive alongside a search, the same three taps would open two
  // different showcases on the two surfaces.
  const mobile = mobileSource('lib/showcase-scope.ts');

  const cases = [
    { scope: 'all' as const, category: 'Commercial' as const },
    {
      scope: 'search' as const,
      category: 'Commercial' as const,
      search: 'hsr',
    },
    { scope: 'pick' as const, ids: ['CR-1', 'CR-2'] },
  ];

  it('builds the same query for the same choices', () => {
    for (const c of cases) {
      const url = new URL(
        buildShowcaseShareLink({
          baseUrl: 'https://acme.convoreal.com',
          includeRef: false,
          audience: 'client',
          ...c,
        })
      );
      for (const key of url.searchParams.keys()) {
        expect(mobile, `mobile is missing the "${key}" param`).toContain(
          `'${key}'`
        );
      }
    }
  });

  it('keeps one scope exclusive of the others', () => {
    // Web: search wins over pick wins over category, as one if/else.
    const searchLink = buildShowcaseShareLink({
      baseUrl: 'https://acme.convoreal.com',
      includeRef: false,
      audience: 'client',
      scope: 'search',
      category: 'Commercial',
      search: 'hsr',
    });
    expect(searchLink).not.toContain('category=');
    expect(mobile).toContain("if (scope === 'search')");
    expect(mobile).toContain("} else if (scope === 'pick')");
    expect(mobile).toContain("} else if (category !== 'All')");
  });

  it('marks a co-broker link and a named visitor the same way', () => {
    const link = buildShowcaseShareLink({
      baseUrl: 'https://acme.convoreal.com',
      includeRef: false,
      audience: 'agent',
      scope: 'all',
      visitorId: 'contact-9',
    });
    expect(link).toContain('mode=view');
    expect(link).toContain('v=contact-9');
    expect(mobile).toContain("withParam(url, 'mode', 'view')");
    expect(mobile).toContain("withParam(url, 'v', visitorId)");
  });
});

describe('mobile/lib/deal-workspace.ts mirrors the invoicing vocabulary', () => {
  // An invoice is a legal record, so the two surfaces must not disagree
  // about what a status is called or which categories a document can be
  // filed under — a "Paid" chip on one and "Settled" on the other is a
  // support call about whether the money arrived.
  const mobile = mobileSource('lib/deal-workspace.ts');

  it('offers the same document categories, in the same order', () => {
    for (const { value, label } of DEAL_DOCUMENT_CATEGORIES) {
      expect(mobile, `mobile is missing the "${value}" category`).toContain(
        `{ value: '${value}', label: '${label}' }`
      );
    }
    const order = DEAL_DOCUMENT_CATEGORIES.map((c) =>
      mobile.indexOf(`value: '${c.value}'`)
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  // [INV-007] A file the folder takes on one surface must not be refused
  // on the other: the picker filters by this list before the upload is
  // even attempted, so a drifted copy reads as "that file is invalid".
  it('accepts the same file types as the web folder', () => {
    for (const mime of DEAL_DOCUMENT_MIME_TYPES) {
      expect(mobile, `mobile is missing the "${mime}" type`).toContain(
        `'${mime}'`
      );
    }
  });

  it('labels every invoice status identically', () => {
    for (const [status, label] of Object.entries(INVOICE_STATUS_LABELS)) {
      expect(mobile, `mobile is missing the "${status}" label`).toContain(
        `${status}: '${label}'`
      );
    }
  });

  it('agrees on which files the extractor can read', () => {
    // The web panel hides the button for anything else and the API
    // refuses it; the phone must not offer what the server will reject.
    for (const type of [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
    ]) {
      expect(mobile).toContain(`'${type}'`);
    }
    expect(mobile).not.toContain("'image/heic',\n    'application/pdf'");
  });

  it('never names a field that could carry a full Aadhaar number', () => {
    // [INV-006] The server strips it; the phone must not reintroduce a
    // place to put one.
    expect(mobile).toContain('aadhaar_last4');
    expect(mobile).not.toMatch(/aadhaar_number|full_aadhaar/);
  });

  it('can review a draft before issuing it', () => {
    // An invoice is immutable once issued, so a surface that offers
    // Issue without an editor can only turn an imperfect prefill into
    // an incorrect legal document. Mobile used to point at the web app.
    const screen = mobileSource('app/(app)/deal/[id].tsx');
    const editor = mobileSource('components/invoice-editor-sheet.tsx');

    expect(screen).toContain('InvoiceEditorSheet');
    expect(screen).toContain('label="Review"');
    expect(screen).not.toContain('Review it on the web app');

    // Every field the web editor exposes has to be reachable here too.
    for (const field of [
      'invoice_date',
      'side',
      'share_percent',
      'bill_to',
      'line_items',
      'notes',
    ]) {
      expect(editor, `mobile cannot edit ${field}`).toContain(field);
    }
  });

  it('edits through the shared API rather than its own rules', () => {
    const api = mobileSource('lib/deal-workspace-api.ts');
    expect(api).toContain('`/api/invoices/${invoiceId}`');
    expect(api).toContain("method: 'PATCH'");
  });

  it('computes no invoice money of its own', () => {
    // [INV-004] Every figure comes from the API. A local calculation
    // here is how the two surfaces start quoting different brokerage.
    expect(mobile).not.toMatch(/grand_total\s*=/);
    expect(mobile).not.toMatch(/taxable_total\s*=/);
    expect(mobile).not.toMatch(/\*\s*0\.0\d/);
  });
});

describe('the mobile deals screen uses the shared brokerage rule', () => {
  // The screen used to fall back to a flat 2% of the deal value, so its
  // stage totals disagreed with the invoice raised off the same deal.
  const mobile = mobileSource('app/(app)/deals.tsx');

  it('no longer guesses a flat 2%', () => {
    expect(mobile).not.toContain('* 0.02');
  });

  it('mirrors brokerageAmount: fixed wins, otherwise a percentage', () => {
    expect(mobile).toContain("deal.brokerage_type === 'fixed'");
    expect(mobile).toContain('(Number(deal.value ?? 0) * value) / 100');

    // Same inputs, same answer on both surfaces.
    expect(
      brokerageAmount({
        dealValue: 162000000,
        type: 'percentage',
        value: 0.7,
      })
    ).toBe(1134000);
  });
});

describe('[PRP-007] property enquiries remain actionable on web and mobile', () => {
  const web = readFileSync(
    join(process.cwd(), 'src/components/inventory/property-form.tsx'),
    'utf8'
  );
  const mobile = mobileSource('app/(app)/property/[id].tsx');

  it('shows explicit enquiries separately from preference matches', () => {
    for (const source of [web, mobile]) {
      expect(source).toContain('Enquired Contacts');
      expect(source).toContain('enquiredAudienceContacts');
      expect(source).toContain('Matching Contacts');
    }
  });

  it('keeps contact, call, message and follow-up actions on both surfaces', () => {
    for (const label of ['View contact', 'Call', 'Message', 'Follow up']) {
      expect(web, `web lacks ${label}`).toContain(label);
      expect(mobile, `mobile lacks ${label}`).toContain(label);
    }
    expect(mobile).toContain('eventType=follow_up');
    expect(web).toContain('ScheduleDialog');
    expect(mobile).toContain('dialableAudiencePhone');
    expect(web).toContain('dialableAudiencePhone');
    expect(mobile).toContain('onLongPress');
    expect(mobile).toContain('PropertyInterestFollowUpSheet');
    expect(web).toContain('PropertyInterestFollowUpDialog');
  });
});

describe('[PRP-008] suggested portal mappings are confirmable on both surfaces', () => {
  const web = webSource('components/contacts/unmapped-portal-ads.tsx');
  const mobile = mobileSource('components/unmapped-portal-ads.tsx');

  it('accepts the guessed property directly and keeps a change path', () => {
    for (const source of [web, mobile]) {
      expect(source).toContain('ad.guessedPropertyId');
      expect(source).toContain('mapAd(ad, ad.guessedPropertyId!)');
      expect(source).toContain('Accept');
      expect(source).toContain('Change');
    }
  });
});

describe('[TXW] the Transaction Workspace ships on both surfaces', () => {
  const mobileVocab = mobileSource('lib/deal-workspace.ts');
  const mobileApi = mobileSource('lib/deal-workspace-api.ts');
  const mobileScreen = mobileSource('app/(app)/deal/[id].tsx');
  const mobileJourney = mobileSource('app/(app)/journey.tsx');
  const webWorkspace = webSource('components/deals/deal-workspace.tsx');
  const webJourneySheet = webSource(
    'components/journey/journey-item-sheet.tsx'
  );

  it('offers the same tabs, in the same order', () => {
    for (const tab of DEAL_WORKSPACE_TABS) {
      expect(mobileVocab, `mobile is missing the "${tab.id}" tab`).toContain(
        `{ id: '${tab.id}', label: '${tab.label}' }`
      );
    }
    const order = DEAL_WORKSPACE_TABS.map((t) =>
      mobileVocab.indexOf(`id: '${t.id}'`)
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(webWorkspace).toContain('DEAL_WORKSPACE_TABS');
  });

  it('[TXW-003] labels every milestone status identically', () => {
    for (const [status, label] of Object.entries(
      DEAL_MILESTONE_STATUS_LABELS
    )) {
      expect(
        mobileVocab,
        `mobile is missing the "${status}" milestone label`
      ).toContain(`${status}: '${label}'`);
    }
  });

  it('[TXW-007] labels every document status identically and keeps them forward-only', () => {
    for (const [status, label] of Object.entries(DEAL_DOCUMENT_STATUS_LABELS)) {
      expect(
        mobileVocab,
        `mobile is missing the "${status}" document label`
      ).toContain(`${status}: '${label}'`);
    }
    expect(mobileVocab).toContain(
      "const DOCUMENT_STATUS_ORDER: DealDocumentStatus[] = [\n  'draft',\n  'reviewed',\n  'approved',\n  'executed',\n];"
    );
    expect(mobileVocab).toMatch(
      /return doc\.status !== 'approved' && doc\.status !== 'executed';/
    );
    expect(mobileScreen).toContain('canDeleteDocument(doc)');
    expect(mobileScreen).toContain('superseded_by');
    expect(mobileScreen).toContain('expires_at');
  });

  it('[TXW-002] labels every timeline event identically and never edits one', () => {
    for (const [type, label] of Object.entries(DEAL_EVENT_LABELS)) {
      expect(
        mobileVocab,
        `mobile is missing the "${type}" event label`
      ).toContain(`${type}: '${label}'`);
    }
    expect(mobileApi).toContain('`/api/deals/${dealId}/events`');
    expect(mobileApi).not.toMatch(
      /events\/\$\{[^}]*\}`,\s*\{\s*method: '(PATCH|PUT|DELETE)'/
    );
  });

  it('[TXW-004] names the same TDS states and computes no money of its own', () => {
    for (const [status, label] of Object.entries(TDS_STATUS_LABELS)) {
      expect(
        mobileVocab,
        `mobile is missing the "${status}" TDS label`
      ).toContain(`${status}: '${label}'`);
    }
    expect(mobileApi).toContain('`/api/deals/${dealId}/financials`');
    expect(mobileVocab).not.toMatch(/agreed_consideration\s*[-+*/]/);
  });

  it('[TXW-006] hides the token fields when Token Safe owns them', () => {
    expect(mobileVocab).toContain(
      "tokenSource === 'token_safe' && key.startsWith('token_')"
    );
    expect(mobileScreen).toContain("data.token_source === 'token_safe'");
  });

  it('[TXW-001] converts a journey through the same route on both surfaces', () => {
    expect(webJourneySheet).toContain("'/api/journey/convert-to-deal'");
    expect(mobileApi).toContain("'/api/journey/convert-to-deal'");
    expect(mobileJourney).toContain('convertJourneyItemToDeal');
    expect(mobileJourney).toContain('Convert to deal');
    expect(webJourneySheet).toContain('Convert to deal');
  });

  it('links deal tasks through the same to-do routes', () => {
    expect(mobileApi).toContain(
      '`/api/todos?deal_id=${encodeURIComponent(dealId)}`'
    );
    expect(webSource('components/deals/deal-tasks-panel.tsx')).toContain(
      '`/api/todos?deal_id=${encodeURIComponent(dealId)}`'
    );
  });
});

describe('[TXW] Phase 2 collaboration ships on both surfaces', () => {
  const mobileVocab = mobileSource('lib/deal-workspace.ts');
  const mobileApi = mobileSource('lib/deal-workspace-api.ts');
  const mobileScreen = mobileSource('app/(app)/deal/[id].tsx');
  const webPanel = webSource('components/deals/deal-stakeholders-panel.tsx');

  it('[TXW-012] labels every visibility identically and offers it on notes, milestones and documents', () => {
    for (const [v, label] of Object.entries(DEAL_VISIBILITY_LABELS)) {
      expect(
        mobileVocab,
        `mobile is missing the "${v}" visibility label`
      ).toContain(`${v}: '${label}'`);
    }
    expect(mobileScreen).toContain('VisibilityChips');
    expect(mobileScreen).toContain('setDealMilestoneVisibility');
    expect(mobileScreen).toContain('setDealDocumentVisibility');
    expect(webSource('components/deals/deal-timeline-panel.tsx')).toContain(
      'DEAL_VISIBILITIES'
    );
    expect(webSource('components/deals/deal-milestones-panel.tsx')).toContain(
      'DEAL_VISIBILITIES'
    );
    expect(webSource('components/deals/deal-documents-panel.tsx')).toContain(
      'DEAL_VISIBILITIES'
    );
  });

  it('[TXW-009] names the same stakeholder roles and sides, with the same default side', () => {
    for (const [role, label] of Object.entries(STAKEHOLDER_ROLE_LABELS)) {
      expect(mobileVocab, `mobile is missing the "${role}" role`).toContain(
        `${role}: '${label}'`
      );
    }
    for (const [side, label] of Object.entries(STAKEHOLDER_SIDE_LABELS)) {
      expect(mobileVocab, `mobile is missing the "${side}" side`).toContain(
        `${side}: '${label}'`
      );
    }
    expect(mobileVocab).toMatch(
      /case 'seller':\s+return 'seller';\s+case 'broker':\s+return 'internal';\s+default:\s+return 'buyer';/
    );
    for (const role of Object.keys(
      STAKEHOLDER_ROLE_LABELS
    ) as StakeholderRole[]) {
      expect(['buyer', 'seller', 'internal']).toContain(
        defaultSideForRole(role)
      );
    }
  });

  it('[TXW-009] mints links with the same expiry choices and never shows the token twice', () => {
    for (const choice of DEAL_SHARE_TTL_CHOICES) {
      expect(mobileVocab).toContain(
        `{ key: '${choice.key}', label: '${choice.label}' }`
      );
    }
    expect(mobileApi).toContain('`/api/deals/${dealId}/share-links`');
    expect(mobileApi).toContain(
      '`/api/deals/${dealId}/share-links/${linkId}?source=mobile`'
    );
    expect(webPanel).toContain(
      "'/share-links'".length > 0 ? '/share-links' : ''
    );
    expect(webPanel).toContain('It will not be shown again');
    expect(mobileScreen).toContain('it will not be shown again');
  });

  it('[TXW-009] shows the per-link access log with the same labels', () => {
    for (const [event, label] of Object.entries(SHARE_ACCESS_LABELS)) {
      expect(
        mobileVocab,
        `mobile is missing the "${event}" access label`
      ).toContain(`${event}: '${label}'`);
    }
    expect(mobileScreen).toContain('fetchDealShareAccess(dealId, link.id)');
    expect(webPanel).toContain('SHARE_ACCESS_LABELS');
  });

  it('[TXW-011] hands the link over through the share sheet or wa.me, never by sending itself', () => {
    expect(mobileScreen).toContain('Share.share({ message })');
    expect(mobileScreen).not.toMatch(/\/api\/whatsapp\/send/);
    expect(webPanel).toContain('https://wa.me/');
    expect(webPanel).not.toMatch(/\/api\/whatsapp\/send/);
  });
});

describe('[TXW] Phase 3 publishing ships on both surfaces', () => {
  const mobileVocab = mobileSource('lib/deal-workspace.ts');
  const mobileApi = mobileSource('lib/deal-workspace-api.ts');
  const mobileScreen = mobileSource('app/(app)/deal/[id].tsx');
  const webPanel = webSource('components/deals/deal-updates-panel.tsx');

  it('[TXW-014] names every channel and delivery stage identically', () => {
    for (const [channel, label] of Object.entries(UPDATE_CHANNEL_LABELS)) {
      expect(
        mobileVocab,
        `mobile is missing the "${channel}" channel`
      ).toContain(`${channel}: '${label}'`);
    }
    for (const [stage, label] of Object.entries(UPDATE_STAGE_LABELS)) {
      expect(mobileVocab, `mobile is missing the "${stage}" stage`).toContain(
        `${stage}: '${label}'`
      );
    }
    expect(mobileVocab).toMatch(
      /if \(r\.acknowledged_at\) return 'acknowledged';\s+if \(r\.opened_at\) return 'opened';\s+if \(r\.status === 'failed'\) return 'failed';\s+if \(r\.status === 'sent'\) return 'sent';\s+return 'pending';/
    );
  });

  it('[TXW-013] composes over the same routes and quotes only what the audience may see', () => {
    expect(mobileApi).toContain('`/api/deals/${dealId}/updates`');
    expect(mobileApi).toContain('`/api/deals/${dealId}/updates/preview`');
    expect(mobileApi).toContain(
      '`/api/deals/${dealId}/updates/${updateId}/recipients/${recipientId}`'
    );
    expect(mobileScreen).toContain(
      'snapshotItemAllowed(visibility, m.visibility)'
    );
    expect(webPanel).toContain('snapshotItemAllowed(visibility, m.visibility)');
    expect(mobileScreen).toContain(
      'snapshotItemAllowed(visibility, e.visibility)'
    );
    expect(webPanel).toContain('snapshotItemAllowed(visibility, e.visibility)');
    expect(mobileScreen).toContain(
      'supersedes_update_id: supersedes?.id ?? null'
    );
    expect(webPanel).toContain('supersedes_update_id: supersedes?.id ?? null');
    expect(mobileVocab).toMatch(
      /if \(item === 'internal'\) return false;\s+if \(item === 'all_stakeholders'\) return true;\s+return update === item;/
    );
  });

  it('[TXW-014] hands personal WhatsApp over through the share sheet or wa.me, never by sending itself', () => {
    expect(mobileScreen).toContain('Share.share({ message })');
    expect(mobileScreen).toContain('markUpdateRecipientSent');
    expect(webPanel).toContain('handoff_url');
    expect(webPanel).toContain('Mark as sent');
    expect(webPanel).not.toMatch(/\/api\/whatsapp\/send/);
    expect(mobileScreen).not.toMatch(/\/api\/whatsapp\/send/);
  });
});

describe('[TXW-016] the transaction index reads the same on both surfaces', () => {
  const mobileVocab = mobileSource('lib/deal-workspace.ts');
  const mobileApi = mobileSource('lib/deal-workspace-api.ts');
  const mobileList = mobileSource('app/(app)/deals.tsx');
  const mobileScreen = mobileSource('app/(app)/deal/[id].tsx');
  const webIndex = webSource(
    'components/deals/transaction-workspace-index.tsx'
  );
  const webWorkspace = webSource('components/deals/deal-workspace.tsx');

  it('mirrors the headline, subtitle and closing-record rules', () => {
    for (const line of [
      'if (unit) return `Property No. ${unit}`;',
      'if (who && what) return `${who} — ${what}`;',
      'return who ?? what ?? row.title;',
      'if (headline.toLowerCase().includes(title.toLowerCase())) return null;',
      'return row.source_journey_item_id !== null || row.milestones_total > 0;',
    ]) {
      expect(mobileVocab, `mobile drifted at: ${line}`).toContain(line);
    }

    const row = {
      title: 'Kundanlala — 3BHK near Whitefield',
      contact_name: 'Kundanlala',
      property_title: 'Sky Tower',
      property_unit_no: '12B',
    };
    expect(transactionTitle(row)).toBe('Kundanlala — Property No. 12B');
    expect(transactionSubtitle(row)).toBe(row.title);
    expect(
      isClosingRecord({ source_journey_item_id: null, milestones_total: 0 })
    ).toBe(false);
  });

  it('titles rows by buyer and property and lists only closing records', () => {
    for (const source of [webIndex, mobileList]) {
      expect(source).toContain('transactionTitle(');
      expect(source).toContain('transactionSubtitle(');
      expect(source).toContain('.filter(isClosingRecord)');
    }
  });

  it('starts the closing record at the capture stage through the deal route on every surface', () => {
    const mobileSemantics = mobileSource('lib/stage-semantics.ts');
    const webSemantics = webSource('lib/pipelines/stage-semantics.ts');
    for (const source of [webSemantics, mobileSemantics]) {
      expect(source).toContain(
        "shouldCaptureBrokerage(stageName) &&\n    dealStatusForStage(stageName) !== 'lost'"
      );
    }
    const dealRoute = webSource('app/api/deals/[id]/route.ts');
    expect(dealRoute).toContain('ensureClosingRecord({');
    expect(dealRoute).toContain('await applyDealStageMove(ctx, {');
    expect(webSource('lib/deals/stage-move.ts')).toContain(
      'ensureClosingRecord({'
    );
    expect(
      webSource('app/(dashboard)/pipelines/pipelines-content.tsx')
    ).toContain('`/api/deals/${dealId}`');
    expect(
      webSource('app/(dashboard)/pipelines/pipelines-content.tsx')
    ).not.toContain(".from('deals')\n        .update({ stage_id");
    expect(mobileList).toContain('await moveDealStage(deal.id, {');
    expect(mobileList).not.toContain(
      ".from('deals')\n      .update({ stage_id"
    );
  });

  it('labels the buyer as the index SQL does: full name, never the phone', () => {
    expect(mobileList).toContain(
      'contact:contacts(id, name, second_name, phone)'
    );
    expect(mobileList).toContain('contactFullName(deal.contact)');
    expect(mobileList).not.toContain('deal.contact?.phone || null');
  });

  it('pauses a workspace move for brokerage exactly as the board does', () => {
    const mobileSemantics = mobileSource('lib/stage-semantics.ts');
    expect(mobileSemantics).toContain(
      'return deal.brokerage_amount === null && shouldCaptureBrokerage(stageName);'
    );
    for (const source of [webWorkspace, mobileScreen, mobileList]) {
      expect(source).toContain('needsBrokerageCapture(');
      expect(source).toContain('brokerage_type: brokerageType');
      expect(source).toContain('brokerage_value: Number(brokerageValue)');
    }
  });

  it('moves the pipeline stage from the workspace header through the deal PATCH', () => {
    expect(webWorkspace).toContain('dealStatusForStage(stage.name)');
    expect(webWorkspace).toContain('target_stage_id: stage.id');
    expect(webWorkspace).toContain('current_stage_name: stage.name');
    expect(mobileScreen).toContain('dealStatusForStage(stage.name)');
    expect(mobileScreen).toContain('target_stage_id: stage.id');
    expect(mobileScreen).toContain('current_stage_name: stage.name');
    expect(mobileApi).toContain('`/api/deals/${dealId}`');
    expect(mobileApi).toContain("method: 'PATCH'");
  });
});

describe('[TXW-017] Deals is one surface with a board, journeys and records on both surfaces', () => {
  const webDeals = webSource('app/(dashboard)/deals/deals-content.tsx');
  const webSidebar = webSource('components/layout/sidebar.tsx');
  const mobileList = mobileSource('app/(app)/deals.tsx');
  const mobileMenu = mobileSource('lib/menu.ts');
  const mobileIntent = mobileSource('app/+native-intent.ts');

  it('offers the same three views', () => {
    for (const view of ['board', 'journey', 'records']) {
      expect(webDeals).toContain(`view === '${view}'`);
    }
    expect(mobileList).toContain("segment === 'records'");
    expect(mobileList).toContain("segment === 'journey' ? <JourneyBody />");
    expect(mobileList).toContain("'transaction_workspace_index'");
    expect(mobileSource('app.json')).toContain('"pathPrefix": "/deals"');
    expect(
      webSource('app/.well-known/apple-app-site-association/route.ts')
    ).toContain("'/deals'");
  });

  it('retires the separate Journey entry and keeps the old links landing', () => {
    expect(webSidebar).not.toContain('href: "/journey"');
    expect(webSidebar).toContain('href: "/deals"');
    expect(mobileMenu).toContain("label: 'Deals: journeys'");
    expect(mobileIntent).toContain("q.get('view') === 'journey'");
  });
});

describe('[TXW-018] journey stages mirror the pipeline on every surface', () => {
  const migration = readFileSync(
    join(
      process.cwd(),
      'supabase/migrations/20260919120000_journey_stages_mirror_pipeline.sql'
    ),
    'utf8'
  );
  const webSemantics = webSource('lib/pipelines/stage-semantics.ts');
  const mobileSemantics = mobileSource('lib/stage-semantics.ts');

  it('derives the journey kind from the same stage words in SQL and TypeScript', () => {
    for (const word of ['lost', 'won', 'registered', 'brokerage']) {
      expect(migration).toContain(`'%${word}%'`);
      expect(webSemantics).toContain(`'${word}'`);
    }
    for (const word of ['negotiation', 'token', 'due diligence', 'contract']) {
      expect(migration).toContain(`'%${word}%'`);
      expect(webSemantics).toContain(`'${word}'`);
    }
    expect(mobileSemantics).toContain(
      'export function journeyStageKindForPipelineStage('
    );
    expect(mobileSemantics).toContain(
      "if (outcome === 'successful') return 'won';"
    );
  });

  it('reads mirrored stages through the one sync function on web and mobile', () => {
    expect(webSource('lib/journey/capture.ts')).toContain(
      '"sync_journey_stages_from_pipeline"'
    );
    expect(mobileSource('app/(app)/journey.tsx')).toContain(
      "'sync_journey_stages_from_pipeline'"
    );
    expect(
      webSource('app/(dashboard)/pipelines/pipelines-content.tsx')
    ).toContain("'sync_journey_stages_from_pipeline'");
    expect(
      existsSync(
        join(process.cwd(), 'src/components/journey/stage-editor-dialog.tsx')
      )
    ).toBe(false);
  });

  it('keeps a converted deal and its journey item on one stage from either side', () => {
    expect(migration).toContain('AFTER UPDATE OF stage_id ON journey_items');
    expect(migration).toContain('AFTER UPDATE OF stage_id ON deals');
    expect(migration).toContain('pg_trigger_depth() > 1');
  });

  it('moves a journey item through one move function that runs the board stage-move logic', () => {
    const move = webSource('lib/journey/move.ts');
    expect(move).toContain(
      "target.stage_kind === 'closing' || target.stage_kind === 'won'"
    );
    expect(move).toContain('needsBrokerageCapture(');
    expect(move).toContain('await prepareDealStageMove(ctx, dealMove)');
    expect(move).toContain('await convertJourneyItemToDeal(ctx, {');
    expect(move).toContain('stageId: target.pipeline_stage_id');
    expect(move).toContain('deal.pipeline_id === targetPipelineId');
    expect(webSource('app/api/journey/move/route.ts')).toContain(
      'await moveJourneyItem(ctx, {'
    );
    expect(webSource('lib/journey/closing-nudges.ts')).toContain(
      'await moveJourneyItem('
    );
    expect(webSource('lib/journey/closing-nudges.ts')).not.toContain(
      ".from('journey_items')\n      .update({\n        stage_id"
    );
    expect(webSource('app/api/journey/convert-to-deal/route.ts')).toContain(
      'await convertJourneyItemToDeal(ctx, parsed.value)'
    );
    expect(
      readFileSync(
        join(
          process.cwd(),
          'supabase/migrations/20260919120050_journey_deal_sync_same_pipeline.sql'
        ),
        'utf8'
      )
    ).toContain('AND pipeline_id = v_pipeline');
    const sameAccount = readFileSync(
      join(
        process.cwd(),
        'supabase/migrations/20260919120050_journey_deal_sync_same_pipeline.sql'
      ),
      'utf8'
    );
    expect(
      sameAccount.match(
        /WHERE id = NEW\.source_journey_item_id AND account_id = NEW\.account_id;/g
      )?.length
    ).toBe(2);
    expect(sameAccount).toContain(
      'IF p_pipeline_id IS NOT NULL AND p_pipeline_id <> v_pipeline THEN'
    );
    const stageMove = webSource('lib/deals/stage-move.ts');
    expect(stageMove.match(/\.eq\('account_id', accountId\)/g)?.length).toBe(3);
    expect(
      stageMove.match(/\.eq\('account_id', ctx\.accountId\)/g)?.length
    ).toBe(1);
    expect(sameAccount).toContain(
      "PERFORM pg_advisory_xact_lock(hashtext('ensure_default_pipeline'), hashtext(p_account_id::text));"
    );
    expect(sameAccount).toContain(
      'IF NOT EXISTS (SELECT 1 FROM pipeline_stages WHERE pipeline_id = v_id) THEN'
    );
    const moveSource = webSource('lib/journey/move.ts');
    const itemUpdate = moveSource.indexOf(
      ".from('journey_items')\n    .update({"
    );
    expect(itemUpdate).toBeGreaterThan(0);
    expect(
      moveSource.indexOf('await prepareDealStageMove(ctx, dealMove)')
    ).toBeLessThan(itemUpdate);
    expect(moveSource).not.toContain('applyDealStageMove(');
    expect(moveSource.indexOf('await writeJourneyEvent({')).toBeGreaterThan(
      itemUpdate
    );
    const stageMoveSource = webSource('lib/deals/stage-move.ts');
    expect(
      stageMoveSource.indexOf(
        'const prepared = await prepareDealStageMove(ctx, input);'
      )
    ).toBeLessThan(
      stageMoveSource.indexOf('updateData.stage_id = input.targetStageId')
    );
    expect(
      readFileSync(
        join(
          process.cwd(),
          'supabase/migrations/20260919120100_journey_stages_backfill.sql'
        ),
        'utf8'
      )
    ).toContain('AND fps.pipeline_id <> v_pipeline;');
    expect(
      moveSource.indexOf('await convertJourneyItemToDeal(ctx, {')
    ).toBeLessThan(itemUpdate);
    expect(moveSource).toMatch(
      /if \(openedDealId\) \{\s+const \{ data: removed \} = await supabase\s+\.from\('deals'\)\s+\.delete\(\)/
    );
    expect(
      webSource('app/(dashboard)/pipelines/pipelines-content.tsx')
    ).not.toContain('p_pipeline_id: pipeline.id');
  });

  it('reads only mirrored stages wherever a next stage is chosen, and leaves no orphan behind', () => {
    for (const file of [
      'lib/journey/client-response.ts',
      'lib/journey/closing-nudges.ts',
      'lib/journey/past-enquiry.ts',
      'lib/focus/queries.ts',
      'lib/journey/capture.ts',
    ]) {
      const source = webSource(file);
      const reads = source.match(
        /\.from\(['"]journey_stages['"]\)\n\s+\.select\([^)]*\)\n(\s+\.(eq|in)\([^)]*\)\n)*\s+\.(not\('pipeline_stage_id', 'is', null\)|not\("pipeline_stage_id", "is", null\))/g
      );
      const lists = source.match(
        /\.from\(['"]journey_stages['"]\)\n\s+\.select\([^)]*\)\n(\s+\.(eq|in)\([^)]*\)\n)*\s+\.order\(/g
      );
      expect(
        reads?.length ?? 0,
        `${file} lists unlinked stages`
      ).toBeGreaterThanOrEqual(lists?.length ?? 0);
    }
    expect(mobileSource('lib/today.ts')).toContain(
      ".in('stage_kind', PAST_ENQUIRY_STAGE_KINDS)\n    .not('pipeline_stage_id', 'is', null);"
    );
    const backfill = readFileSync(
      join(
        process.cwd(),
        'supabase/migrations/20260919120100_journey_stages_backfill.sql'
      ),
      'utf8'
    );
    expect(backfill).not.toContain('journey_stage_notes');
    expect(backfill.match(/AND ji\.account_id = acc\.id/g)?.length).toBe(2);
    expect(
      readFileSync(
        join(
          process.cwd(),
          'supabase/migrations/20260919120200_pipeline_stage_delete_guard.sql'
        ),
        'utf8'
      )
    ).toContain('DELETE FROM journey_stages WHERE id = v_js;');
  });

  it('offers the same move and brokerage prompt on web and mobile', () => {
    const section = webSource('components/journey/journey-section.tsx');
    expect(section).toContain("fetch('/api/journey/move'");
    expect(section).not.toContain("fetch('/api/journey/convert-to-deal'");
    expect(section).not.toContain(
      ".from('journey_items')\n        .update({\n          stage_id"
    );
    expect(section).toContain("json?.code === 'BROKERAGE_REQUIRED'");
    expect(section).toContain('brokerage_type: brokerageType');
    expect(section).toContain('brokerage_value: Number(brokerageValue)');
    expect(mobileSource('lib/deal-workspace-api.ts')).toContain(
      "'/api/journey/move'"
    );
    const mobileJourney = mobileSource('app/(app)/journey.tsx');
    expect(mobileJourney).toContain(
      'await moveJourneyItem(item.id, stage.id, brokerage);'
    );
    expect(mobileJourney).toContain("err.code === 'BROKERAGE_REQUIRED'");
    expect(mobileJourney).toContain('brokerage_type: brokerageType');
    expect(mobileJourney).toContain('brokerage_value: Number(brokerageValue)');
    expect(mobileJourney).toContain('accessibilityLabel="Move to stage"');
  });

  it('refuses to delete a pipeline stage while journey items sit on its mirror', () => {
    const guard = readFileSync(
      join(
        process.cwd(),
        'supabase/migrations/20260919120200_pipeline_stage_delete_guard.sql'
      ),
      'utf8'
    );
    expect(guard).toContain('BEFORE DELETE ON pipeline_stages');
    expect(guard).toContain('WHERE stage_id = v_js OR planned_stage_id = v_js');
    expect(migration).toContain(
      'REFERENCES pipeline_stages(id) ON DELETE SET NULL'
    );
    const settings = webSource('components/pipelines/pipeline-settings.tsx');
    expect(settings).toContain('.from("journey_items")');
    expect(settings).toContain('"Move journey items out of this stage first"');
    const backfill = readFileSync(
      join(
        process.cwd(),
        'supabase/migrations/20260919120100_journey_stages_backfill.sql'
      ),
      'utf8'
    );
    expect(backfill).toContain(
      'WHERE account_id = acc.id AND pipeline_stage_id IS NOT NULL\n    ) THEN\n      CONTINUE;'
    );
  });
});
