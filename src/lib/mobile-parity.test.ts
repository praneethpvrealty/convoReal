/**
 * Drift guard for the mobile app's hand-ported mirrors of web logic.
 *
 * `mobile/` is a separate Expo project with its own package.json and
 * Metro root. It can import dependency-free `src/` modules at runtime
 * through `@shared/` (see [SHR-003] below), but most of the rules here
 * predate that and are maintained as copies that say so in their own
 * header comments.
 * Copies rot silently: before this suite existed the mobile plan card
 * advertised Starter as "50 contacts" (really 150) and Agency as
 * "unlimited broadcasts" (really 5,000).
 *
 * These tests read the mobile sources as text and assert they still
 * agree with the web sources of truth. They run in `npm test`, which
 * the pre-commit hook already executes.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';
import * as ts from 'typescript';

import { PLAN_CONFIG, PLAN_ORDER } from '@/lib/billing/plan-config';
import { CONTACT_LIST_COLUMNS } from '@/lib/contacts/list-columns';
import {
  activeEntityQuery,
  insertEntityReference,
  type EntityReference,
} from '@/lib/copilot/entities';
import { TOURS } from '@/lib/copilot/tours';
import { AGENCY_SHOWCASE_DESIGNS, SHOWCASE_STYLES } from '@/lib/showcase/style';
import { JOURNEY_ITEM_SOURCE_LABELS } from '@/lib/journey/captured';
import { MESSAGES } from '@/lib/i18n/messages';
import {
  MEDIA_SIZE_LIMITS,
  SUPPORTED_MEDIA_MIME_TYPES,
  rejectMedia,
} from '@/lib/whatsapp/media-kinds';
import { DOCUMENT_SIZE_LIMIT } from '@/lib/inventory/documents';
import {
  DEAL_DATE_HORIZON_DAYS,
  DEAL_DATE_KIND_LABELS,
} from '@/lib/calendar/deal-dates';
import {
  DEAL_DEADLINE_PAGE_ORDER,
  DEAL_DEADLINE_PAGE_SIZE,
} from '@/lib/deals/deadlines';
import {
  APPOINTMENT_STATUS_LABELS,
  ARCHIVE_BATCH_LIMIT as WEB_ARCHIVE_BATCH_LIMIT,
  appointmentStatusActions,
  TASK_SORT_LABELS,
} from '@/lib/calendar/tasks-view';
import {
  PULSE_FEED_PAGE_SIZE,
  PULSE_VIEWED_LISTINGS_LIMIT,
  nextPulseFeedCursor,
  pulseFeedCursorFilter,
} from '@/lib/pulse/feed-page';
import { pulseVisitorLabel } from '@/lib/pulse/visitor-label';
import * as EKhataWeb from '@/lib/inventory/e-khata-fields';
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
  buildRequirementDigest,
  formatRequirement,
  isShareable,
  requirementReference,
  type RequirementShareMode,
  type ShareableRequirement,
} from '@/lib/requirements/share';
import {
  effectiveAreas,
  effectiveCategories,
  effectiveMaxBudget,
  visibleTagSuggestions,
} from '@/lib/contact-preferences';
import {
  AREA_FILTER_COLUMNS,
  areaFilterVariants,
  areaOptionLabel,
  areaOverlapFilter,
  areaSearchTerms,
  areaSearchVariants,
  areasMatchSearch,
  areaVariantKey,
  MAX_AREA_FILTER_VARIANTS,
  MAX_SELECTED_AREAS,
  type AreaOption,
} from '@/lib/contacts/area-variants';
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
import {
  DEFAULT_BOARD_LAYOUT,
  parseBoardLayout,
} from '@/lib/pipelines/board-layout';
import { dealFee } from '@/lib/pipelines/deal-money';
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
  formatStakeholderPhone,
  type StakeholderRole,
} from '@/lib/deals/stakeholders';
import { DEAL_VISIBILITY_LABELS } from '@/lib/deals/visibility';
import {
  BUNDLE_MAX_DEALS,
  BUNDLE_MIN_DEALS,
  BUNDLE_NAME_MAX,
  bundleBlocker,
  bundleCandidates,
  defaultBundleName,
} from '@/lib/deals/bundles';
import { deadlineLabel } from '@/lib/deals/deadlines';
import {
  TRANCHE_LABEL_SUGGESTIONS,
  TRANCHE_STATUS_LABELS,
} from '@/lib/deals/tranches';
import {
  DEAL_POSITION_LABELS,
  PAYOUT_STATUS_LABELS,
} from '@/lib/deals/co-broking';
import { RECORDS_SORTS } from '@/lib/deals/index-row';
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
import { importCountLabel } from '@/lib/inventory/import-activity';
import { buildShowcaseShareLink } from '@/lib/inventory/showcase-share-link';
import { applyShowcaseScope } from '@/lib/inventory/showcase-share-scope';
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
  EXPERIMENT_SUPPRESSION_MESSAGE,
  EXPERIMENT_SUPPRESSION_MS,
  MARKETING_SUPPRESSION_MESSAGE,
  MARKETING_SUPPRESSION_MS,
  META_MARKETING_EXPERIMENT_ERROR,
  META_MARKETING_FREQUENCY_ERROR,
} from '@/lib/whatsapp/delivery-failure';
import {
  HIDE_ACTION_LABEL,
  HIDE_CONFIRM_MESSAGE,
  MAX_PINNED_PER_CONVERSATION,
} from '@/lib/whatsapp/message-state';
import { JOURNEY_LIFECYCLE_STATUSES } from '@/lib/journey/overview-state';
import { CONVERSATION_CLOSE_REASONS } from '@/lib/conversations/closure';
import { LANGUAGE_CODES, SUPPORTED_LANGUAGES } from '@/lib/languages';
import { rateHeadline, schedulePrinted } from '@/lib/guidance-value/present';

/** Every .ts/.tsx file under `<root>/<dir>`, recursively. */
function modulePathsUnder(root: string, dir: string, out: string[] = []) {
  const full = join(root, dir);
  if (!existsSync(full)) return out;
  for (const entry of readdirSync(full)) {
    if (entry === 'node_modules' || entry === '.expo') continue;
    const rel = `${dir}/${entry}`;
    if (statSync(join(root, rel)).isDirectory()) {
      modulePathsUnder(root, rel, out);
    } else if (/\.tsx?$/.test(entry)) {
      out.push(join(root, rel));
    }
  }
  return out;
}

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

/** A mobile pure-logic module, transpiled and evaluated in isolation.
 *  `deps` supplies the source of any sibling module it imports. */
function mobileModule<T>(
  relativePath: string,
  deps: Record<string, string> = {}
): T {
  const compile = (source: string) =>
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
  const loaded = new Map<string, { exports: unknown }>();
  const evaluate = (source: string) => {
    const sandboxModule = { exports: {} };
    runInNewContext(compile(source), {
      module: sandboxModule,
      exports: sandboxModule.exports,
      require: (specifier: string) => {
        const dep = deps[specifier];
        if (dep === undefined) {
          throw new Error(`unstubbed import: ${specifier}`);
        }
        const already = loaded.get(specifier);
        if (already) return already.exports;
        const built = { exports: evaluate(dep) };
        loaded.set(specifier, built);
        return built.exports;
      },
    });
    return sandboxModule.exports;
  };
  return evaluate(mobileSource(relativePath)) as T;
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

  it('[PRP-052] offers each listing showcase page from web and mobile alike', () => {
    const mobile = mobileSource('app/(app)/property/[id].tsx');
    const web = webSource('components/inventory/property-actions-menu.tsx');

    expect(mobile).toContain('isListedOnShowcase(property)');
    expect(mobile).toContain("label: 'View on showcase'");
    expect(mobile).toContain("audience: 'client'");
    expect(mobile).toContain('markInternalView(');
    expect(mobile).toContain("label: 'Copy showcase link'");
    expect(mobile).toContain('Clipboard.setStringAsync(url)');
    expect(web).toContain('isListedOnShowcase(property)');
    expect(web).toContain('markInternalView(');
    expect(web).toContain('Copy showcase link');
    expect(web).toContain('View on showcase');
    expect(web).toContain('propertyShowcaseUrl(base, property)');
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

  it('[PRP-012] previews the listing template and lets the agent lead with a saved photo on both surfaces', () => {
    const mobile = mobileSource('components/property-share-sheet.tsx');
    const mobileActions = mobileSource('lib/property-share-actions.ts');
    const webMatchesTab = webSource(
      'components/inventory/property-matches-tab.tsx'
    );
    const shareRoute = webSource('app/api/whatsapp/share-property/route.ts');
    const previewRoute = webSource(
      'app/api/whatsapp/share-property/preview/route.ts'
    );

    expect(mobile).toContain('fetchSharePropertyPreview(property.id');
    expect(mobile).toContain('previewImages.includes(headerImage)');
    expect(mobileActions).toContain('/api/whatsapp/share-property/preview?');
    expect(mobileActions).toContain('header_image: headerImage');
    expect(webMatchesTab).toContain('/api/whatsapp/share-property/preview?');
    expect(webMatchesTab).toContain('? headerImageOptions.length > 0');
    expect(mobile).toContain('const showPhotos = preview.images.length > 0;');
    expect(webMatchesTab).toContain('header_image: selectedBroadcastImage');
    expect(webMatchesTab).toContain(
      'engineShare ? (property?.images ?? []) : images'
    );
    expect(shareRoute).toContain(
      '(listing.images ?? []).includes(requestedHeader)'
    );
    expect(previewRoute).toContain('buildSharePropertyPreview(');
  });
});

describe('a logged personal share is an outgoing share, not an enquiry', () => {
  it('[CTM-009] records the share ledger and leaves "Contacted about" alone on web and mobile', () => {
    const mobileShare = mobileSource('lib/property-share-actions.ts');
    const webDialog = webSource(
      'components/contacts/log-external-share-dialog.tsx'
    );
    const logShare = mobileShare.slice(
      mobileShare.indexOf('export async function logExternalShare'),
      mobileShare.indexOf('const SHARE_TIMEOUT_MS')
    );

    expect(logShare).toContain("apiFetch('/api/properties/share-log'");
    expect(webDialog).toContain('recordPropertyShares({');
    for (const source of [logShare, webDialog]) {
      expect(source).toContain('.update({ last_contacted_at: now })');
      expect(source).not.toContain('last_inquired_property_id');
    }
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

  it('[CTM-001] asks both surfaces to confirm a merge across different WhatsApp numbers', () => {
    const mobileMerge = mobileSource('components/contact-merge-sheet.tsx');
    const webMerge = webSource('components/contacts/duplicates-panel.tsx');
    const route = webSource('app/api/contacts/merge/route.ts');

    expect(route).toContain('primaryPhonesDiffer(source.phone, target.phone)');
    expect(mobileMerge).toContain(
      "import { primaryPhonesDiffer } from '@shared/lib/contacts/phone-key';"
    );
    expect(webMerge).toContain(
      "import { primaryPhonesDiffer } from '@/lib/contacts/phone-key';"
    );
    for (const source of [mobileMerge, webMerge]) {
      expect(source).toContain(
        'confirmDifferentPhones: phoneMismatch && phonesConfirmed'
      );
      expect(source).toContain('Both numbers belong to the same person');
    }
  });
});

describe('Overview approvals read the same on web and mobile', () => {
  it('orders location approvals with one shared rule and tucks approved ones away', () => {
    const webPanel = webSource(
      'components/dashboard/location-approvals-panel.tsx'
    );
    const mobilePanel = mobileSource('components/location-approvals.tsx');
    expect(webPanel).toContain('splitLocationApprovals(rows)');
    expect(mobilePanel).toContain('splitLocationApprovals(rows)');
    expect(mobilePanel).toContain(
      "import { splitLocationApprovals } from '@shared/lib/dashboard/approval-order';"
    );
    expect(webPanel).toContain('Recently approved ({approved.length})');
    expect(mobilePanel).toContain('Recently approved ({approved.length})');
  });

  it('[DOC-001] reads the document approval stage, wording and grouping from one shared rule on both surfaces', () => {
    const shared = webSource('lib/dashboard/document-approvals.ts');
    const webPanel = webSource(
      'components/dashboard/document-approvals-panel.tsx'
    );
    const mobilePanel = mobileSource('components/document-approvals.tsx');
    expect(shared).toContain('Approve & send ${row.document_count}');
    expect(shared).toContain("'Approve without documents'");
    expect(shared).toContain("'Send anyway'");
    expect(shared).toContain("'Dismiss'");
    expect(webPanel).toContain("from '@/lib/dashboard/document-approvals'");
    expect(mobilePanel).toContain(
      "from '@shared/lib/dashboard/document-approvals'"
    );
    for (const panel of [webPanel, mobilePanel]) {
      expect(panel).toContain('documentApprovalCopy(row, now)');
      expect(panel).toContain('documentRequestWaitLabel(row, now)');
      expect(panel).toContain('groupDocumentApprovals(rows, now)');
      expect(panel).toContain('Recently decided ({decided.length})');
      expect(panel).not.toContain('Approve & send');
      expect(panel).not.toContain('Approve &amp; send');
    }
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

  it("[CTM-011] sends the buyer or owner Portfolio invite, or an agent's ConvoReal invite, from the same routes on web and mobile", () => {
    const mobileContact = mobileSource('app/(app)/contact/[id].tsx');
    const mobileSheet = mobileSource('components/portfolio-invite-sheet.tsx');
    const webContact = webSource('components/contacts/contact-detail-view.tsx');
    const webDialog = webSource(
      'components/contacts/portfolio-invite-dialog.tsx'
    );

    expect(mobileContact).toContain('label="Portfolio Invite"');
    expect(mobileContact).toContain('<PortfolioInviteSheet');
    expect(webContact).toContain('Portfolio Invite');
    expect(webContact).toContain('<PortfolioInviteDialog');
    for (const source of [mobileSheet, webDialog]) {
      expect(source).toContain('/portfolio-invite`');
      expect(source).toContain("channel: 'business', side");
      expect(source).toContain("channel: 'personal', side");
      expect(source).toContain('https://wa.me/${digits}?text=');
      expect(source).toContain('Owner Portfolio');
      expect(source).toContain('Buyer Portfolio');
      expect(source).toContain('Agent Invite');
      expect(source).toContain("'/api/beta-invites'");
      expect(source).toContain("channel: 'personal', side: 'agent'");
    }
  });

  it('[CTM-012] captures name, Name Tag, Reference and Notes on web and mobile', () => {
    const quickAdd = mobileSource('app/(app)/(tabs)/contacts.tsx');
    const editor = mobileSource('app/(app)/contact/[id].tsx');
    const webForm = webSource('components/contacts/contact-form.tsx');

    expect(quickAdd).toContain('quickAddContactPayload(');
    expect(quickAdd).toContain('value={nameTag}');
    expect(quickAdd).not.toContain('Name (optional)');
    expect(editor).toContain('label="Reference"');
    expect(editor).toContain('...referrerFields(contact, referrer)');
    expect(editor).toContain('label="Notes"');
    expect(editor).toContain('editable={recentNoteLoaded}');
    expect(editor).toContain("from('contact_notes')");
    expect(webForm).toContain('if (!contact?.id && !name.trim())');
    expect(webForm).toContain('referrer: referrer.trim() || null');
    expect(webForm).toContain('note_text: notesText');
  });

  it('[CTM-004] shares hand-picked listings with a buyer from the contact record and saves them to their Portfolio', () => {
    const mobileContact = mobileSource('app/(app)/contact/[id].tsx');
    const mobileSheet = mobileSource('components/showcase-share-sheet.tsx');
    const webContact = webSource('components/contacts/contact-detail-view.tsx');
    const webDialog = webSource(
      'components/inventory/showcase-share-dialog.tsx'
    );

    expect(mobileContact).toContain('label="Share Listings"');
    expect(mobileContact).toContain('portfolioContact={contact}');
    expect(webContact).toContain('Share Listings');
    expect(webContact).toContain('portfolioContact={{');
    for (const source of [mobileSheet, webDialog]) {
      expect(source).toContain('/share-listings?count=');
      expect(source).toContain('/share-listings`');
      expect(source).toContain('portfolioNudge');
      expect(source).toContain('recordSharedListings()');
    }
  });

  it('[PRP-046] refuses a buyers-only pick for an agent before composing the message, on both surfaces', () => {
    const mobileSheet = mobileSource('components/showcase-share-sheet.tsx');
    const webDialog = webSource(
      'components/inventory/showcase-share-dialog.tsx'
    );
    expect(mobileSheet).toContain(
      "from '@shared/lib/inventory/showcase-audience'"
    );
    expect(mobileSheet).toContain('withheldPicks.length === 0');
    expect(mobileSheet).toContain('recipients: contacts,');
    expect(mobileSheet).toContain('audience,');
    expect(webDialog).toContain(
      'const shareBlocked = withheldPicks.length > 0;'
    );
    expect(webDialog).toContain('if (!generatedLink || shareBlocked) return;');
    expect(webDialog).toContain("'id, name, phone, name_tag, classification'");
    expect(webDialog).toContain('audience,');
    expect(webSource('components/contacts/contact-detail-view.tsx')).toContain(
      'classification: contact.classification ?? null,'
    );
  });

  it('[CTM-002] offers the agent-view invite to co-brokers on both surfaces', () => {
    const mobileContact = mobileSource('app/(app)/contact/[id].tsx');
    const mobileSheet = mobileSource('components/portal-invite-sheet.tsx');
    const webContact = webSource('components/contacts/contact-detail-view.tsx');
    const webDialog = webSource('components/contacts/portal-invite-dialog.tsx');

    const leadingUpTo = (source: string, marker: string) => {
      const at = source.indexOf(marker);
      expect(at).toBeGreaterThan(-1);
      return source.slice(Math.max(0, at - 400), at);
    };
    expect(leadingUpTo(mobileContact, 'label="Share Portal"')).not.toContain(
      "!== 'Agent'"
    );
    expect(leadingUpTo(webContact, 'Share Portal\n')).not.toContain(
      "!== 'Agent'"
    );
    for (const source of [mobileSheet, webDialog]) {
      expect(source).toContain("=== 'Agent'");
      expect(source).toContain('the full inventory in agent view');
    }
  });
});

describe('the showcase share sheet scrolls inside the sheet', () => {
  // A scroll area in a BottomSheet grows past the sheet's height cap
  // unless it shrinks (sheetScrollArea); the sheet then clips it and the
  // message and share buttons below the link cannot be reached. A long
  // link made this visible on 19 October 2026.
  it('[PRP-005] shrinks its scroll area to the sheet', () => {
    const sheet = mobileSource('components/showcase-share-sheet.tsx');
    const body = sheet.slice(sheet.indexOf('<BottomSheet'));
    expect(body).toMatch(/<ScrollView\s+style=\{sheetScrollArea\}/);
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
    expect(screen).toContain('lostStageId: row.lost_stage_id ?? null');
    expect(screen).toContain('group.lostStageId === stage.id');
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
    expect(screen).toContain(
      "accessibilityLabel={canEdit ? 'Add or view notes' : 'View notes'}"
    );
  });

  it('[JRN-026] lists the leads who said Interested or Shortlisted first, badged, with an overview chip', () => {
    expect(screen).toContain(
      "} from '@shared/lib/journey/lead-interest-labels';"
    );
    expect(screen).toContain(
      'sortCapturedByLeadInterest(capturedQuery.data ?? [])'
    );
    expect(screen).toContain(
      'const interest = journeyLeadInterestLabel(item);'
    );
    expect(screen).toContain(
      'const itemInterest = journeyLeadInterestLabel(item);'
    );
    expect(screen).toContain(
      'accessibilityLabel={`Lead ${itemInterest.toLowerCase()}`}'
    );
    expect(screen).toContain('journeyLeadInterestCountLabel(group.interested)');
    expect(screen).toContain('interested: Number(row.interested_count ?? 0)');
    expect(screen).toContain(
      'interestedHidden: Number(row.interested_hidden_count ?? 0)'
    );
    expect(screen).toContain('if (group.interestedHidden > 0) {');
    expect(screen).toContain('lead_interest, lead_interest_at, created_at');
    expect(screen).toContain(
      'A lead who said Interested or Shortlisted is listed first.'
    );
    const trayDialog = readFileSync(
      join(process.cwd(), 'src/components/journey/captured-tray-dialog.tsx'),
      'utf8'
    );
    expect(trayDialog).toContain('sortCapturedByLeadInterest(items)');
    expect(trayDialog).toContain(
      'A lead who said Interested or Shortlisted is listed first.'
    );
    const overview = readFileSync(
      join(process.cwd(), 'src/components/journey/journey-overview.tsx'),
      'utf8'
    );
    expect(overview).toContain(
      'journeyLeadInterestCountLabel(group.interested)'
    );
    expect(overview).toContain('interested: Number(row.interested_count ?? 0)');
    expect(overview).toContain(
      'interestedHidden: Number(row.interested_hidden_count ?? 0)'
    );
    expect(overview).toContain(
      'if (group.interestedHidden > 0) setTrayRequest((n) => n + 1);'
    );
    expect(overview).toContain(
      'onTrayRequestHandled={() => setTrayRequest(0)}'
    );
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
    expect(screen).toContain('removeJourneyItems({ itemIds: [item.id] })');
    expect(screen).not.toContain(".from('journey_items')\n        .delete()");
    expect(screen).toContain('accessibilityLabel="Remove from journey"');
    expect(screen).toContain('{canEdit && confirming ? (');
    expect(screen).toContain('{canEdit && !confirming ? (');
    expect(screen).toContain('copilotFabClearance(insets.bottom)');
  });

  it('[JRN-009] records a personal-WhatsApp share through the server ledger that captures the journey', () => {
    const actions = mobileSource('lib/property-share-actions.ts');
    const logShare = actions.slice(
      actions.indexOf('export async function logExternalShare'),
      actions.indexOf('const SHARE_TIMEOUT_MS')
    );
    expect(logShare).toContain("apiFetch('/api/properties/share-log'");
    expect(logShare).not.toContain("from('property_shares')");
    const webLog = webSource('lib/inventory/share-log.ts');
    const recordShares = webLog.slice(
      webLog.indexOf('export async function recordPropertyShares'),
      webLog.indexOf('export async function fetchPropertyShareLog')
    );
    expect(recordShares).toContain("fetch('/api/properties/share-log'");
    expect(recordShares).not.toContain("from('property_shares')");
  });

  it('[JRN-021] reads the share-log verdict through one shared reader on web and mobile', () => {
    const sources = [
      webSource('lib/inventory/share-log.ts'),
      mobileSource('lib/property-share-actions.ts'),
      mobileSource('lib/catalog-product-share.ts'),
    ];
    for (const source of sources) {
      expect(source).toContain('postShareLog(');
      expect(source).toContain('/api/properties/share-log');
    }
    const catalog = mobileSource('lib/catalog-product-share.ts');
    expect(catalog).toContain('return outcome.complete;');
  });

  it('[JRN-021] tells the agent when a share stays unrecorded, in the same words on all six surfaces', () => {
    const actions = mobileSource('lib/property-share-actions.ts');
    const logShare = actions.slice(
      actions.indexOf('export async function logExternalShare'),
      actions.indexOf('const SHARE_TIMEOUT_MS')
    );
    expect(logShare).toContain('return outcome.complete;');
    expect(logShare.indexOf('postShareLog(')).toBeLessThan(
      logShare.indexOf('ensureProfile()')
    );
    expect(logShare).not.toContain('return false;');
    expect(mobileSource('components/property-share-sheet.tsx')).toContain(
      "showAppDialog({\n          title: 'Not recorded',\n          message: SHARE_UNRECORDED_NOTICE,\n        });"
    );
    for (const file of [
      'components/inventory/property-matches-tab.tsx',
      'components/contacts/log-external-share-dialog.tsx',
    ]) {
      expect(webSource(file)).toContain(
        'if (r.error) toast.warning(SHARE_UNRECORDED_NOTICE);'
      );
    }
    for (const file of [
      'components/inventory/property-share-dialog.tsx',
      'components/inventory/property-email-share-dialog.tsx',
    ]) {
      expect(webSource(file)).toContain(
        'toast.warning(SHARE_UNRECORDED_NOTICE);'
      );
    }
    const card = mobileSource('components/catalog-product-share.tsx');
    expect(card).toContain('SHARE_UNRECORDED_NOTICE,');
    expect(card).toContain("? 'Not recorded'");
  });

  it('[JRN-011] removes a branch and the deal opened from it through one route on web and mobile', () => {
    const mobileApi = mobileSource('lib/api.ts');
    const webRemove = webSource('lib/journey/remove.ts');
    const section = webSource('components/journey/journey-section.tsx');
    const overview = webSource('components/journey/journey-overview.tsx');
    expect(mobileApi).toContain("'/api/journey/remove'");
    expect(webRemove).toContain("fetch('/api/journey/remove'");
    expect(section).toContain('removeJourneyItems({ itemIds: [item.id] })');
    expect(overview).toContain(
      'removeJourneyItems({ mode, subjectId: group.subjectId })'
    );
    for (const source of [section, overview, screen]) {
      expect(source).not.toMatch(/from\('journey_items'\)\s*\.delete\(\)/);
    }
    expect(overview).toContain('Remove journey and deals');
    expect(screen).toContain('onRemoveItem={askRemoveItem}');
    expect(screen).toContain("label: 'Remove branch and deal'");
    expect(screen).toContain("label: 'Remove journey and deals'");
    expect(screen).toContain('{ mode, subjectId: group.subjectId }');
    expect(screen.match(/removeJourneyAction\(group\)/g)).toHaveLength(3);
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
    expect(screen).toContain(
      'stageInHeader ? (stage?.id ?? null) : null,\n    droppedStage'
    );
    expect(screen).toContain('bucket.stage?.id === group.lostStageId');
    expect(screen).toContain('atStage.map((item) => renderItem(item))');
    expect(screen).toContain('? dropped || item.stage_id === stage?.id');
    expect(screen).toContain(
      ": item.stage_id === stage?.id && item.status !== 'dropped'"
    );
    expect(screen).toContain('more at other stages');
    const webSection = webSource('components/journey/journey-section.tsx');
    expect(webSection).toContain('more at other stages');
  });

  it('[JRN-013] keeps a moved item in view in its new stage group on web and mobile', () => {
    const helpers = mobileSource('lib/journey-overview.ts');
    const webShared = webSource('components/journey/shared.ts');
    const body = (source: string) => {
      const start = source.indexOf('export function journeyStageBucketKey');
      return source.slice(start, source.indexOf('\n}\n', start) + 3);
    };
    expect(body(helpers)).not.toBe('');
    expect(body(helpers)).toEqual(body(webShared));
    expect(screen).toContain(
      'journeyStageBucketKey(movedGroup.furthestStageIdx, stages)'
    );
    expect(screen).toContain('itemId: item.id,');
    expect(screen).toContain('scrollRef.current?.scrollTo({');
    expect(screen).toContain('.filter((item) => item.id === focusItemId)');
    const webOverview = webSource('components/journey/journey-overview.tsx');
    expect(webOverview).toContain(
      'journeyStageBucketKey(spotlightGroup.furthestStageIdx, stages)'
    );
  });

  it('[JRN-014] splits every stage into Focus and Passive on web and mobile', () => {
    const helpers = mobileSource('lib/journey-overview.ts');
    const webShared = webSource('components/journey/shared.ts');
    const body = (source: string) => {
      const start = source.indexOf(
        'export function splitJourneysByCompartment'
      );
      return source.slice(start, source.indexOf('\n}\n', start) + 3);
    };
    expect(body(helpers)).toContain('focusIds.has(group.subjectId)');
    expect(body(helpers)).toEqual(body(webShared));
    const api = mobileSource('lib/api.ts');
    expect(api).toContain('`/api/journey/compartments?mode=${mode}`');
    expect(api).toContain("'/api/journey/compartments',");
    expect(screen).toContain(
      'splitJourneysByCompartment(bucket.groups, focusIds)'
    );
    expect(screen).toContain(
      "label: inFocus ? 'Move to Passive' : 'Move to Focus'"
    );
    expect(screen).toContain(
      "const compartmentsOn = view === 'active' && compartmentsQuery.isSuccess;"
    );
    expect(screen).toContain('compartmentsQuery.isLoading;');
    expect(screen).toContain(
      'await queryClient.cancelQueries({ queryKey: key });'
    );
    expect(screen).toContain(
      '{passiveOpen ? renderCards(split.passive) : null}'
    );
    const sheet = mobileSource('components/profile-edit-sheet.tsx');
    expect(sheet).toContain('journey_compartment_scope: scope');
    const webCard = webSource(
      'components/settings/journey-compartment-scope-card.tsx'
    );
    expect(webCard).toContain('journey_compartment_scope: scope');
  });

  it('[JRN-012] orders journeys by the same enquiry totals on web and mobile', () => {
    const helpers = mobileSource('lib/journey-overview.ts');
    const webShared = webSource('components/journey/shared.ts');
    const webOverview = webSource('components/journey/journey-overview.tsx');
    const sortSource = webSource('lib/journey/sort.ts');
    expect(sortSource).toContain("enquiries: 'Most enquired'");
    expect(sortSource).toContain("enquired: 'Recently enquired'");
    expect(sortSource).toContain(
      "export const DEFAULT_JOURNEY_SORT: JourneySort = 'enquiries';"
    );
    expect(sortSource).toContain(
      'enquiries: [byEnquiries, byEnquired, byRecent, byStage]'
    );
    expect(sortSource).toContain(
      'enquired: [byEnquired, byEnquiries, byRecent, byStage]'
    );
    expect(helpers).toContain("} from '@shared/lib/journey/sort';");
    expect(webShared).toContain("} from '@/lib/journey/sort';");
    for (const source of [helpers, webShared]) {
      expect(source).not.toContain('export function sortJourneys');
    }
    for (const source of [screen, webOverview]) {
      expect(source).toContain("rpc('journey_overview_enquiries'");
      expect(source).toContain("canDrag={sort === 'manual'}");
    }
    const labelBody = (source: string) =>
      source
        .slice(source.indexOf('export function journeyEnquiryLabel'))
        .split('export function journeyRaceLabel')[0];
    expect(labelBody(helpers)).toEqual(labelBody(webShared));
    for (const helper of [
      'export function journeyEnquirySourceOptions(',
      'export function matchesJourneyEnquirySource(',
      'export function journeyViewCounts(',
    ]) {
      expect(labelBody(webShared)).toContain(helper);
    }
    for (const source of [screen, webOverview]) {
      expect(source).toContain('last_enquiry_source ?? null');
      expect(source).toContain('enquiry_source_count ?? 0');
      expect(source).toContain('enquiry_sources ?? []');
      expect(source).toContain(
        'journeyEnquirySourceOptions(inView, enquirySource)'
      );
      expect(source).toContain(
        'matchesJourneyEnquirySource(group, enquirySource)'
      );
    }
    expect(webOverview).toContain(
      '? `journey_overview_source_${accountId}_${mode}`'
    );
    expect(webOverview).toContain(
      'const [enquirySource, setEnquirySource] = useState<string | null>(null);'
    );
    expect(webOverview).toContain(
      'setEnquirySource(readEnquirySource(sourceKey));'
    );
    expect(webOverview).toContain('if (next) writeStored(sourceKey, next);');
    expect(webOverview).toContain('else removeStored(sourceKey);');
    expect(screen).toContain(
      'useRememberedJourneySource(\n    accountId,\n    mode\n  );'
    );
    expect(screen).not.toContain('setEnquirySource(null);');
    expect(webOverview).toContain('aria-label="Clear source filter"');
    expect(screen).toContain('accessibilityLabel="Clear source filter"');
    expect(screen).toContain(
      'journeySourceChips(sourceOptions, enquirySource)'
    );
    expect(screen).toContain('({ source, label, clear }) => {');
    expect(
      (screen.match(/accessibilityLabel="Clear source filter"/g) ?? []).length
    ).toBe(1);
    expect(webOverview).toContain('{enquirySource && (');
    expect(screen).toContain('if (clear) {');
    for (const source of [screen, webOverview]) {
      expect(source).toContain(
        '() => journeyViewCounts(groups, enquirySource),'
      );
    }
    expect(screen).toContain('ref={sourceChipsRef}');
    expect(screen).toContain(
      'sourceChipsRef.current?.scrollTo({ x: 0, animated: true });\n  }, [enquirySource, mode, view]);'
    );
    const preference = mobileSource('lib/journey-source-preference.ts');
    expect(preference).toContain(
      '`journey_overview_source_${accountId}_${mode}`'
    );
    expect(preference).toContain('normalizeJourneyEnquirySource(stored)');
    expect(preference).not.toContain('zustand');
    expect(mobileSource('lib/api.ts')).toContain(
      '`/api/journey/enquiries?mode=${mode}&subjectId=${subjectId}`'
    );
    expect(webSource('components/journey/enquiries-dialog.tsx')).toContain(
      '`/api/journey/enquiries?mode=${mode}&subjectId=${subjectId}`'
    );
    expect(screen).toContain(
      'loadJourneyEnquiries(mode, enquiryGroup!.subjectId)'
    );
    expect(screen).toContain('onPress={onEnquiries}');
    expect(screen).not.toContain("from '@shared/lib/journey/enquiries'");
    expect(helpers).not.toContain('journeyEnquiryEntries');
    expect(screen).toContain(
      'const enquiryLabel = journeyEnquiryLabel(group);'
    );
    expect(webOverview).toContain('{journeyEnquiryLabel(group)}');
    expect(screen).toContain('return sortJourneys(summaries, sort);');
    expect(screen).toContain('{canEdit && canDrag ? (');
  });

  it('[JRN-004] saves one notes box against the current stage and lists every note across stages', () => {
    expect(screen).toContain('title="Notes"');
    expect(screen).not.toContain('Note stage');
    expect(screen).toContain('onPress={() => onAddNote(item, itemStage)}');
    expect(screen).not.toContain('stageId: noteTarget.stage.id,');
    expect(screen).toContain('color: note.stage_color ?? colors.textMuted,');
    expect(screen).toContain(
      'Saved with the date, time and {noteTarget.stage.name}'
    );
    expect(screen).toContain('{noteTimestamp(note.created_at)}');
    expect(screen).toContain('{note.stage_name}');
    expect(screen).toContain('loadJourneyStageNotes(noteTarget!.item.id)');
    expect(screen).toContain('.range(from, from + JOURNEY_NOTE_PAGE_SIZE - 1)');
    expect(screen).toContain('All notes');
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

  it('[PRP-046] offers the buyers-only switch and saves it as the web form does', () => {
    expect(source).toContain('showcase_visibility, showcase_audience,');
    expect(source).toContain(
      "showcase_audience: buyersOnly ? 'buyers_only' : null"
    );
    expect(source).toContain('Buyers only');
    const list = mobileSource('app/(app)/(tabs)/properties.tsx');
    expect(list).toContain("property.showcase_audience === 'buyers_only'");
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

describe('mobile/lib/phone-numbers.ts mirrors phone-numbers', () => {
  // Promoting an "other" number to primary is what routes every WhatsApp
  // path to the number the contact actually uses. If the swap differs
  // between surfaces, one of them loses the old primary or reorders the
  // list the other shows.
  it('[CTM-006] keeps both phone rules identical to the web source', () => {
    const marker = 'export interface ContactPhones';
    const body = (source: string) => {
      const start = source.indexOf(marker);
      expect(start, 'phone-numbers marker missing').toBeGreaterThan(-1);
      return source.slice(start);
    };
    expect(body(mobileSource('lib/phone-numbers.ts'))).toBe(
      body(webSource('lib/contacts/phone-numbers.ts'))
    );
  });
});

describe('mobile/lib/name-tag-split.ts mirrors name-tag-split', () => {
  // Both phonebook imports split "Dr Murali Makam Owner Hsr" into the same
  // first name, second name and Name Tag. If the lexicon or either splitter
  // drifts, the same phone contact lands as two different records
  // depending on which surface imported it.
  it('[CTM-005] keeps the lexicon and both splitters identical to the web source', () => {
    const marker = '// Role/trade/context words';
    const body = (source: string) => {
      const start = source.indexOf(marker);
      expect(start, 'lexicon marker missing').toBeGreaterThan(-1);
      return source.slice(start);
    };
    expect(body(mobileSource('lib/name-tag-split.ts'))).toBe(
      body(webSource('lib/contacts/name-tag-split.ts'))
    );
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

describe('[PRP-048] the mobile share sheet asks before an off-market listing is shared', () => {
  // The web dialog and the sheet put the same question, from the same
  // shared helper, and the choice is the same pair: with the availability
  // note appended to the message, or without it.
  const sheet = mobileSource('components/property-share-sheet.tsx');
  const dialog = webSource('components/inventory/property-share-dialog.tsx');

  it('reads the prompt from the shared availability module', () => {
    expect(sheet).toContain(
      "from '@shared/lib/inventory/listing-availability'"
    );
    expect(sheet).toContain('unavailableListingSharePrompt(property.status)');
    expect(dialog).toContain('unavailableListingSharePrompt(property.status)');
  });

  it('offers both choices and hides the composer until one is made', () => {
    expect(sheet).toContain("onChoose('with_note')");
    expect(sheet).toContain("onChoose('without_note')");
    expect(sheet).toContain('sharePrompt && unavailableShare === null');
    expect(sheet).toContain(
      "unavailableShare === 'with_note' && sharePromptNote"
    );
    expect(dialog).toContain("unavailableShare === 'with_note'");
  });

  it('gates the catalog product card the same way and sends the note flag', () => {
    const card = mobileSource('components/catalog-product-share.tsx');
    const lib = mobileSource('lib/catalog-product-share.ts');
    expect(sheet).toContain('unavailablePrompt={sharePrompt}');
    expect(card).toContain(
      'unavailablePrompt && availabilityNote === undefined'
    );
    expect(card).toContain("label: 'With the note'");
    expect(card).toContain('availabilityNote === true');
    expect(lib).toContain('availability_note: availabilityNote');
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

  it('[INB-008] blocks the same Meta experiment error', () => {
    expect(mobileSource('lib/message-actions.ts')).toContain(
      `META_MARKETING_EXPERIMENT_ERROR = ${META_MARKETING_EXPERIMENT_ERROR}`
    );
    expect(mobileSource('lib/message-actions.ts')).toContain(
      'WhatsApp experiment on this number'
    );
  });

  // The code alone is not the policy. Mobile cannot import from this
  // repo (mobile/AGENTS.md), so the copy is what ships — pin the
  // windows and the wording too, or a change to either diverges in
  // silence and the two surfaces tell an agent different things about
  // one failure.
  it('[INB-008] pauses for the same windows and says the same thing', () => {
    const mobile = mobileSource('lib/message-actions.ts');

    expect(mobile).toContain(
      `MARKETING_SUPPRESSION_MS = ${MARKETING_SUPPRESSION_MS / (60 * 60 * 1000)} * 60 * 60 * 1000`
    );
    expect(mobile).toContain(
      `EXPERIMENT_SUPPRESSION_MS = ${EXPERIMENT_SUPPRESSION_MS / (24 * 60 * 60 * 1000)} * 24 * 60 * 60 * 1000`
    );
    expect(mobile).toContain(MARKETING_SUPPRESSION_MESSAGE);
    expect(mobile).toContain(EXPERIMENT_SUPPRESSION_MESSAGE);
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
      'linkCoordinates ??\n    toCoordinates(source.latitude ?? NaN, source.longitude ?? NaN);',
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

describe('mobile/lib/use-photo-source.ts resolves guarded photos', () => {
  const source = mobileSource('lib/use-photo-source.ts');

  it('exchanges each guarded path for a signed link through apiFetch', () => {
    expect(source).toContain(
      'apiFetch<{ data: { url: string } }>(`${path}?format=json`)'
    );
  });

  it('never hands <Image> a header it cannot carry', () => {
    expect(source).not.toContain('headers:');
    expect(source).not.toContain('authHeaders');
  });
});

describe('mobile inbox images load through the API client', () => {
  const image = mobileSource('components/media-image.tsx');
  const loader = mobileSource('lib/use-media-file.ts');

  it('never hands <Image> a header it cannot carry', () => {
    expect(image).not.toContain('headers');
    expect(image).not.toContain('authHeaders');
    expect(image).toContain('useMediaFile(');
  });

  it('downloads proxied media with apiResponse into the cache', () => {
    expect(loader).toContain('await apiResponse(path)');
    expect(loader).toContain('mediaCacheDir()');
  });

  it('plays voice notes from the downloaded file, never with a header', () => {
    const audio = mobileSource('components/audio-bubble.tsx');
    expect(audio).toContain('useMediaFile(');
    expect(audio).toContain('if (!ensurePlayable()) return;');
    expect(audio).not.toContain('headers');
    expect(audio).not.toContain('authHeaders');
  });

  it('wipes downloaded media on sign-out', () => {
    expect(mobileSource('lib/media-cache.ts')).toContain("'whatsapp-media'");
    expect(mobileSource('lib/auth-store.ts')).toContain('clearMediaCache()');
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
  // web and something else in the app, for the same field. The app
  // re-exports the web module rather than keeping a copy.
  const source = mobileSource('lib/format.ts');

  it('re-exports the web implementation instead of carrying a copy', () => {
    expect(source).toContain(
      "export { priceInWords } from '@shared/lib/format/currency';"
    );
    expect(source).toContain(
      "import { formatInrCompact } from '@shared/lib/format/currency';"
    );
    expect(source).not.toContain('export function priceInWords');
    expect(webSource('lib/currency-utils.ts')).toContain(
      "} from '@/lib/format/currency';"
    );
  });

  it('agrees with the web output across the range', () => {
    expect(priceInWords(160000000)).toBe('₹16 Crore');
    expect(priceInWords(12000000)).toBe('₹1.2 Crore');
    expect(priceInWords(8500000)).toBe('₹85 Lakhs');
    expect(priceInWords(45000)).toBe('₹45,000');
    expect(priceInWords('')).toBe('');
  });
});

describe('mobile/lib/requirement-digest.ts mirrors what leaves the Engine', () => {
  // Masking is the security boundary of a co-broker share. A drift
  // here means the phone sends a client's name or notes where the web
  // withholds them.
  const mobile = mobileModule<{
    buildRequirementDigest: typeof buildRequirementDigest;
    formatRequirement: typeof formatRequirement;
    isShareable: typeof isShareable;
    requirementReference: typeof requirementReference;
  }>('lib/requirement-digest.ts', {
    '@shared/lib/format/currency': webSource('lib/format/currency.ts'),
  });

  const briefs: ShareableRequirement[] = [
    {
      id: 'a3f2c1d0-1111-2222-3333-444455556666',
      name: 'Asha Rao',
      classification: 'Buyer',
      requirements: '3 BHK near the lake',
      areas_of_interest: ['Brookefield', '  '],
      projects_of_interest: ['Prestige Lakeside'],
      min_budget: 5000000,
      max_budget: 15000000,
      tags: ['Investor', null],
      latestNote: 'will stretch if pushed',
    },
    {
      id: 'b1b2c3d4-0000-0000-0000-000000000000',
      name: null,
      no_budget: true,
      requirements: 'Anything commercial',
    },
    {
      id: 'c0c0c0c0-0000-0000-0000-000000000000',
      requirements: 'parked',
      requirement_active: false,
    },
    { id: 'd0d0d0d0-0000-0000-0000-000000000000' },
  ];
  const modes: RequirementShareMode[] = ['masked', 'full'];

  it('[REQ-005] references and shareability agree', () => {
    for (const brief of briefs) {
      expect(mobile.requirementReference(brief.id)).toBe(
        requirementReference(brief.id)
      );
      expect(mobile.isShareable(brief), brief.id).toBe(isShareable(brief));
    }
  });

  it('[REQ-005] formats every brief identically in both modes', () => {
    for (const mode of modes) {
      for (const brief of briefs) {
        expect(mobile.formatRequirement(brief, mode), brief.id).toBe(
          formatRequirement(brief, mode)
        );
      }
      expect(mobile.buildRequirementDigest(briefs, mode)).toBe(
        buildRequirementDigest(briefs, mode)
      );
      expect(mobile.buildRequirementDigest([], mode)).toBe(
        buildRequirementDigest([], mode)
      );
    }
  });

  it('[REQ-005] withholds the same fields when masked', () => {
    const masked = mobile.buildRequirementDigest(briefs, 'masked');
    expect(masked).not.toContain('Asha Rao');
    expect(masked).not.toContain('Investor');
    expect(masked).not.toContain('will stretch');
  });
});

describe('mobile/lib/requirements-feed.ts mirrors the preference merge', () => {
  // The Requirements screen on both surfaces shows the same budget and
  // chips for a contact; the merge deciding explicit-over-extracted is
  // the thing that must not drift.
  const mobile = mobileModule<{
    effectiveMaxBudget: typeof effectiveMaxBudget;
    effectiveAreas: typeof effectiveAreas;
    effectiveCategories: typeof effectiveCategories;
    visibleTagSuggestions: typeof visibleTagSuggestions;
  }>('lib/requirements-feed.ts', {
    './contact-area-options': mobileSource('lib/contact-area-options.ts'),
    './requirements-profile': mobileSource('lib/requirements-profile.ts'),
    '@shared/lib/format/currency': webSource('lib/format/currency.ts'),
  });

  const contacts = [
    { max_budget: 5000000, pref_budget_max: 9000000 },
    { pref_budget_max: 9000000 },
    { max_budget: 0, pref_budget_max: null },
    { areas_of_interest: ['HSR'], pref_areas: ['BTM'] },
    { areas_of_interest: ['  '], pref_areas: ['BTM'] },
    {
      pref_property_categories: ['residential'],
      pref_property_types: ['Flat/ Apartment', 'residential'],
    },
    { property_interests: ['Villa'], pref_property_types: ['Plot'] },
  ];

  it('[REQ-004] merges budget, areas and categories the same way', () => {
    for (const c of contacts) {
      expect(mobile.effectiveMaxBudget(c)).toEqual(effectiveMaxBudget(c));
      expect(mobile.effectiveAreas(c)).toEqual(effectiveAreas(c));
      expect(mobile.effectiveCategories(c)).toEqual(effectiveCategories(c));
    }
  });

  it('[REQ-004] hides the same already-attached suggestions', () => {
    const cases: [string[] | null, string[]][] = [
      [['Investor', 'NRI', 'investor'], ['nri']],
      [['Investor'], []],
      [null, ['x']],
      [['  ', 'Plot'], []],
    ];
    for (const [suggested, attached] of cases) {
      expect(mobile.visibleTagSuggestions(suggested, attached)).toEqual(
        visibleTagSuggestions(suggested, attached)
      );
    }
  });
});

describe('mobile/lib/contact-area-options.ts mirrors the area filter builders', () => {
  // The server groups spellings; both surfaces turn a selection of
  // groups back into stored spellings and one PostgREST overlap clause.
  // Drift here means a locality picked on the phone narrows the list
  // differently from the same pick on the web.
  const mobile = mobileModule<{
    AREA_FILTER_COLUMNS: string[];
    MAX_SELECTED_AREAS: number;
    MAX_AREA_FILTER_VARIANTS: number;
    areaFilterVariants: typeof areaFilterVariants;
    areaOptionLabel: typeof areaOptionLabel;
    areaOverlapFilter: typeof areaOverlapFilter;
    areaSearchTerms: typeof areaSearchTerms;
    areaSearchVariants: typeof areaSearchVariants;
    areasMatchSearch: typeof areasMatchSearch;
    areaVariantKey: typeof areaVariantKey;
  }>('lib/contact-area-options.ts');
  const options: AreaOption[] = [
    {
      key: 'brkfld',
      label: 'Brookefield',
      variants: ['Brookefield', 'Brookfield', 'brookefield, Bengaluru'],
      count: 8,
    },
    {
      key: 'acslyt',
      label: 'AECS Layout',
      variants: ['AECS Layout', 'aecs layout'],
      count: 6,
    },
    { key: 'wtfld', label: 'Whitefield', variants: ['Whitefield'], count: 3 },
  ];

  it('[CTM-007] filters the same two columns under the same bounds', () => {
    expect(mobile.AREA_FILTER_COLUMNS).toEqual(AREA_FILTER_COLUMNS);
    expect(mobile.MAX_SELECTED_AREAS).toBe(MAX_SELECTED_AREAS);
    expect(mobile.MAX_AREA_FILTER_VARIANTS).toBe(MAX_AREA_FILTER_VARIANTS);
  });

  it('[CTM-007] expands a selection to the same spellings and clause', () => {
    for (const keys of [[], ['brkfld'], ['brkfld', 'acslyt'], ['missing']]) {
      const variants = areaFilterVariants(keys, options);
      expect(mobile.areaFilterVariants(keys, options)).toEqual(variants);
      expect(mobile.areaOverlapFilter(AREA_FILTER_COLUMNS, variants)).toBe(
        areaOverlapFilter(AREA_FILTER_COLUMNS, variants)
      );
    }
    expect(
      mobile.areaOverlapFilter(['pref_areas'], ['Say "hi" {now}', '\\x'])
    ).toBe(areaOverlapFilter(['pref_areas'], ['Say "hi" {now}', '\\x']));
  });

  it('labels a group the same way', () => {
    for (const option of options) {
      expect(mobile.areaOptionLabel(option)).toBe(areaOptionLabel(option));
    }
  });

  it('[CTM-008] keys a typed locality the same way, so search expands alike', () => {
    const typed = [
      'Brookefield',
      'Brookfield',
      'brookefield, Bengaluru',
      'AECS Layout',
      'A.E.C.S Layout',
      'Marathahalli',
      'Marathalli',
      'White Field',
      'HSR Layout',
      'HSR',
      'Hosur',
      'Hosur Road',
      'Sarjapura Road',
      'Electronics City',
      'Indira Nagar',
      'JP Nagar 7th Phase',
      'Yelhanka',
      'Bangalore North',
      'Praneeth',
      '   ',
      'Café Layout',
      'buyers in Brookfield',
      'in brookefield, Bengaluru',
      '2 bhk near AECS Layout for 1 cr',
      'around Whitefield with 3 bhk',
      'from Hosur',
      'near 1st Block Jayanagar',
      'in 7th Phase JP Nagar for 1 cr',
    ];
    for (const term of typed) {
      expect(mobile.areaVariantKey(term), term).toBe(areaVariantKey(term));
      expect(mobile.areaSearchTerms(term), term).toEqual(areaSearchTerms(term));
      expect(mobile.areaSearchVariants(term, options), term).toEqual(
        areaSearchVariants(term, options)
      );
    }
  });

  it('[REQ-003] matches a loaded brief by area the same way', () => {
    const briefs = [
      ['Brookefield', 'HSR Layout'],
      ['brookfield, Bengaluru'],
      ['Hosur Road'],
      ['1st Block Jayanagar'],
      [],
    ];
    for (const term of [
      'brookfield',
      'buyers in Brookfield',
      'Hosur',
      'near 1st Block Jaya Nagar',
      'in 7th Phase JP Nagar for 1 cr',
      'x',
    ]) {
      for (const areas of briefs) {
        expect(mobile.areasMatchSearch(term, areas), term).toBe(
          areasMatchSearch(term, areas)
        );
      }
    }
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

describe('new-user onboarding exists on both surfaces', () => {
  // The web dashboard shell mounts the setup checklist and the helper
  // widget shows proactive nudges; the app mounts the same two on its
  // inbox tab and helper button, driven by the same two API routes and
  // the same shared cooldown and checklist rules.
  const webShell = webSource('app/(dashboard)/dashboard-shell.tsx');
  const webNudges = webSource('hooks/useCopilotNudges.ts');
  const mobileInbox = mobileSource('app/(app)/(tabs)/index.tsx');
  const mobileChecklist = mobileSource('components/setup-checklist.tsx');
  const mobileOnboarding = mobileSource('lib/onboarding.ts');
  const mobileNudges = mobileSource('lib/use-copilot-nudges.ts');
  const mobileWidget = mobileSource('components/copilot-widget.tsx');

  it('[ONB-001] shows the owner setup checklist from the same status route', () => {
    expect(webShell).toContain('<SetupChecklist');
    expect(mobileInbox).toContain('<SetupChecklist');
    expect(mobileChecklist).toContain('useSetupChecklist');
    expect(mobileOnboarding).toContain("'/api/onboarding/status'");
    expect(mobileOnboarding).toContain("account_role === 'owner'");
    expect(mobileOnboarding).toContain('@shared/lib/onboarding/checklist');
  });

  it('[ONB-002] shows proactive nudges under the shared cooldown rules', () => {
    expect(webNudges).toContain("from '@/lib/copilot/nudge-pick'");
    expect(mobileNudges).toContain('@shared/lib/copilot/nudge-pick');
    expect(mobileNudges).toContain('/api/copilot/nudges?lang=');
    expect(webNudges).toContain('/api/copilot/nudges?lang=');
    expect(mobileWidget).toContain('useCopilotNudges');
    expect(mobileWidget).toContain('testID="copilot-nudge"');
  });

  it('[CPL-005] reaches the Help Centre from the helper and the menu on both surfaces', () => {
    expect(webSource('components/copilot/copilot-panel.tsx')).toContain(
      'href="/help"'
    );
    expect(webSource('components/layout/sidebar.tsx')).toContain(
      'href="/help"'
    );
    expect(mobileSource('components/copilot-sheet.tsx')).toContain(
      'openHelpCentre'
    );
    expect(mobileSource('app/(app)/(tabs)/more.tsx')).toContain(
      'openHelpCentre'
    );
    expect(mobileSource('lib/help-centre.ts')).toContain('/help`');
  });

  it('[CPL-007] renders tour copy through the shared translations', () => {
    expect(webSource('components/copilot/tour-overlay.tsx')).toContain(
      'localizeTour('
    );
    expect(mobileSource('components/copilot-tour.tsx')).toContain(
      'localizeMobileTour('
    );
    expect(mobileSource('components/copilot-sheet.tsx')).toContain(
      '@shared/lib/copilot/tour-copy'
    );
  });
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

describe('mobile/lib/showcase-scope.ts runs the showcase share rule from src/', () => {
  // A shared catalog link is a promise about what the recipient will
  // open. The scope rule lives once in src/lib/inventory/
  // showcase-share-scope.ts: the web dialog applies it through a URL
  // object, the phone through string appends, and both import it rather
  // than keeping a copy that could drift.
  const mobile = mobileSource('lib/showcase-scope.ts');
  const webBuilder = webSource('lib/inventory/showcase-share-link.ts');

  it('[PRP-005] both surfaces import the one rule', () => {
    expect(mobile).toContain(
      "from '@shared/lib/inventory/showcase-share-scope'"
    );
    expect(mobile).not.toContain("if (scope === 'search')");
    expect(webBuilder).toContain('showcaseScopeParams(');
  });

  const cases = [
    { scope: 'all' as const, category: 'Commercial' as const },
    {
      scope: 'search' as const,
      category: 'Commercial' as const,
      search: 'hsr layout',
    },
    { scope: 'search' as const, search: 'hsr', ids: ['CR-1', 'CR-2'] },
    { scope: 'pick' as const, ids: ['CR-1', 'CR-2'] },
    { scope: 'pick' as const, ids: ['CR-1', 'CR-2'], shareId: 'share-1' },
    { scope: 'all' as const, audience: 'agent' as const, visitorId: 'c-9' },
  ];

  it('builds the same query for the same choices', () => {
    for (const c of cases) {
      const web = new URL(
        buildShowcaseShareLink({
          baseUrl: 'https://acme.convoreal.com',
          includeRef: false,
          audience: 'client',
          ...c,
        })
      );
      const phone = new URL(
        applyShowcaseScope('https://acme.convoreal.com/?ref=acc-1', {
          audience: 'client',
          ...c,
        })
      );
      phone.searchParams.delete('ref');
      expect([...phone.searchParams.entries()]).toEqual([
        ...web.searchParams.entries(),
      ]);
    }
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

  it('[PIPE-002] computes card fees and stage totals with the web module itself', () => {
    // The screen used to carry its own copy of brokerageAmount. It now
    // imports the web rule at runtime, so there is no copy left to drift.
    expect(mobile).toContain("from '@shared/lib/pipelines/deal-money'");
    expect(mobile).toContain('dealFeeLabel(deal, { currency })');
    expect(mobile).toContain('stageTotalsLabel(stageTotals(stageDeals)');
    expect(mobile).not.toContain('function dealBrokerage');
    expect(webSource('lib/pipelines/deal-money.ts')).toContain(
      "import { brokerageAmount } from './brokerage';"
    );

    // The brokerage sheet's preview still mirrors brokerageAmount.
    expect(mobile).toContain(
      "return type === 'fixed' ? value : ((dealValue ?? 0) * value) / 100;"
    );

    // Same inputs, same answer on both surfaces.
    expect(
      brokerageAmount({
        dealValue: 162000000,
        type: 'percentage',
        value: 0.7,
      })
    ).toBe(1134000);
    expect(
      dealFee({
        value: 162000000,
        brokerage_type: 'percentage',
        brokerage_value: 0.7,
      })
    ).toBe(1134000);
    expect(
      dealFee({ value: 162000000, brokerage_type: 'percentage' })
    ).toBeNull();
  });
});

describe('[PRP-007] property enquiries remain actionable on web and mobile', () => {
  const webForm = webSource('components/inventory/property-form.tsx');
  const webEnquiriesTab = webSource(
    'components/inventory/property-enquiries-tab.tsx'
  );
  const mobile = mobileSource('app/(app)/property/[id].tsx');

  it('shows explicit enquiries separately from preference matches', () => {
    for (const source of [webForm, mobile]) {
      expect(source).toContain('Enquired Contacts');
      expect(source).toContain('enquiredAudienceContacts');
      expect(source).toContain('Matching Contacts');
    }
    expect(webForm).toContain('<PropertyEnquiriesTab');
  });

  it('keeps contact, call, message and follow-up actions on both surfaces', () => {
    for (const label of ['View contact', 'Call', 'Message', 'Follow up']) {
      expect(webEnquiriesTab, `web lacks ${label}`).toContain(label);
      expect(mobile, `mobile lacks ${label}`).toContain(label);
    }
    expect(mobile).toContain('eventType=follow_up');
    expect(webEnquiriesTab).toContain('ScheduleDialog');
    expect(mobile).toContain('dialableAudiencePhone');
    expect(webEnquiriesTab).toContain('dialableAudiencePhone');
    expect(mobile).toContain('onLongPress');
    expect(mobile).toContain('PropertyInterestFollowUpSheet');
    expect(webEnquiriesTab).toContain('PropertyInterestFollowUpDialog');
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

  it('[TXW-030] puts the money on its own tab, right after the overview', () => {
    expect(DEAL_WORKSPACE_TABS.slice(0, 2)).toEqual([
      { id: 'overview', label: 'Overview' },
      { id: 'money', label: 'Money' },
    ]);
    expect(mobileVocab).toContain(
      "{ id: 'overview', label: 'Overview' },\n  { id: 'money', label: 'Money' },"
    );
    expect(mobileScreen).toContain(
      "{tab === 'money' && (\n          <FinancialsTab"
    );
    expect(mobileScreen).toContain('<OverviewTab');
    expect(mobileScreen).toContain('stage_id, value, currency,');
    expect(mobileScreen).toContain("const currency = head?.currency ?? 'INR';");
    expect(mobileScreen).toContain('formatDealAmount(amount, currency)');
    expect(mobileScreen).not.toContain(
      '<OverviewFigure label="Deal value" value={formatInr('
    );
  });

  it('[TXW-033] a milestone tick flips on the spot on both surfaces through the one shared rule', () => {
    expect(mobileScreen).toContain(
      "import {\n  applyMilestonePatch,\n  withMilestoneRow,\n} from '@shared/lib/deals/milestones';"
    );
    expect(mobileScreen).toContain(
      '(rows) => rows && applyMilestonePatch(rows, milestoneId, { status })'
    );
    expect(mobileScreen).toContain(
      '(rows) => rows && withMilestoneRow(rows, previousRow)'
    );
    expect(mobileScreen.match(/void tickMilestone\(/g)).toHaveLength(3);
    expect(mobileScreen).not.toContain('updateDealMilestone(dealId, m.id, {');
    expect(mobileScreen.match(/= useBusyIds\(\);/g)).toHaveLength(2);
    expect(mobileScreen).toContain('?.some((row) => remaining.has(row.id));');
    for (const panel of [
      'components/deals/deal-milestones-panel.tsx',
      'components/deals/deal-overview-panel.tsx',
    ]) {
      const source = webSource(panel);
      expect(source).toContain('applyMilestonePatch(rows, m.id,');
      expect(source).toContain(
        '(rows) => rows && withMilestoneRow(rows, previousRow)'
      );
      expect(source).toContain('= useBusyIds();');
      expect(source).toContain('?.some((row) => remaining.has(row.id));');
      expect(source).not.toContain('busyId');
    }
  });

  it('[TXW-009] prints a stakeholder number with exactly one plus sign on both surfaces', () => {
    const body = (source: string) =>
      source.match(
        /export function formatStakeholderPhone\([\s\S]*?\n\}\n/
      )?.[0];
    const web = body(webSource('lib/deals/stakeholders.ts'));
    expect(web).toBeDefined();
    expect(body(mobileVocab)).toBe(web);
    expect(mobileScreen).toContain('formatStakeholderPhone(s.phone)');
    expect(mobileScreen).not.toContain('` · +${s.phone}`');
    expect(formatStakeholderPhone('+919833902005')).toBe('+919833902005');
    expect(formatStakeholderPhone('919833902005')).toBe('+919833902005');
  });

  it('[PIPE-001] opens the Deals board flat on both surfaces and remembers the choice under one key', () => {
    const mobileHook = mobileSource('lib/board-layout-preference.ts');
    const webHook = webSource('hooks/useBoardLayout.ts');
    for (const source of [mobileHook, webHook]) {
      expect(source).toContain('BOARD_LAYOUT_STORAGE_KEY');
      expect(source).toContain('parseBoardLayout(');
      expect(source).toContain('DEFAULT_BOARD_LAYOUT');
    }
    expect(mobileHook).toContain("from '@shared/lib/pipelines/board-layout'");
    expect(DEFAULT_BOARD_LAYOUT).toBe('flat');
    expect(parseBoardLayout(null)).toBe('flat');
    expect(parseBoardLayout('wheel')).toBe('wheel');
    const mobileList = mobileSource('app/(app)/deals.tsx');
    expect(mobileList).toContain('useBoardLayout()');
    expect(mobileList).toContain('BOARD_LAYOUTS.map(');
    expect(mobileList).toContain('<SectionList<Deal, FlatSection>');
    expect(mobileList).toContain('? flatStageOrder(stages ?? [])');
    expect(mobileList).toContain(
      "const OUTCOME_ORDER: readonly PipelineOutcome[] = [\n  'active',\n  'successful',\n  'lost',\n];"
    );
    expect(mobileList).toContain('scrollToLocation({');
    expect(
      webSource('app/(dashboard)/pipelines/pipelines-content.tsx')
    ).toContain('useBoardLayout()');
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

  it('[TXW-032] attributes a timeline entry by the same rule on both surfaces', () => {
    expect(mobileVocab).toContain(
      "from '@shared/lib/deals/timeline-attribution';"
    );
    expect(mobileVocab).not.toMatch(/export function timelineActorLabel/);
    expect(webSource('lib/deals/events.ts')).toContain(
      "from './timeline-attribution';"
    );
    const eventRow = mobileVocab.match(
      /export interface DealEventRow \{[^}]*\}/
    )?.[0];
    expect(eventRow).toContain('actor_id: string | null;');
    expect(eventRow).toContain("source: 'web' | 'mobile' | 'api' | 'system';");
    expect(mobileScreen).toContain('timelineActorLabel(ev)');
    expect(mobileScreen).toContain('timelineSourceLabel(ev)');
    expect(mobileScreen).toContain('eventByline(latest)');
    expect(mobileScreen).not.toMatch(/\.actor_name \? ` · \$\{/);
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

  it('[TXW-001] leaves conversion to the server on both surfaces', () => {
    expect(webJourneySheet).not.toContain('/api/journey/convert-to-deal');
    expect(mobileApi).not.toContain('/api/journey/convert-to-deal');
    expect(mobileJourney).not.toContain('convertJourneyItemToDeal');
  });

  it('[JRN-018] opens a live branch’s deal on its own, with no convert step on either surface', () => {
    expect(webJourneySheet).not.toContain('Convert to deal');
    expect(mobileJourney).not.toContain('Convert to deal');
    expect(webJourneySheet).toContain('Open transaction');
    expect(webJourneySheet).toContain(
      'Joins the Board as a deal at this stage as soon as it is live on the journey.'
    );
    expect(mobileJourney).toContain('accessibilityLabel="Open deal"');
    expect(webJourneySheet).toContain(".eq('source_journey_item_id', item.id)");
    expect(mobileJourney).toContain(
      'deal:deals!deals_source_journey_item_id_fkey(id)'
    );
    expect(mobileJourney).toContain('{linkedDealId(item) ? (');
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
      'return row.milestones_total > 0;',
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
    expect(
      isClosingRecord({ source_journey_item_id: 'j1', milestones_total: 0 })
    ).toBe(false);
  });

  it('[TXW-026] filters the Board to Focus journeys through one database rule on both surfaces', () => {
    const webBoard = webSource(
      'app/(dashboard)/pipelines/pipelines-content.tsx'
    );
    for (const source of [webBoard, mobileList]) {
      expect(source).toContain("useState<BoardScope>('focus')");
      expect(source).toContain("rpc('board_focus_deal_ids'");
      expect(source).toContain('[BOARD_FOCUS_QUERY_KEY, accountId,');
    }
    const webFocus = webSource('lib/deals/board-focus.ts');
    for (const line of [
      "{ id: 'focus', label: 'Focus' },",
      "{ id: 'all', label: 'All' },",
      "export const BOARD_FOCUS_QUERY_KEY = 'board-focus';",
      "if (scope === 'all') return [...deals];",
      'if (!focusIds) return [];',
      'return deals.filter((deal) => focus.has(deal.id));',
    ]) {
      expect(webFocus).toContain(line);
      expect(mobileVocab, `mobile drifted at: ${line}`).toContain(line);
    }
    expect(mobileVocab).not.toContain('isFocusedDeal');
    expect(mobileSource('app/(app)/journey.tsx')).toContain(
      'queryKey: [BOARD_FOCUS_QUERY_KEY]'
    );
  });

  it('[TXW-029] refreshes the Focus board, records and dashboard after every deal save on both surfaces', () => {
    const webKeys = webSource('lib/deals/board-focus.ts');
    for (const line of [
      '[BOARD_FOCUS_QUERY_KEY],',
      "['dashboard'],",
      "['transaction-workspace-index'],",
    ]) {
      expect(webKeys).toContain(line);
    }
    for (const line of [
      "['deals'],",
      '[BOARD_FOCUS_QUERY_KEY],',
      "['transaction-index'],",
      "['overview'],",
      '[HOME_WIDGET_QUERY_KEY],',
    ]) {
      expect(mobileVocab).toContain(line);
    }
    expect(
      webSource('app/(dashboard)/pipelines/pipelines-content.tsx')
    ).toContain('onSaved={handleDealSaved}');
    expect(
      mobileSource('app/(app)/deal-edit.tsx').match(
        /for \(const queryKey of DEAL_SAVED_QUERY_KEYS\)/g
      )
    ).toHaveLength(2);
    for (const source of [
      mobileSource('app/(app)/deals.tsx'),
      mobileSource('app/(app)/deal/[id].tsx'),
      webSource('components/deals/deal-workspace.tsx'),
    ]) {
      expect(source).toContain('DEAL_SAVED_QUERY_KEYS.map((queryKey)');
    }
    expect(
      webSource('app/(dashboard)/pipelines/pipelines-content.tsx').match(
        /for \(const queryKey of DEAL_SAVED_QUERY_KEYS\)/g
      )
    ).toHaveLength(3);
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
        "shouldCaptureBrokerage(stage) && dealStatusForStage(stage) !== 'lost'"
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

  it('[PRP-015] leaves the listing status a stage move sets to the shared deal route', () => {
    const mobileSemantics = mobileSource('lib/stage-semantics.ts');
    expect(mobileSemantics).not.toContain('propertyStatusForPipelineStage');
    for (const source of [mobileScreen, mobileList]) {
      expect(source).toContain('await moveDealStage(');
      expect(source).toContain('current_stage_name: stage.name');
    }
    expect(mobileApi).toContain('`/api/deals/${dealId}`');
    expect(webSource('app/api/deals/[id]/route.ts')).toContain(
      "propertyStatusForPipelineStage(movedStage) ?? 'Available'"
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
      'return deal.brokerage_amount === null && shouldCaptureBrokerage(stage);'
    );
    for (const source of [webWorkspace, mobileScreen, mobileList]) {
      expect(source).toContain('needsBrokerageCapture(');
      expect(source).toContain('brokerage_type: brokerageType');
      expect(source).toContain('brokerage_value: Number(brokerageValue)');
    }
  });

  it('moves the pipeline stage from the workspace header through the deal PATCH', () => {
    expect(webWorkspace).toContain('dealStatusForStage(stage)');
    expect(webWorkspace).toContain('target_stage_id: stage.id');
    expect(webWorkspace).toContain('current_stage_name: stage.name');
    expect(mobileScreen).toContain('dealStatusForStage(stage)');
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
    expect(webSidebar).not.toContain("href: '/journey'");
    expect(webSidebar).toContain("href: '/deals'");
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
      "'sync_journey_stages_from_pipeline'"
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
    expect(stageMove).toMatch(
      /setListingStatusFromDeal\(\s*ctx\.supabase,\s*ctx\.accountId,/
    );
    expect(webSource('lib/inventory/listing-status-sync.ts')).toContain(
      'p_account_id: accountId,'
    );
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
    expect(settings).toContain(".from('journey_items')");
    expect(settings).toContain("'Move journey items out of this stage first'");
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

describe('mobile/lib/import-counts.ts mirrors import-activity', () => {
  // The chip replaces an always-on "Added to inventories" link on both
  // cards; a count worded differently per surface would read as two
  // different facts about the same listing.
  const source = mobileSource('lib/import-counts.ts');

  it('builds the same label', () => {
    expect(source).toContain(
      "`Shared by ${count} ${count === 1 ? 'agent' : 'agents'}`"
    );
    expect(importCountLabel(2)).toBe('Shared by 2 agents');
  });

  it('reads the same endpoint on both surfaces', () => {
    expect(mobileSource('app/(app)/(tabs)/properties.tsx')).toContain(
      "'/api/properties/import-counts'"
    );
    expect(
      webSource('app/(dashboard)/inventory/inventory-content.tsx')
    ).toContain("'/api/properties/import-counts'");
  });
});

describe('[SHR-003] the web modules the mobile bundle runs are dependency-free', () => {
  it('imports nothing at runtime but other src/ files by relative path', () => {
    // mobile/metro.config.js bundles `@shared/*` runtime imports straight
    // from src/ and refuses any package, alias or built-in such a module
    // imports. That refusal only fires in the mobile CI job, which runs
    // on mobile/** changes — so a web PR adding `import … from 'date-fns'`
    // to a shared module would pass here and break the next OTA. This
    // walks the same graph from the web side. `import type` and
    // type-only re-exports are erased before Metro sees them.
    const srcRoot = join(process.cwd(), 'src');
    const mobileRoot = join(process.cwd(), 'mobile');
    const SHARED = '@shared/';

    const runtimeSpecifiers = (file: string): string[] => {
      const source = ts.createSourceFile(
        file,
        readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true
      );
      const out: string[] = [];
      const visit = (node: ts.Node) => {
        if (
          ts.isImportDeclaration(node) &&
          ts.isStringLiteral(node.moduleSpecifier)
        ) {
          const clause = node.importClause;
          const typeOnly =
            !!clause &&
            (clause.isTypeOnly ||
              (!clause.name &&
                !!clause.namedBindings &&
                ts.isNamedImports(clause.namedBindings) &&
                clause.namedBindings.elements.length > 0 &&
                clause.namedBindings.elements.every((e) => e.isTypeOnly)));
          if (!typeOnly) out.push(node.moduleSpecifier.text);
        } else if (
          ts.isExportDeclaration(node) &&
          node.moduleSpecifier &&
          ts.isStringLiteral(node.moduleSpecifier)
        ) {
          const typeOnly =
            node.isTypeOnly ||
            (!!node.exportClause &&
              ts.isNamedExports(node.exportClause) &&
              node.exportClause.elements.length > 0 &&
              node.exportClause.elements.every((e) => e.isTypeOnly));
          if (!typeOnly) out.push(node.moduleSpecifier.text);
        } else if (
          ts.isCallExpression(node) &&
          (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
            (ts.isIdentifier(node.expression) &&
              node.expression.text === 'require'))
        ) {
          const [arg] = node.arguments;
          out.push(arg && ts.isStringLiteral(arg) ? arg.text : '<dynamic>');
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
      return out;
    };
    const resolveFile = (base: string): string | null => {
      for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
        if (existsSync(base + ext)) return base + ext;
      }
      return null;
    };
    const rel = (file: string) => file.slice(process.cwd().length + 1);

    const entries = new Set<string>();
    for (const dir of ['app', 'components', 'lib']) {
      for (const file of modulePathsUnder(mobileRoot, dir)) {
        if (/\.test\.tsx?$/.test(file)) continue;
        for (const spec of runtimeSpecifiers(file)) {
          if (!spec.startsWith(SHARED)) continue;
          const resolved = resolveFile(
            join(srcRoot, spec.slice(SHARED.length))
          );
          expect(resolved, `${rel(file)} imports ${spec}`).not.toBeNull();
          entries.add(resolved as string);
        }
      }
    }
    expect(entries.has(join(srcRoot, 'lib/calendar/archive-sort.ts'))).toBe(
      true
    );

    const problems: string[] = [];
    const seen = new Set<string>();
    const queue = [...entries];
    while (queue.length > 0) {
      const file = queue.pop() as string;
      if (seen.has(file)) continue;
      seen.add(file);
      for (const spec of runtimeSpecifiers(file)) {
        const next = /^\.\.?(\/|$)/.test(spec)
          ? resolveFile(join(dirname(file), spec))
          : null;
        if (!next || !next.startsWith(srcRoot + '/')) {
          problems.push(`${rel(file)} imports "${spec}"`);
        } else {
          queue.push(next);
        }
      }
    }
    expect(
      problems,
      `these web modules are bundled into the mobile app through @shared/ ` +
        `but import something other than a src/ file by relative path, ` +
        `which mobile/metro.config.js refuses: ${problems.join('; ')}`
    ).toEqual([]);

    const ciMobileFilter = readFileSync(
      join(process.cwd(), '.github/workflows/ci.yml'),
      'utf8'
    ).match(/\n {12}mobile:\n((?: {14}(?:- .*|#.*)\n)+)/)?.[1];
    const otaTrigger = readFileSync(
      join(process.cwd(), '.github/workflows/eas-update.yml'),
      'utf8'
    ).match(/\n {4}paths:\n((?: {6}(?:- .*|#.*)\n)+)/)?.[1];
    expect(ciMobileFilter, 'ci.yml mobile path filter').toBeDefined();
    expect(otaTrigger, 'eas-update.yml push paths').toBeDefined();
    for (const file of [...seen].map(rel).sort()) {
      expect(
        ciMobileFilter,
        `${file} ships in the mobile bundle, so ci.yml's mobile filter must run the mobile job when it changes`
      ).toContain(`- '${file}'`);
      expect(
        otaTrigger,
        `${file} ships in the mobile bundle, so eas-update.yml must publish when it changes`
      ).toContain(`- '${file}'`);
    }
  });
});

describe('contact language is one tap from the record on both surfaces', () => {
  it('[ALS-002] the mobile program reaches no server-only web subtree', () => {
    // Mobile type-checks every web module reachable from its @shared/
    // imports, and each of those modules' own imports, however deep. A
    // single type-only edge from requirements/profiles.ts to the AI
    // extractor once pulled Gemini, the notification dispatcher and 18
    // WhatsApp modules into that program for a type naming none of them.
    //
    // Walking it here keeps the cost from creeping back silently: the
    // edge would be added on the web side, which is what this suite runs
    // on.
    const forbidden = [
      'lib/whatsapp/',
      'lib/notifications/',
      'lib/ai/gemini',
      'lib/supabase/',
      'lib/credits/',
      'lib/billing/',
    ];
    const srcRoot = join(process.cwd(), 'src');
    const resolveSpec = (spec: string, fromDir: string): string | null => {
      const base = spec.startsWith('@/')
        ? join(srcRoot, spec.slice(2))
        : spec.startsWith('.')
          ? join(fromDir, spec)
          : null;
      if (!base) return null;
      for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
        if (existsSync(base + ext)) return base + ext;
      }
      return null;
    };

    // preProcessFile covers every import form TypeScript follows: both
    // quote styles, side-effect imports, re-exports and dynamic import().
    const specifiersIn = (file: string) =>
      ts
        .preProcessFile(readFileSync(file, 'utf8'), true, true)
        .importedFiles.map((ref) => ref.fileName);

    const mobileFiles = [
      ...modulePathsUnder(join(process.cwd(), 'mobile'), 'lib'),
      ...modulePathsUnder(join(process.cwd(), 'mobile'), 'components'),
      ...modulePathsUnder(join(process.cwd(), 'mobile'), 'app'),
    ];
    const entries = new Set<string>();
    const SHARED = '@shared/';
    for (const file of mobileFiles) {
      for (const spec of specifiersIn(file)) {
        if (!spec.startsWith(SHARED)) continue;
        const resolved = resolveSpec(`@/${spec.slice(SHARED.length)}`, srcRoot);
        if (resolved) entries.add(resolved);
      }
    }
    expect(entries.size).toBeGreaterThan(0);

    const seen = new Set<string>();
    const queue = [...entries];
    const reachedBy = new Map<string, string>();
    while (queue.length > 0) {
      const file = queue.pop() as string;
      if (seen.has(file)) continue;
      seen.add(file);
      const dir = dirname(file);
      for (const spec of specifiersIn(file)) {
        const next = resolveSpec(spec, dir);
        if (next && !seen.has(next)) {
          if (!reachedBy.has(next)) reachedBy.set(next, file);
          queue.push(next);
        }
      }
    }

    const leaked = [...seen]
      .map((f) => f.slice(srcRoot.length + 1))
      .filter((rel) => forbidden.some((prefix) => rel.startsWith(prefix)))
      .sort();
    expect(
      leaked,
      `the mobile typecheck now reaches server-only web code: ` +
        `${leaked
          .map((rel) => {
            const via = reachedBy.get(join(srcRoot, rel));
            return via ? `${rel} (via ${via.slice(srcRoot.length + 1)})` : rel;
          })
          .join(', ')}. Move the type it needs to a leaf module instead.`
    ).toEqual([]);
  });

  it('[ALS-001] no mobile module shadows a web module of the same path', () => {
    // mobile/tsconfig.json resolves `@/*` against the mobile root first
    // and ../src second, for every file in that program — including the
    // web modules @shared/ pulls in. A mobile module sitting at a path a
    // web module imports as `@/<path>` therefore shadows the web one for
    // that import, silently. mobile/lib/languages.ts did this to
    // src/lib/languages.ts and broke the mobile typecheck on main.
    //
    // mobile/lib/alias-shadowing.test.ts asserts the same thing from the
    // other side: each CI job only sees its own half of a diff, so this
    // copy is what catches a WEB file added under an existing mobile path.
    const skip = new Set([
      'node_modules',
      '.expo',
      '.git',
      'dist',
      'build',
      'ios',
      'android',
    ]);
    const modulePaths = (root: string, dir = '', out: string[] = []) => {
      const full = dir ? join(root, dir) : root;
      if (!existsSync(full)) return out;
      for (const entry of readdirSync(full)) {
        if (skip.has(entry)) continue;
        const rel = dir ? `${dir}/${entry}` : entry;
        if (statSync(join(root, rel)).isDirectory()) {
          modulePaths(root, rel, out);
        } else if (/\.tsx?$/.test(entry) && !/\.d\.ts$/.test(entry)) {
          out.push(rel.replace(/\.tsx?$/, '').replace(/\/index$/, ''));
        }
      }
      return out;
    };
    const mobileRoot = join(process.cwd(), 'mobile');
    const srcRoot = join(process.cwd(), 'src');
    // Every file TypeScript would try for `@/<spec>`, index included: a
    // mobile `types.ts` resolves the same specifier as src/types/index.ts.
    const resolves = (root: string, spec: string) =>
      ['.ts', '.tsx', '/index.ts', '/index.tsx'].some((ext) =>
        existsSync(join(root, spec + ext))
      );
    const specs = modulePaths(mobileRoot);
    expect(specs.length).toBeGreaterThan(200);
    const shadowed = specs.filter((spec) => resolves(srcRoot, spec));
    expect(
      shadowed,
      `these paths exist under both mobile/ and src/, so the mobile one ` +
        `shadows the web one for every web file in the mobile program that ` +
        `imports it as "@/<path>": ${shadowed.join(', ')}`
    ).toEqual([]);
  });

  it('[CLG-002] mobile mirrors the product language registry', () => {
    const source = mobileSource('lib/contact-languages.ts');
    for (const code of LANGUAGE_CODES) {
      const { label, native } = SUPPORTED_LANGUAGES[code];
      expect(source).toContain(
        `${code}: { label: '${label}', native: '${native}' }`
      );
    }
    const mirrored = [...source.matchAll(/^  ([a-z]{2}): \{ label:/gm)].map(
      (m) => m[1]
    );
    expect(mirrored).toEqual(LANGUAGE_CODES);
  });

  it('[CLG-002] both surfaces change the language through the shared route with a follow-the-account-default choice', () => {
    const web = webSource('components/contacts/contact-detail-view.tsx');
    const mobile = mobileSource('app/(app)/contact/[id].tsx');
    for (const screen of [web, mobile]) {
      expect(screen).toContain('/language`');
      expect(screen).toContain("method: 'PATCH'");
      expect(screen).toContain('LANGUAGE_CODES.map(');
    }
    expect(web).toContain('setContactLanguage(null)');
    expect(web).toContain('Follow account default');
    expect(mobile).toContain('FOLLOW_ACCOUNT_DEFAULT_LABEL');
    for (const screen of [web, mobile]) {
      expect(screen).toContain('default_language');
      expect(screen).toContain('Language: account default (');
    }
    expect(mobile).toContain('preferred_language, buyer_alerts_consent');
  });
});

describe('mobile/lib/attachments.ts mirrors media-kinds', () => {
  // Both surfaces stage an attachment before sending it, and both check
  // it first so an oversized pick costs nothing. If the two copies
  // disagree, one surface accepts a file the staging route then refuses
  // with a different sentence — or, worse, offers a cap Meta does not.
  const source = mobileSource('lib/attachments.ts');

  it('[INB-013] carries the same per-kind caps', () => {
    for (const [kind, limit] of Object.entries(MEDIA_SIZE_LIMITS)) {
      const mb = limit / (1024 * 1024);
      expect(source, `missing ${kind} cap`).toContain(
        `${kind}: ${mb} * 1024 * 1024`
      );
    }
  });

  it('[INB-013] accepts exactly the types Meta accepts', () => {
    for (const mimeType of SUPPORTED_MEDIA_MIME_TYPES) {
      expect(source, `missing ${mimeType}`).toContain(`'${mimeType}'`);
    }
  });

  it('[INB-013] refuses a file in the same words the route would', () => {
    const { attachmentRejection } = mobileModule<{
      attachmentRejection: (
        mimeType: string,
        sizeBytes: number
      ) => string | null;
    }>('lib/attachments.ts');

    for (const [mimeType, size] of [
      ['audio/webm', 4096],
      ['video/mp4', 40 * 1024 * 1024],
      ['image/jpeg', 2048],
    ] as const) {
      expect(attachmentRejection(mimeType, size)).toBe(
        rejectMedia(mimeType, size)?.error ?? null
      );
    }
  });
});

describe('mobile deal document upload mirrors the web one', () => {
  // Both surfaces stage into the same signed path and file the same row
  // afterwards. If either drifts, one of them uploads a file the other's
  // route will not accept — which is how a 50 MB folder ended up with a
  // 4.5 MB ceiling nobody could see.
  const mobile = mobileSource('lib/deal-workspace-api.ts');
  const web = webSource('lib/deals/upload-document.ts');

  it('[INV-008] carries the same size cap as the server', () => {
    const mb = DOCUMENT_SIZE_LIMIT / (1024 * 1024);
    expect(mobileSource('lib/deal-workspace.ts')).toContain(
      `DEAL_DOCUMENT_SIZE_LIMIT = ${mb} * 1024 * 1024`
    );
  });

  it('[INV-008] stages through the same two routes on both surfaces', () => {
    for (const source of [mobile, web]) {
      expect(source).toContain('/documents/upload-url');
      expect(source).toContain('storage_path');
    }
  });

  it('[INV-008] names the file type on the upload, which storage requires', () => {
    // A PUT that reaches Supabase without a usable content-type is
    // answered 400 invalid_mime_type, whatever the bucket allows.
    expect(mobileSource('lib/api.ts')).toContain(
      "'content-type': opts.contentType"
    );
    expect(web).toContain("'content-type': mime_type");
  });
});

describe('[TXW-019] bundles are created from both surfaces through one route', () => {
  const mobileVocab = mobileSource('lib/deal-workspace.ts');
  const mobileApi = mobileSource('lib/deal-workspace-api.ts');
  const mobileScreen = mobileSource('app/(app)/deal/[id].tsx');
  const webDialog = webSource('components/deals/deal-bundle-dialog.tsx');
  const webWorkspace = webSource('components/deals/deal-workspace.tsx');

  it('posts to /api/deal-groups and reads a bundle back from it', () => {
    expect(webDialog).toContain("fetch('/api/deal-groups'");
    expect(webDialog).toContain('`/api/deal-groups/${group.id}`');
    expect(mobileApi).toContain("'/api/deal-groups'");
    expect(mobileApi).toContain('`/api/deal-groups/${groupId}`');
    expect(mobileScreen).toContain('createDealGroup');
    expect(mobileScreen).toContain('fetchDealGroup');
    expect(webWorkspace).toContain('DealBundleDialog');
  });

  it('holds the route limits and the default name on both surfaces', () => {
    expect(mobileVocab).toContain(`BUNDLE_MIN_DEALS = ${BUNDLE_MIN_DEALS}`);
    expect(mobileVocab).toContain(`BUNDLE_MAX_DEALS = ${BUNDLE_MAX_DEALS}`);
    expect(mobileVocab).toContain(`BUNDLE_NAME_MAX = ${BUNDLE_NAME_MAX}`);
    expect(mobileVocab).toContain(
      "return (who ? `${who} — linked purchases` : 'Linked purchases')"
    );
    expect(mobileVocab).toContain(
      '.filter((r) => r.id !== anchor.id && !r.deal_group_id)'
    );
    expect(mobileVocab).toContain(
      'const aSame =\n        Boolean(anchor.contact_id) && a.contact_id === anchor.contact_id;'
    );
    for (const message of [
      bundleBlocker('', 2),
      bundleBlocker('x', 1),
      bundleBlocker('x', BUNDLE_MAX_DEALS + 1),
    ]) {
      expect(message).not.toBeNull();
      expect(mobileVocab).toContain(
        message!.replace('20', '${BUNDLE_MAX_DEALS}')
      );
    }
    expect(defaultBundleName('Adithi')).toBe('Adithi — linked purchases');
    expect(
      bundleCandidates(
        [
          {
            id: 'b',
            title: 'B',
            contact_id: 'c1',
            contact_name: null,
            property_title: null,
            property_unit_no: '20',
            stage_name: null,
            deal_group_id: null,
          },
          {
            id: 'a',
            title: 'A',
            contact_id: 'c1',
            contact_name: null,
            property_title: null,
            property_unit_no: '19',
            stage_name: null,
            deal_group_id: null,
          },
        ],
        { id: 'a', contact_id: 'c1' }
      ).map((r) => r.id)
    ).toEqual(['b']);
  });
});

describe('[TXW-020] deal deadlines reach both surfaces from the Focus snapshot', () => {
  const mobileFocus = mobileSource('lib/focus.ts');
  const mobileScreen = mobileSource('app/(app)/focus.tsx');
  const webFocus = webSource('app/(dashboard)/dashboard/focus-content.tsx');
  const webToday = webSource('app/(dashboard)/today/today-content.tsx');
  const digest = webSource('lib/agents/task-digest.ts');
  const focusQueries = webSource('lib/focus/queries.ts');

  it('labels every urgency identically and words the distance the same way', () => {
    expect(mobileFocus).toContain("} from '@shared/lib/deals/deadline-rules';");
    expect(mobileFocus).not.toContain('export function deadlineLabel');
    expect(deadlineLabel(-1)).toBe('Overdue by 1 day');
  });

  it('carries the same deadline shape on the snapshot and renders it on both screens', () => {
    expect(mobileFocus).toContain('items: DealDeadline[];');
    expect(mobileFocus).toContain('deadlines: FocusDeadlines;');
    expect(focusQueries).toContain('loadDealDeadlines(');
    expect(mobileScreen).toContain('Deal deadlines');
    expect(mobileScreen).toContain('deadlineLabel(d.daysLeft)');
    expect(webFocus).toContain('Deal deadlines');
    expect(webFocus).toContain('deadlineLabel(d.daysLeft)');
    expect(webToday).toContain('loadDealDeadlines(');
  });

  it('groups deadlines per deal and badges stale requests the same way on both screens', () => {
    expect(mobileFocus).toContain("} from '@shared/lib/focus/requests';");
    expect(webFocus).toContain(
      "import { requestBadge, summarizeRequests } from '@/lib/focus/requests';"
    );
    expect(webFocus).toContain('groupDeadlinesByDeal(');
    expect(webFocus).toContain('summarizeRequests(');
    expect(mobileScreen).toContain('groupDeadlinesByDeal(');
    expect(mobileScreen).toContain('requestBadge(request)');
    expect(mobileScreen).toContain('summarizeRequests(');
  });

  it('reads the same SQL rule from the digest and never a hand-rolled query', () => {
    expect(digest).toContain('loadDealDeadlineRowsForAccount(');
    expect(digest).toContain('deadlinesForAgent(');
    expect(digest).not.toContain("from('deal_milestones')");
    expect(focusQueries).not.toContain("from('deal_milestones')");
    expect(webToday).not.toContain("from('deal_milestones')");
  });
});

describe('[CAL-008] deal dates are pinned on both calendars through the one deadline rule', () => {
  const mobileDealDates = mobileSource('lib/deal-calendar.ts');
  const webCalendar = webSource('app/(dashboard)/calendar/page.tsx');
  const mobileCalendar = mobileSource('app/(app)/(tabs)/calendar.tsx');
  const mobileUpcoming = mobileSource('lib/calendar-upcoming.ts');

  it('labels the three kinds identically and reads every open date on both', () => {
    for (const [kind, label] of Object.entries(DEAL_DATE_KIND_LABELS)) {
      expect(
        mobileDealDates,
        `mobile is missing the "${kind}" label`
      ).toContain(`${kind}: '${label}'`);
    }
    expect(mobileDealDates).toContain(
      `export const DEAL_DATE_HORIZON_DAYS = ${DEAL_DATE_HORIZON_DAYS.toLocaleString('en-US').replace(',', '_')};`
    );
    expect(webCalendar).toContain('DEAL_DATE_HORIZON_DAYS)');
    expect(mobileCalendar).toContain('DEAL_DATE_HORIZON_DAYS)');
    expect(mobileDealDates).toContain('a.dueDate.localeCompare(b.dueDate) ||');
    for (const field of ['assignedTo', 'ownerUserId']) {
      expect(mobileDealDates, `mobile DealDate lacks ${field}`).toMatch(
        new RegExp(`^  ${field}: `, 'm')
      );
    }
  });

  it('both calendars read deal_deadlines and never query the milestone tables themselves', () => {
    expect(webCalendar).toContain(
      'loadDealDeadlines(supabase, accountId!, todayKey, DEAL_DATE_HORIZON_DAYS)'
    );
    expect(webCalendar).toContain('dealDatesInRange(');
    expect(mobileCalendar).toContain("supabase.rpc('deal_deadlines', {");
    expect(mobileCalendar).toContain('dealDatesInRange(');
    expect(mobileDealDates).toContain(
      `export const DEAL_DATE_PAGE_SIZE = ${DEAL_DEADLINE_PAGE_SIZE};`
    );
    expect(mobileDealDates).toContain(
      `export const DEAL_DATE_PAGE_ORDER = [\n${DEAL_DEADLINE_PAGE_ORDER.map((c) => `  '${c}',`).join('\n')}\n] as const;`
    );
    expect(mobileCalendar).toContain('}, DEAL_DATE_PAGE_SIZE);');
    expect(mobileCalendar).toContain(
      'for (const column of DEAL_DATE_PAGE_ORDER) {'
    );
    for (const table of ['deal_milestones', 'deal_payment_tranches']) {
      expect(webCalendar).not.toContain(`from('${table}')`);
      expect(webCalendar).not.toContain(`from("${table}")`);
      expect(mobileCalendar).not.toContain(`from('${table}')`);
    }
  });

  it('pins each date on its day and opens the deal record on both surfaces', () => {
    expect(webSource('components/calendar/month-cell.tsx')).toContain(
      'href={dealDateHref(d.dealId)}'
    );
    expect(webCalendar).toContain('dealDateLocalDay(d.dueDate).toDateString()');
    expect(mobileCalendar).toContain(
      '<Link href={dealDateHref(dealDate.dealId)} asChild>'
    );
    expect(mobileCalendar).toContain('dayKey(dealDateLocalDay(d.dueDate))');
    expect(mobileCalendar).toContain('...dayDealDates.map((dealDate) => ({');
    expect(mobileCalendar).toContain('key={dealDateKey(item.dealDate)}');
    expect(mobileCalendar).toContain("if (state === 'active') rollDay();");
    expect(mobileCalendar).toContain('useFocusEffect(');
    expect(mobileCalendar).toContain(
      'setInterval(() => rollDayRef.current(), 60_000)'
    );
    expect(webCalendar).toContain(
      'const timer = setInterval(rollDay, 60_000);'
    );
    expect(webCalendar).toContain(
      'if (localDateKey(currentDate) === todayKey) setCurrentDate(new Date());'
    );
    expect(webCalendar).toContain(
      'const [todayKey, setTodayKey] = useState(() => todayDateKey());'
    );
    expect(mobileCalendar).toContain('label="Deal dates"');
    expect(webCalendar).toContain('{DEAL_DATE_META.label}');
    expect(mobileCalendar).toContain('void refetchDealDatesRef.current();');
    expect(webCalendar).toContain(
      "view === 'team' && typeFilter === 'deal' ? 'all' : typeFilter;"
    );
    expect(mobileUpcoming).toContain(
      "| { kind: 'deal'; dueAt: number; dealDate: D };"
    );
  });
});

describe('[CAL-009] the to-do list is lightweight on both surfaces', () => {
  const webCalendar = webSource('app/(dashboard)/calendar/page.tsx');
  const mobileCalendar = mobileSource('app/(app)/(tabs)/calendar.tsx');
  const mobileTodos = mobileSource('lib/todos.ts');

  it('lists to-dos alone and never folds appointments into the list', () => {
    expect(webCalendar).toContain('const visibleTodos = useMemo(() => {');
    expect(webCalendar).not.toContain('isAppointment');
    expect(webCalendar).not.toContain('resolveMentions');
    expect(webCalendar).not.toContain('mentionType');
    expect(mobileCalendar).toContain(
      'await addTodo({ accountId, title: trimmed, priority, dueDate });'
    );
  });

  it('keeps done to-dos in one collapsed group and clears them the same way on both surfaces', () => {
    expect(webCalendar).toContain("} from '@/lib/calendar/todo-groups';");
    expect(mobileCalendar).toContain(
      "} from '@shared/lib/calendar/todo-groups';"
    );
    expect(webCalendar).toContain('splitTodosByCompletion(visibleTodos)');
    expect(mobileCalendar).toContain('splitTodosByCompletion(remainingTodos)');
    expect(webCalendar).toContain('useState(false);\n  const [clearingTodos');
    expect(mobileCalendar).toContain(
      'const [doneOpen, setDoneOpen] = useState(false);'
    );
    expect(webCalendar).toContain('confirm(clearCompletedPrompt(ids.length))');
    expect(mobileCalendar).toContain(
      "title: 'Clear completed',\n      message: clearCompletedPrompt(todos.length),"
    );
    expect(webCalendar).toContain('completedTodoIds(doneTodos)');
    expect(mobileCalendar).toContain(
      'deleteCompletedTodos(completedTodoIds(todos))'
    );
    expect(mobileTodos).toContain(
      'export async function deleteCompletedTodos('
    );
    expect(webCalendar).toContain('{todoTitle.trim() && (');
    expect(mobileCalendar).toContain('{title.trim() ? (');
  });

  it('deleting a to-do and cancelling an appointment offer Undo on both surfaces', () => {
    expect(webCalendar).toContain(
      "action: { label: 'Undo', onClick: () => void restoreTodo(todo) },"
    );
    expect(webCalendar).toContain(
      "onClick: () => void setAppointmentStatus(appt, 'scheduled'),"
    );
    expect(webCalendar).not.toContain(
      "confirm('Are you sure you want to delete this task?')"
    );
    expect(mobileTodos).toContain('export async function restoreTodo(');
    expect(mobileCalendar).toContain('showUndo(`Deleted "${todo.title}"`');
    expect(mobileCalendar).toContain(
      'await restoreTodo(todo as unknown as Record<string, unknown>);'
    );
    expect(mobileCalendar).toContain(
      "showUndo('Cancelled — it stays on its day', async () => {"
    );
    expect(mobileCalendar).toContain("if (!(await setStatus('scheduled'))) {");
  });

  it('a deal task links back to its deal on both surfaces', () => {
    expect(mobileTodos).toContain('deal_id: string | null;');
    expect(webCalendar).toContain('href={dealDateHref(todo.deal_id)}');
    expect(mobileCalendar).toContain(
      '<Link href={dealDateHref(todo.deal_id)} asChild>'
    );
    expect(webCalendar).toContain(
      'href={`/contacts?contactId=${todo.contact_id}`}'
    );
    expect(webCalendar).toContain(
      'href={`/inventory?propertyId=${todo.property_id}`}'
    );
    expect(mobileCalendar).toContain(
      '<Link href={`/(app)/contact/${todo.contact.id}`} asChild>'
    );
    expect(mobileCalendar).toContain(
      '<Link href={`/(app)/property/${todo.property.id}`} asChild>'
    );
    const webSmartAdd = webSource('components/calendar/smart-add-bar.tsx');
    expect(webSmartAdd).toContain(
      "contact_id: kind === 'todo' ? null : resolved?.contact?.id || null"
    );
    expect(webSmartAdd).toContain(
      "property_id: kind === 'todo' ? null : resolved?.property?.id || null"
    );
  });
});

describe('[CAL-010] appointment status changes are offered identically on both surfaces', () => {
  const mobileTasks = mobileSource('lib/calendar-tasks.ts');
  const mobileCalendar = mobileSource('app/(app)/(tabs)/calendar.tsx');
  const webTasksList = webSource('components/calendar/tasks-list.tsx');
  const webCalendar = webSource('app/(dashboard)/calendar/page.tsx');

  it('labels every status and offers the same actions per status', () => {
    for (const [status, label] of Object.entries(APPOINTMENT_STATUS_LABELS)) {
      expect(mobileTasks).toContain(`${status}: '${label}'`);
    }
    for (const status of ['scheduled', 'completed', 'cancelled'] as const) {
      for (const action of appointmentStatusActions(status)) {
        expect(mobileTasks).toContain(
          `{ status: '${action.status}', label: '${action.label}' }`
        );
      }
    }
    expect(webTasksList).toContain(
      'appointmentStatusActions(event.status).map('
    );
    expect(mobileCalendar).toContain(
      'appointmentStatusActions(appointment.status).map('
    );
    expect(mobileCalendar).toContain(
      "canEdit && !editingDetails && appointment.status !== 'scheduled'"
    );
    expect(webTasksList).toContain('{canEdit && (');
    expect(webCalendar).toContain('`/api/appointments/${appt.id}`');
    expect(mobileCalendar).toContain('`/api/appointments/${appointment.id}`');
    expect(mobileCalendar).toContain(
      "{ method: 'PUT', body: JSON.stringify({ status }) }"
    );
    expect(mobileCalendar).not.toContain('.update({ status })');
  });

  it('ticks a milestone through the deal route on both surfaces and opens other deal dates', () => {
    expect(webCalendar).toContain(
      '`/api/deals/${d.dealId}/milestones/${d.milestoneId}`'
    );
    expect(webCalendar).toContain(
      "body: JSON.stringify({ status: 'completed', source: 'web' })"
    );
    expect(mobileCalendar).toContain(
      'await updateDealMilestone(dealDate.dealId, dealDate.milestoneId, {'
    );
    expect(mobileCalendar).toContain("status: 'completed',");
    expect(webTasksList).toContain(
      "canEdit && dealDate.kind === 'milestone' && dealDate.milestoneId"
    );
    expect(mobileCalendar).toContain(
      "canEdit && dealDate.kind === 'milestone' && dealDate.milestoneId"
    );
    expect(webCalendar).toContain('const canEdit = !isViewer && !isReadOnly;');
    expect(webCalendar).toContain(
      'onClick={() => openContactChat(todo.contact_id!)}'
    );
    expect(mobileCalendar).toContain(
      'await openContactChat(todo.contact!, {\n                  draftText: draft.message,\n                });'
    );
  });

  it('keeps a cancelled appointment listed on both surfaces and gives the Agenda the same rows', () => {
    const mobileUpcoming = mobileSource('lib/calendar-upcoming.ts');
    const webAgenda = webSource('components/calendar/agenda-view.tsx');
    expect(mobileUpcoming).not.toContain("appointment.status === 'scheduled'");
    expect(mobileCalendar).not.toContain(".eq('status', 'scheduled')");
    expect(webAgenda).toContain('<AppointmentTaskRow');
    expect(webAgenda).toContain('<DealDateTaskRow');
    expect(webAgenda).toContain('onStatusChange={onStatusChange}');
    expect(webAgenda).toContain('onDone={onMilestoneDone}');
  });
});

describe('[CAL-011] done and cancelled events are archived the same way on both surfaces', () => {
  const mobileTasks = mobileSource('lib/calendar-tasks.ts');
  const mobileCalendar = mobileSource('app/(app)/(tabs)/calendar.tsx');
  const webTasksList = webSource('components/calendar/tasks-list.tsx');
  const webAgenda = webSource('components/calendar/agenda-view.tsx');
  const webCalendar = webSource('app/(dashboard)/calendar/page.tsx');

  it('[CAL-012] imports the archive and sort rules from the one web module on both surfaces', () => {
    expect(mobileTasks).toContain(
      "export * from '@shared/lib/calendar/archive-sort';"
    );
    expect(webSource('lib/calendar/tasks-view.ts')).toContain(
      "export * from './archive-sort';"
    );
    for (const source of [
      mobileTasks,
      webSource('lib/calendar/tasks-view.ts'),
    ]) {
      expect(source).not.toContain(
        'export interface ArchivableAppointmentLike'
      );
      expect(source).not.toContain('export function sortTasksByTime');
      expect(source).not.toContain('export const ARCHIVED_VIEWS');
    }
  });

  it('shares the archive rule and writes it through the archive route only', () => {
    const archiveSort = webSource('lib/calendar/archive-sort.ts');
    expect(archiveSort).toContain(
      `export const ARCHIVE_BATCH_LIMIT = ${WEB_ARCHIVE_BATCH_LIMIT};`
    );
    expect(archiveSort).toContain("return status !== 'scheduled';");
    expect(archiveSort).toContain(
      'return !!appointment.archived_at && canArchiveAppointment(appointment.status);'
    );
    expect(webCalendar).toContain("fetch('/api/appointments/archive', {");
    expect(
      mobileCalendar.match(/'\/api\/appointments\/archive'/g)
    ).toHaveLength(2);
    expect(webCalendar).toContain('for (const chunk of chunkIds(ids)) {');
    expect(mobileCalendar).toContain(
      'for (const chunk of chunkIds(monthArchive.archivableIds)) {'
    );
    expect(mobileCalendar).not.toContain('archived_at:');
  });

  it('[CAL-011] greys out or hides archived events on the calendar grid on both surfaces', () => {
    expect(webCalendar).toContain(
      'calendarAppointments.visible.forEach((appt) => {'
    );
    expect(
      webCalendar.match(/events=\{calendarAppointments\.visible\}/g)
    ).toHaveLength(2);
    expect(webCalendar).toContain('events={listedAppointments.visible}');
    expect(webCalendar).not.toContain('events={filteredAppointments}');
    expect(webCalendar).toContain(
      'withoutArchivedAppointments(\n        filteredAppointments,\n        archivedOnCalendar(archivedView)'
    );
    expect(mobileCalendar).toContain('archivedOnCalendar(archivedView)');
    expect(webCalendar).toContain(
      "const archivedView = archivedViewQuery.data ?? 'greyed';"
    );
    expect(mobileCalendar).toContain(
      "const archivedView = archivedViewQuery.data ?? 'greyed';"
    );
    for (const source of [webCalendar, mobileCalendar]) {
      expect(source).toContain(
        'return toArchivedView(data?.calendar_archived_view);'
      );
      expect(source).toContain('.update({ calendar_archived_view: view })');
      expect(source).toContain(
        'archivedViewWrites.current = archivedViewWrites.current.then(async () => {'
      );
      expect(source).toContain('if (write === archivedViewLatest.current)');
    }
    expect(mobileCalendar).toContain('void refetchArchivedView();');
    expect(webSource('components/calendar/month-cell.tsx')).toContain(
      'isArchivedAppointment(appt) && ARCHIVED_EVENT_CHIP'
    );
    for (const view of ['week-view.tsx', 'team-view.tsx']) {
      expect(webSource(`components/calendar/${view}`)).toContain(
        'isArchivedAppointment(ev) && ARCHIVED_EVENT_CHIP'
      );
    }
    expect(mobileCalendar).toContain(
      "a.status === 'cancelled' ||\n                                isArchivedAppointment(a)"
    );
  });

  it('offers Archive on a finished event, Archive done and Show archived on both surfaces', () => {
    expect(webTasksList).toContain('canArchiveAppointment(event.status) && (');
    expect(mobileCalendar).toContain(
      'canArchiveAppointment(appointment.status) ? ('
    );
    expect(webCalendar).toContain(
      "archiveAppointments(\n                        archivableTaskIds,\n                        true,\n                        'archive-done'"
    );
    expect(mobileCalendar).toContain(
      '...(upcomingAppointmentsQuery.data ?? [])]'
    );
    expect(webCalendar).toContain('ARCHIVED_VIEWS.map((mode) => (');
    expect(mobileCalendar).toContain('ARCHIVED_VIEWS.map((mode) => (');
    expect(webAgenda).not.toContain('Show archived');
    expect(webCalendar).toContain(
      'withoutArchivedAppointments(\n        filteredAppointments,\n        archivedInLists(archivedView)'
    );
    expect(
      mobileCalendar.match(/archivedInLists\(archivedView\)/g)
    ).toHaveLength(2);
    expect(mobileCalendar).toContain('withoutArchivedAppointments(');
  });
});

describe('[CAL-012] tasks are sorted by date and time the same way on both surfaces', () => {
  const mobileTasks = mobileSource('lib/calendar-tasks.ts');
  const mobileCalendar = mobileSource('app/(app)/(tabs)/calendar.tsx');
  const webCalendar = webSource('app/(dashboard)/calendar/page.tsx');

  it('shares the sort modes and defaults both lists to Upcoming first', () => {
    const archiveSort = webSource('lib/calendar/archive-sort.ts');
    for (const [mode, label] of Object.entries(TASK_SORT_LABELS)) {
      expect(archiveSort).toContain(`${mode}: '${label}'`);
    }
    expect(archiveSort).toMatch(
      /TASK_SORT_MODES: TaskSortMode\[\] = \[\s*'upcoming',\s*'earliest',\s*'latest',?\s*\]/
    );
    expect(archiveSort).toContain(
      'return day === today ? 0 : day > today ? 1 : 2;'
    );
    expect(mobileTasks).toContain(
      "export * from '@shared/lib/calendar/archive-sort';"
    );
    expect(webCalendar).toContain("useState<TaskSortMode>('upcoming')");
    expect(mobileCalendar).toContain("useState<TaskSortMode>('upcoming')");
    expect(webCalendar).toContain('sortTasksByTime(');
    expect(mobileCalendar.match(/sortTasksByTime\(/g)).toHaveLength(2);
  });
});

describe('[TXW-021] the payment schedule ships on both surfaces through one route', () => {
  const mobileVocab = mobileSource('lib/deal-workspace.ts');
  const mobileApi = mobileSource('lib/deal-workspace-api.ts');
  const mobileScreen = mobileSource('app/(app)/deal/[id].tsx');
  const webPanel = webSource('components/deals/deal-tranches-panel.tsx');
  const webFinancials = webSource('components/deals/deal-financials-panel.tsx');

  it('reads and writes tranches through /api/deals/[id]/tranches on both surfaces', () => {
    expect(webPanel).toContain('`/api/deals/${dealId}/tranches`');
    expect(webPanel).toContain('`/api/deals/${dealId}/tranches/${t.id}`');
    expect(mobileApi).toContain('`/api/deals/${dealId}/tranches`');
    expect(mobileApi).toContain('`/api/deals/${dealId}/tranches/${trancheId}`');
    expect(webFinancials).toContain('DealTranchesPanel');
    expect(mobileScreen).toContain(
      '<TranchesSection dealId={dealId} canEdit={canEdit} />'
    );
  });

  it('labels every tranche status identically and offers the same label suggestions', () => {
    for (const [status, label] of Object.entries(TRANCHE_STATUS_LABELS)) {
      expect(
        mobileVocab,
        `mobile is missing the "${status}" tranche label`
      ).toContain(`${status}: '${label}'`);
    }
    for (const suggestion of TRANCHE_LABEL_SUGGESTIONS) {
      expect(mobileVocab).toContain(`'${suggestion}'`);
    }
  });

  it('decides received, part, overdue and due by the same rule and sums nothing itself', () => {
    expect(mobileVocab).toContain(
      "if (received >= t.amount && (t.received_at || received > 0))\n    return 'received';"
    );
    expect(mobileVocab).toContain("if (received > 0) return 'partial';");
    expect(mobileVocab).toContain("if (t.due_date < today) return 'overdue';");
    expect(mobileVocab).toContain("if (t.due_date === today) return 'due';");
    expect(mobileVocab).not.toMatch(/scheduled\s*[-+]\s*received/);
    expect(mobileScreen).toContain('data.summary.outstanding');
    expect(webPanel).toContain('data.summary.outstanding');
  });
});

describe('[TXW-023] co-broking ships on both surfaces through one route', () => {
  const mobileVocab = mobileSource('lib/deal-workspace.ts');
  const mobileApi = mobileSource('lib/deal-workspace-api.ts');
  const mobileScreen = mobileSource('app/(app)/deal/[id].tsx');
  const mobileDeals = mobileSource('app/(app)/deals.tsx');
  const webPanel = webSource('components/deals/deal-co-broking-panel.tsx');
  const webFinancials = webSource('components/deals/deal-financials-panel.tsx');
  const webBoard = webSource('components/pipelines/pipeline-board.tsx');

  it('reads and writes co-broking through /api/deals/[id]/co-broking on both surfaces', () => {
    expect(webPanel).toContain('`/api/deals/${dealId}/co-broking`');
    expect(webPanel).toContain('`/api/deals/${dealId}/co-broking/payouts`');
    expect(webPanel).toContain(
      '`/api/deals/${dealId}/co-broking/payouts/${p.id}`'
    );
    expect(mobileApi).toContain('`/api/deals/${dealId}/co-broking`');
    expect(mobileApi).toContain('`/api/deals/${dealId}/co-broking/payouts`');
    expect(mobileApi).toContain(
      '`/api/deals/${dealId}/co-broking/payouts/${payoutId}`'
    );
    expect(webFinancials).toContain('<DealCoBrokingPanel');
    expect(mobileScreen).toContain(
      '<CoBrokingSection dealId={dealId} canEdit={canEdit} />'
    );
  });

  it('labels positions and payout states identically', () => {
    for (const [key, label] of Object.entries(DEAL_POSITION_LABELS)) {
      expect(mobileVocab, `mobile is missing the "${key}" position`).toContain(
        `${key}: ${JSON.stringify(label).includes("'") ? JSON.stringify(label) : `'${label}'`}`
      );
    }
    for (const [key, label] of Object.entries(PAYOUT_STATUS_LABELS)) {
      expect(mobileVocab).toContain(`${key}: '${label}'`);
    }
  });

  it('decides paid by the same rule, reads the server totals and counts the net share', () => {
    expect(mobileVocab).toContain(
      "if (paid >= p.amount && (p.paid_at || paid > 0)) return 'paid';"
    );
    expect(mobileScreen).toContain('data.summary.net');
    expect(webPanel).toContain('data.summary.net');
    expect(mobileScreen).toContain('!profile.is_read_only');
    expect(mobileScreen).toContain('label="Not linked"');
    expect(webPanel).toContain('Not linked');
    for (const field of ['share_percent:', 'stakeholder_id:']) {
      expect(mobileScreen).toContain(field);
      expect(webPanel).toContain(field);
    }
    for (const total of ['payouts', 'paid_out', 'to_pay']) {
      expect(mobileScreen).toContain(`data.summary.${total}`);
      expect(webPanel).toContain(`data.summary.${total}`);
    }
    expect(mobileDeals).toContain("from '@shared/lib/pipelines/deal-money'");
    expect(webSource('lib/pipelines/deal-money.ts')).toContain(
      'return netOfPayouts('
    );
    expect(
      dealFee({ brokerage_amount: 100000, co_broker_payout_total: 40000 })
    ).toBe(60000);
    expect(webBoard).toContain('stageTotals(stageDeals)');
    expect(webBoard).toContain("from '@/lib/pipelines/deal-money'");
  });
});

describe('[TXW-022] the Records index shows and sorts by the expected close on both surfaces', () => {
  const mobileVocab = mobileSource('lib/deal-workspace.ts');
  const mobileScreen = mobileSource('app/(app)/deals.tsx');
  const webIndex = webSource(
    'components/deals/transaction-workspace-index.tsx'
  );

  it('offers the same sort choices and reads the same columns', () => {
    for (const option of RECORDS_SORTS) {
      expect(mobileVocab).toContain(
        `{ id: '${option.id}', label: '${option.label}' }`
      );
    }
    expect(mobileVocab).toContain('expected_close_date: string | null;');
    expect(mobileVocab).toContain('actual_close_date: string | null;');
    expect(mobileScreen).toContain('sortIndexRows(rows, sort)');
    expect(webIndex).toContain('sortIndexRows(rows, sort)');
    expect(mobileScreen).toContain('expectedCloseLabel(item, today)');
    expect(webIndex).toContain('expectedCloseLabel(row, today)');
  });

  it('labels and orders the close date by one rule', () => {
    expect(mobileVocab).toContain(
      "return { text: `Closed ${row.actual_close_date}`, tone: 'done' };"
    );
    expect(mobileVocab).toContain(
      'if (aClosed !== bClosed) return aClosed ? 1 : -1;'
    );
    expect(mobileVocab).toContain("tone: soon ? 'soon' : 'later',");
  });
});

describe('[EKH-002] the e-Khata proposal is built by one rule on both surfaces', () => {
  const mobile = mobileModule<typeof EKhataWeb>('lib/e-khata-fields.ts');
  const raw = {
    epid: '7425317720',
    khata_form: 'Form-A',
    corporation: 'Bangalore South City Corporation',
    address: 'NO.436, 18TH MAIN ROAD, KORAMANGALA, BANGALORE, 560095',
    latitude: 77.6238418,
    longitude: 12.9408126,
    site_dimensions_ft: { east_west: 68, north_south: 50 },
    site_area_sqft: '3,401',
    floors: [
      { area_sqft: 4119, occupancy: 'Rented', year_built: 1983 },
      { area_sqft: 706, occupancy: 'Rented', year_built: 1983 },
    ],
    owners: ['ANJALI KAPUR XXXXXXXX3304 ABCDE1234F'],
    tax_year: '2026-27',
    tax_paid: 81614,
    liabilities: 'NA',
    boundaries: { west: 'Road' },
  };
  const now = new Date('2026-09-24T00:00:00Z');

  it('sanitises, proposes and summarises identically', () => {
    const web = EKhataWeb.sanitiseEKhata(raw, now);
    expect(mobile.sanitiseEKhata(raw, now)).toEqual(web);
    for (const opts of [{}, { isLand: true }, { isApartment: true }]) {
      expect(
        mobile.eKhataChanges(
          web,
          { city: 'Bengaluru', built_up_area: 4000 },
          opts
        )
      ).toEqual(
        EKhataWeb.eKhataChanges(
          web,
          { city: 'Bengaluru', built_up_area: 4000 },
          opts
        )
      );
    }
    expect(mobile.eKhataNotes(web)).toEqual(EKhataWeb.eKhataNotes(web));
    for (const name of ['E KHATHA - A.pdf', 'brochure.pdf']) {
      expect(mobile.looksLikeEKhata(name)).toBe(
        EKhataWeb.looksLikeEKhata(name)
      );
    }
    expect(mobile.E_KHATA_MAX_BYTES).toBe(EKhataWeb.E_KHATA_MAX_BYTES);
  });
});

describe('mobile/lib/guidance-value.ts mirrors the web rate line', () => {
  const mobile = mobileModule<{ rateHeadline: typeof rateHeadline }>(
    'lib/guidance-value.ts',
    {
      './api':
        'export class ApiError extends Error {}\nexport async function apiFetch() {}',
      '@shared/lib/format/currency': webSource('lib/format/currency.ts'),
    }
  );

  it('[GVL-019] names the land class of an agricultural rate the same way', () => {
    expect(
      rateHeadline({
        rate: 952500,
        unit: 'acre',
        property_class: 'agricultural',
        land_class: 'dry',
      })
    ).toMatch(/ \/ acre · Agricultural · Dry land$/);
    for (const rate of [
      {
        rate: 952500,
        unit: 'acre' as const,
        property_class: 'agricultural' as const,
        land_class: 'dry' as const,
      },
      {
        rate: 1533000,
        unit: 'acre' as const,
        property_class: 'agricultural' as const,
        land_class: 'plantation' as const,
      },
      {
        rate: 3500,
        unit: 'sqm' as const,
        property_class: 'residential_site' as const,
      },
    ]) {
      expect(mobile.rateHeadline(rate).split(' / ')[1]).toBe(
        rateHeadline(rate).split(' / ')[1]
      );
    }
  });
});

describe('mobile/lib/guidance-value.ts mirrors the web RTC print line', () => {
  const mobile = mobileModule<{ schedulePrinted: typeof schedulePrinted }>(
    'lib/guidance-value.ts',
    {
      './api':
        'export class ApiError extends Error {}\nexport async function apiFetch() {}',
      '@shared/lib/format/currency': webSource('lib/format/currency.ts'),
    }
  );

  it('[GVL-013] shows the Kannada village and printed extent the same way', () => {
    for (const schedule of [
      {
        document_type: 'rtc' as const,
        village: 'Adduru',
        village_local: 'ಅಡ್ಡೂರು',
        extent_printed: '0.16.25.00',
      },
      { document_type: 'sale_deed' as const, extent_printed: '2.10.00' },
      { village: 'Koramangala' },
    ]) {
      expect(mobile.schedulePrinted(schedule)).toBe(schedulePrinted(schedule));
    }
  });
});

describe('[PLS-003] mobile Showcase Pulse forwarded-link label matches web', () => {
  const mobile = mobileModule<{
    pulseVisitorLabel: typeof pulseVisitorLabel;
  }>('lib/pulse-feed.ts');

  it('labels a forwarded-link guest via the sender on both surfaces', () => {
    const event = {
      contact: null,
      via_contact: { id: 'c-1', name: 'Ravi', phone: '+91' },
      share: null,
      session_key: 'e3e4ba9d-1234-4abc-8def-000000000000',
    };
    const timeAgo = () => '2h ago';
    expect(mobile.pulseVisitorLabel(event, timeAgo)).toBe(
      pulseVisitorLabel(event, timeAgo)
    );
    expect(pulseVisitorLabel(event, timeAgo)).toBe(
      "Guest via Ravi's link · e3e4ba9d"
    );
  });
});

describe('[PLS-001] mobile Showcase Pulse feed paging matches web', () => {
  const mobile = mobileModule<{
    PULSE_FEED_PAGE_SIZE: number;
    nextPulseFeedCursor: typeof nextPulseFeedCursor;
    pulseFeedCursorFilter: typeof pulseFeedCursorFilter;
  }>('lib/pulse-feed.ts');

  it('requests the same page size and resumes from the same cursor', () => {
    expect(mobile.PULSE_FEED_PAGE_SIZE).toBe(PULSE_FEED_PAGE_SIZE);
    const cursor = { createdAt: '2026-09-25T10:00:00.5+00:00', id: 'e9' };
    expect(mobile.pulseFeedCursorFilter(cursor)).toBe(
      pulseFeedCursorFilter(cursor)
    );
    for (const length of [
      0,
      1,
      PULSE_FEED_PAGE_SIZE - 1,
      PULSE_FEED_PAGE_SIZE,
    ]) {
      const rows = Array.from({ length }, (_, i) => ({
        id: `e${i}`,
        created_at: `2026-09-25T00:00:${String(i % 60).padStart(2, '0')}Z`,
      }));
      expect(mobile.nextPulseFeedCursor(rows)).toEqual(
        nextPulseFeedCursor(rows)
      );
    }
  });
});

describe('[PLS-004] mobile Showcase Pulse lists every viewed listing like web', () => {
  const mobile = mobileModule<{ PULSE_VIEWED_LISTINGS_LIMIT: number }>(
    'lib/pulse-feed.ts'
  );

  it('requests the same listing limit and scrolls the whole list', () => {
    expect(mobile.PULSE_VIEWED_LISTINGS_LIMIT).toBe(
      PULSE_VIEWED_LISTINGS_LIMIT
    );
    expect(mobileSource('lib/pulse.ts')).toContain(
      'p_limit: PULSE_VIEWED_LISTINGS_LIMIT'
    );
    const screen = mobileSource('app/(app)/pulse.tsx');
    expect(screen).toMatch(/<ScrollView\s+nestedScrollEnabled/);
    expect(screen).toContain('top.data.slice(0, renderedListings).map(');
  });
});

describe('[PLS-005] mobile Showcase Pulse sorts viewed listings like web', () => {
  it('uses the shared sort options and sends the chosen sort to the database', () => {
    const fetcher = mobileSource('lib/pulse.ts');
    expect(fetcher).toContain("from '@shared/lib/pulse/viewed-listings'");
    expect(fetcher).toContain("rpc('pulse_viewed_properties'");
    expect(fetcher).toContain('p_sort: sort');
    const screen = mobileSource('app/(app)/pulse.tsx');
    expect(screen).toContain('PULSE_LISTING_SORTS.map(');
    expect(screen).toContain(
      'Last viewed {formatTimeAgo(listing.lastViewedAt)}'
    );
  });
});

function interfaceFields(source: string, name: string): string[] {
  const match = source.match(
    new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`)
  );
  if (!match) throw new Error(`interface ${name} not found`);
  return [...match[1].matchAll(/^\s*(\w+)\??:/gm)]
    .map((field) => field[1])
    .sort();
}

describe('[SLP-006] seller page on mobile uses the same API as web', () => {
  const mobile = mobileModule<{
    sellerPagePath: (contactId: string) => string;
    updateSellerPage: (
      contactId: string,
      action: 'enable' | 'rotate' | 'disable'
    ) => Promise<{ path: string; init: { method: string; body?: string } }>;
  }>('lib/seller-page.ts', {
    '@/lib/api':
      'export async function apiFetch(path, init) { return { data: { path, init } }; }',
  });

  it('calls the contact seller-page route with the same verbs and bodies as the web dialog', async () => {
    expect(mobile.sellerPagePath('c1')).toBe('/api/contacts/c1/seller-page');
    expect(
      existsSync(
        join(process.cwd(), 'src/app/api/contacts/[id]/seller-page/route.ts')
      )
    ).toBe(true);
    await expect(mobile.updateSellerPage('c1', 'enable')).resolves.toEqual({
      path: '/api/contacts/c1/seller-page',
      init: { method: 'POST', body: JSON.stringify({ rotate: false }) },
    });
    await expect(mobile.updateSellerPage('c1', 'rotate')).resolves.toEqual({
      path: '/api/contacts/c1/seller-page',
      init: { method: 'POST', body: JSON.stringify({ rotate: true }) },
    });
    await expect(mobile.updateSellerPage('c1', 'disable')).resolves.toEqual({
      path: '/api/contacts/c1/seller-page',
      init: { method: 'DELETE' },
    });
    const web = webSource('components/contacts/seller-page-dialog.tsx');
    expect(web).toContain("method: action === 'disable' ? 'DELETE' : 'POST'");
    expect(web).toContain("JSON.stringify({ rotate: action === 'rotate' })");
  });

  it('reads the same status and Portfolio fields the server returns', () => {
    expect(
      interfaceFields(mobileSource('lib/seller-page.ts'), 'SellerPageStatus')
    ).toEqual(
      interfaceFields(
        webSource('lib/contacts/seller-page.ts'),
        'SellerPageStatus'
      )
    );
    const serverDen = interfaceFields(
      webSource('lib/den/seller-pages.ts'),
      'DenSellerPage'
    );
    expect(
      interfaceFields(mobileSource('lib/den-api.ts'), 'DenSellerPage')
    ).toEqual(serverDen);
    expect(
      interfaceFields(
        webSource('components/den/den-provider.tsx'),
        'DenSellerPage'
      )
    ).toEqual(serverDen);
  });

  it('offers the agency controls only to members who can edit, on both surfaces', () => {
    const mobileContact = mobileSource('app/(app)/contact/[id].tsx');
    expect(mobileContact).toContain(
      "const canMerge = useAuthStore((s) => s.profile?.account_role) !== 'viewer';"
    );
    expect(mobileContact).toMatch(
      /canMerge && contact\.classification !== 'Agent' \? \(\s*<ActionButton\s+icon="storefront-outline"/
    );
    expect(mobileContact).toMatch(
      /canMerge && contact\.classification !== 'Agent' \? \(\s*<SellerPageSheet/
    );
    const webContact = webSource('components/contacts/contact-detail-view.tsx');
    expect(webContact).toMatch(
      /canEditContacts && contact\.classification !== 'Agent' && \(\s*<button\s+onClick=\{\(\) => setSellerPageOpen\(true\)\}/
    );
  });

  it('mounts the agency sheet and the Portfolio card', () => {
    expect(mobileSource('app/(app)/contact/[id].tsx')).toContain(
      '<SellerPageSheet'
    );
    expect(mobileSource('app/(den)/den/index.tsx')).toContain(
      '<DenSellerPageCard'
    );
    expect(webSource('components/contacts/contact-detail-view.tsx')).toContain(
      '<SellerPageDialog'
    );
    expect(webSource('components/den/dashboard-content.tsx')).toContain(
      '<SellerPageCard'
    );
  });
});

describe('mobile/lib/personal-showcase.ts mirrors the showcase style resolver', () => {
  // An agent with no personal design follows the company one (PRP-021).
  // If the phone resolved it differently, the profile sheet would show a
  // design the agent's own link does not open in.
  const source = mobileSource('lib/personal-showcase.ts');
  const web = webSource('lib/showcase/style.ts');

  it.each(['toShowcaseStyle', 'resolveShowcasePresentation'])(
    '[PRP-021] keeps the %s body identical to the web source',
    (name) => {
      const body = (s: string) => {
        const start = s.indexOf(`export function ${name}`);
        expect(start, `${name} missing`).toBeGreaterThan(-1);
        return s.slice(start, s.indexOf('\n}', start));
      };
      expect(body(source)).toBe(body(web));
    }
  );

  it('[PRP-021] offers the same designs with the same agency swatches', () => {
    const styles = (s: string) =>
      s.slice(
        s.indexOf('export const SHOWCASE_STYLES'),
        s.indexOf('] as const;', s.indexOf('export const SHOWCASE_STYLES'))
      );
    expect(styles(source)).toBe(styles(web));
    for (const style of SHOWCASE_STYLES) {
      expect(source).toContain(`value: '${style}'`);
    }
    for (const design of AGENCY_SHOWCASE_DESIGNS) {
      expect(source).toContain(
        `value: '${design.value}',\n    label: '${design.label}',`
      );
      expect(source).toContain(
        `swatch: { background: '${design.background}', accent: '${design.accent}' }`
      );
    }
  });
});

describe('[CTM-013] the Contacts tab counts come from one SQL aggregate on both surfaces', () => {
  // Six count=exact HEAD requests per web load and four per mobile load,
  // each a real COUNT(*) over the account's contacts, with the staff
  // exclusion and the Transacted rule written differently on each side.
  const web = webSource('lib/contacts/list-queries.ts');
  const mobile = mobileSource('app/(app)/(tabs)/contacts.tsx');
  const migration = readFileSync(
    join(
      process.cwd(),
      'supabase/migrations/20261003174500_contacts_tab_counts.sql'
    ),
    'utf8'
  );

  it('both surfaces call contacts_tab_counts and no tab counts a table itself', () => {
    expect(web).toContain(
      ".rpc('contacts_tab_counts', { p_account_id: accountId })"
    );
    expect(mobile).toContain(
      ".rpc('contacts_tab_counts', { p_account_id: accountId })"
    );
    expect(
      web.match(/\.select\('id', \{ count: 'exact', head: true \}\)/g)
    ).toBeNull();
    expect(
      mobile.match(/\.select\('id', \{ count: 'exact', head: true \}\)/g)
    ).toBeNull();
    expect(mobile).not.toContain("supabase.from('deals').select('contact_id')");
  });

  it('the aggregate is account-scoped, member-guarded and keeps the tab rules', () => {
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain('WHERE is_account_member(p_account_id)');
    expect(migration).toContain('AND c.is_merged = false');
    expect(migration).toContain('AND c.chain_only = false');
    expect(migration).toContain(
      "count(*) FILTER (WHERE l.status = 'active' AND NOT l.is_archived)"
    );
    expect(migration).toContain(
      "count(*) FILTER (WHERE l.status = 'pending_review' AND NOT l.is_archived)"
    );
    expect(migration).toContain(
      'count(*) FILTER (WHERE l.is_favorite AND NOT l.is_archived)'
    );
    expect(migration).toContain("AND d.status = 'won'");
    expect(migration).toContain(
      "AND (l.lead_temp = 'HOT' OR l.last_inquired_property_id IS NOT NULL)"
    );
    expect(migration).toContain('count(*) FILTER (WHERE l.is_archived)');
    expect(migration).toContain(
      "WHERE regexp_replace(c.phone, '\\D', '', 'g') LIKE '%' || s.suffix"
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.contacts_tab_counts(UUID) TO authenticated;'
    );
  });
});

describe('the Today insights come from one SQL aggregate on both surfaces', () => {
  const web = webSource('lib/today/queries.ts');
  const mobile = mobileSource('lib/today.ts');
  const migration = readFileSync(
    join(
      process.cwd(),
      'supabase/migrations/20261004072000_today_insights_rpc.sql'
    ),
    'utf8'
  );

  it('both surfaces call today_insights with the account and map it through the shared helper', () => {
    for (const source of [web, mobile]) {
      expect(source).toContain(".rpc('today_insights', {");
      expect(source).toContain('p_account_id: accountId,');
      expect(source).toContain('.maybeSingle<TodayInsightsRow>();');
      expect(source).toContain('return toRangeInsights(data);');
      expect(source).not.toContain("count: 'exact'");
      expect(source).not.toMatch(
        /\.from\('messages'\)\n\s+\.select\('conversation_id, sender_type'\)/
      );
    }
    expect(mobile).toContain("from '@shared/lib/today/insights';");
    expect(web).toContain("from '@/lib/today/insights';");
  });

  it('the aggregate is member-guarded, account-scoped and keeps the old filters', () => {
    expect(migration).toContain('SECURITY INVOKER');
    expect(migration).not.toContain('SECURITY DEFINER');
    expect(migration).toContain('SET search_path = public');
    expect(migration).toContain('WHERE is_account_member(p_account_id);');
    for (const alias of ['m', 'c', 'ct', 'se']) {
      expect(migration).toContain(`${alias}.account_id = p_account_id`);
      expect(migration).toContain(`${alias}.created_at >= p_start`);
      expect(migration).toContain(`${alias}.created_at <= p_end`);
    }
    expect(migration).toContain("AND se.event_type = 'open'");
    expect(migration).toContain(
      "count(*) FILTER (WHERE m.sender_type = 'customer') AS received"
    );
    expect(migration).toContain(
      "count(*) FILTER (WHERE m.sender_type IS DISTINCT FROM 'customer') AS sent"
    );
    expect(migration).toContain(
      'count(*) FILTER (WHERE pc.last_outbound_at > pc.first_customer_at) AS responded'
    );
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.today_insights(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM anon;'
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.today_insights(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;'
    );
    expect(migration).not.toMatch(/\bDROP\b|ALTER TABLE|CREATE INDEX/);
  });
});

describe('[CTM-015] both contact lists select the one shared column spec', () => {
  // Web and mobile each carried their own select string for the contacts
  // list, so a column added for one surface was quietly missing on the
  // other. One dependency-free constant now feeds both reads.
  const web = webSource('lib/contacts/list-queries.ts');
  const screen = webSource('app/(dashboard)/contacts/contacts-content.tsx');
  const mobile = mobileSource('app/(app)/(tabs)/contacts.tsx');

  it('imports CONTACT_LIST_COLUMNS instead of carrying a select string', () => {
    expect(web).toContain(
      "import { CONTACT_LIST_COLUMNS } from '@/lib/contacts/list-columns';"
    );
    expect(web).toContain(".select(CONTACT_LIST_COLUMNS, { count: 'exact' })");
    expect(mobile).toContain(
      "import { CONTACT_LIST_COLUMNS } from '@shared/lib/contacts/list-columns';"
    );
    expect(mobile).toContain('CONTACT_LIST_COLUMNS +');
    expect(mobile).toContain(
      "(filters.tagId ? ', contact_tags!inner(tag_id)' : '')"
    );
    for (const source of [web, screen, mobile]) {
      expect(source).not.toContain("'id, user_id, name, name_tag");
      expect(source).not.toContain("'id, phone, name, name_tag");
    }
  });

  it('the spec is the union of both lists, with no column twice', () => {
    const columns = CONTACT_LIST_COLUMNS.split(',').map((c) => c.trim());
    expect(new Set(columns).size).toBe(columns.length);
    for (const column of [
      'id',
      'user_id',
      'avatar_url',
      'is_archived',
      'requirement_profiles',
      'buyer_alerts_consent',
      'buyer_alerts_consent_requested_at',
    ]) {
      expect(columns).toContain(column);
    }
  });
});

describe('broadcast composer asks for a message, never a template', () => {
  it('[BRC-001] both composers carry the message on the shared template through the same preview and refusal wording', () => {
    const mobile = mobileSource('app/(app)/broadcast-new.tsx');
    const webPage = webSource('app/(dashboard)/broadcasts/new/page.tsx');
    const webStep = webSource(
      'components/broadcasts/step1-compose-message.tsx'
    );
    const webHook = webSource('hooks/useBroadcastSending.ts');

    for (const composer of [mobile, webPage, webStep, webHook]) {
      expect(composer).not.toContain("from('message_templates')");
      expect(composer).not.toContain('step1-choose-template');
      expect(composer).not.toContain('step3-personalize');
    }
    expect(
      existsSync(
        join(
          process.cwd(),
          'src/components/broadcasts/step1-choose-template.tsx'
        )
      )
    ).toBe(false);
    expect(
      existsSync(
        join(process.cwd(), 'src/components/broadcasts/step3-personalize.tsx')
      )
    ).toBe(false);

    expect(mobile).toContain("from '@shared/lib/broadcasts/carrier-template'");
    expect(webStep).toContain("from '@/lib/broadcasts/carrier-template'");
    for (const composer of [mobile, webStep]) {
      expect(composer).toContain('previewBroadcastUpdate({');
      expect(composer).toContain('broadcastTemplateBlockReason(');
      expect(composer).toContain('broadcastMessageProblem(');
      expect(composer).toContain('BROADCAST_MESSAGE_MAX');
    }
    for (const client of [mobile, webHook]) {
      expect(client).toContain("'/api/broadcasts/template'");
      expect(client).toContain(
        "current.status === null ? read('POST') : current"
      );
      expect(client).toContain(
        "query.state.data?.status === 'PENDING' ? 30_000 : false"
      );
    }
    expect(mobile).toContain('body: JSON.stringify(payload)');
    for (const composer of [mobile, webHook, webPage]) {
      expect(composer).toContain('optedInOnly');
    }
    expect(mobile).toContain("'/api/contacts/consent-counts'");
    expect(webPage).toContain("'/api/contacts/consent-counts'");
    expect(mobile).toContain('JSON.stringify({ audience, optedInOnly })');
    expect(
      webSource('components/broadcasts/step4-schedule-send.tsx')
    ).toContain('useAudienceCount(audience, { optedInOnly })');
    expect(mobile).toContain('message: string;');
    expect(webHook).toContain('message: string;');
    expect(webPage).toContain("{ label: 'Message', key: 'message' }");
    expect(webPage).not.toContain("key: 'template'");
    expect(webPage).not.toContain("key: 'personalize'");
  });
});

describe('[PRP-049] matching contacts name what each contact enquired about earlier', () => {
  const webTab = webSource('components/inventory/property-matches-tab.tsx');
  const matchesRoute = webSource('app/api/properties/[id]/matches/route.ts');
  const mobileScreen = mobileSource('app/(app)/property/[id].tsx');
  const mobileLabel = mobileSource('lib/property-matches.ts');

  it('shows earlier enquiries by name on both surfaces, never the open listing', () => {
    expect(webTab).toContain('fetchInquiredProperties(');
    expect(webTab).toContain(
      'matchedContactIds,\n        3,\n        property?.id'
    );
    expect(webTab).toContain('.map(inquiredPropertyLabel)');
    expect(matchesRoute).toContain(
      'results.map(({ contact }) => contact.id),\n      3,\n      propertyId'
    );
    expect(mobileScreen).toContain('m.inquiries.map(inquiredPropertyLabel)');
    expect(mobileLabel).toContain(
      'return `${title} (${property.property_code})`;'
    );
  });

  it('keeps the multi-select share bar in view on web', () => {
    expect(webTab).toContain('sticky bottom-0');
    expect(webTab).toContain(
      'Share the Property Details ({selectedContactIds.length})'
    );
    expect(webTab).toContain('Clear {selectedContactIds.length} selected');
  });
});

describe('[PRP-051] "Not a fit" on matching contacts runs one rule on both surfaces', () => {
  const webPanel = webSource('components/inventory/match-not-a-fit.tsx');
  const webTab = webSource('components/inventory/property-matches-tab.tsx');
  const webForm = webSource('components/inventory/property-form.tsx');
  const matchesRoute = webSource('app/api/properties/[id]/matches/route.ts');
  const mobilePanel = mobileSource('components/match-not-a-fit.tsx');
  const mobileScreen = mobileSource('app/(app)/property/[id].tsx');
  const mobileLib = mobileSource('lib/property-matches.ts');

  it('takes the reasons and type options from the shared module', () => {
    for (const name of [
      'MATCH_REJECT_REASONS',
      'STAFF_PROPERTY_TYPE_OPTIONS',
      'matchRejectReasonLabel',
    ]) {
      expect(webPanel).toContain(name);
      expect(mobilePanel).toContain(name);
    }
    expect(mobilePanel).toContain("from '@shared/lib/match-feedback'");
  });

  it('hides rejected contacts the same way on both surfaces', () => {
    expect(webForm).toContain('partitionMatchesByFeedback(');
    expect(matchesRoute).toContain('partitionMatchesByFeedback(');
    expect(matchesRoute).toContain('hidden: hidden.map(');
    expect(mobileLib).toContain('hidden: hidden ?? []');
    expect(mobileLib).toContain('...set.hidden.map((row) => row.contact.id),');
    expect(webTab).toContain('prev.filter((id) => !hiddenIds.has(id))');
    expect(mobileScreen).toContain(
      'const selectedContacts = (matchesQuery.data?.matches ?? [])'
    );
  });

  it('offers the mark, the suggestion and the hidden list on both surfaces', () => {
    for (const source of [webTab, mobileScreen]) {
      expect(source).toContain('<NotAFitPanel');
      expect(source).toContain('<TypeSuggestion');
      expect(source).toContain('<HiddenMatches');
    }
    expect(matchesRoute).toContain("type === 'unknown'");
    expect(mobileScreen).toContain("m.details?.type === 'unknown'");
    expect(webTab).toContain("details.type === 'unknown'");
  });

  it('calls the same route', () => {
    expect(mobileLib).toContain('/match-feedback');
    expect(webSource('lib/inventory/match-feedback-request.ts')).toContain(
      '/match-feedback'
    );
  });
});

describe('[CAL-014] the calendar subscription link is managed the same way on both surfaces', () => {
  it('creates, resets and turns off the link through the one feed route', () => {
    const webDialog = webSource(
      'components/calendar/subscribe-feed-dialog.tsx'
    );
    const mobileScreen = mobileSource('app/(app)/calendar-feed.tsx');
    expect(webSource('app/(dashboard)/calendar/page.tsx')).toContain(
      '<SubscribeFeedDialog />'
    );
    expect(mobileSource('app/(app)/(tabs)/calendar.tsx')).toContain(
      '<Link href="/(app)/calendar-feed" asChild>'
    );
    expect(webDialog).toContain("fetch('/api/calendar/feed', { method })");
    expect(mobileScreen).toContain(
      "apiFetch<{ data: FeedStatus }>('/api/calendar/feed'"
    );
    for (const source of [webDialog, mobileScreen]) {
      for (const method of ["'GET'", "'POST'", "'DELETE'"]) {
        expect(source).toContain(`feedRequest(${method})`);
      }
      expect(source).toContain('Reset link');
      expect(source).toContain('Turn off');
      expect(source).toContain('google_url');
      expect(source).toContain('webcal_url');
    }
  });
});

describe('[CAL-015] Google Calendar sync is connected and managed the same way on both surfaces', () => {
  it('drives one set of routes and shares the error messages', () => {
    const web = webSource('components/calendar/google-calendar-sync.tsx');
    const mobile = mobileSource('components/google-calendar-sync.tsx');
    expect(
      webSource('components/calendar/subscribe-feed-dialog.tsx')
    ).toContain('<GoogleCalendarSync enabled={open} />');
    expect(mobileSource('app/(app)/calendar-feed.tsx')).toContain(
      '<GoogleCalendarSyncSection />'
    );
    expect(web).toContain("fetch('/api/google-calendar', { method })");
    expect(mobile).toContain("'/api/google-calendar',");
    expect(web).toContain("fetch('/api/google-calendar/oauth/start', {");
    expect(web).toContain("JSON.stringify({ client: 'web' })");
    expect(mobile).toContain("JSON.stringify({ client: 'mobile' })");
    expect(mobile).toContain("'/api/google-calendar/oauth/complete'");
    expect(web).toContain("from '@/lib/google-calendar/messages'");
    expect(mobile).toContain("from '@shared/lib/google-calendar/messages'");
    for (const source of [web, mobile]) {
      for (const method of ["'GET'", "'POST'", "'DELETE'"]) {
        expect(source).toContain(`googleRequest(${method})`);
      }
      for (const label of [
        'Connect Google Calendar',
        'Sync now',
        'Reconnect',
        'Disconnect',
      ]) {
        expect(source).toContain(label);
      }
    }
  });
});

describe('[CAL-016] the participant picker tells same-name contacts apart', () => {
  it('[CAL-016] shows name tag, classification, phone and a preview on mobile', () => {
    const mobileCalendar = mobileSource('app/(app)/(tabs)/calendar.tsx');
    expect(mobileCalendar).toContain('.select(CONTACT_LIST_COLUMNS)');
    expect(mobileCalendar).toContain('<ParticipantMeta');
    expect(mobileCalendar).toContain('<ContactPeekCard');
    expect(mobileCalendar).toContain('<Tag label={contact.name_tag} />');
    expect(mobileSource('app/(app)/(tabs)/contacts.tsx')).toContain(
      "import { ContactPeekCard } from '@/components/contact-peek-card';"
    );
  });

  it('[CAL-016] keeps edit-sheet choices visually apart from Save event', () => {
    const mobileCalendar = mobileSource('app/(app)/(tabs)/calendar.tsx');
    expect(mobileCalendar).toContain('WHATSAPP AFTER SAVING');
    expect(mobileCalendar).toMatch(
      /<ChoiceChip\s+label="Inform new participants"/
    );
    expect(mobileCalendar).not.toMatch(
      /<FilterChip\s+label="Inform new participants"/
    );
  });

  it('[CAL-016] shows name tag, classification and phone in the web picker', () => {
    const picker = webSource(
      'components/ui/searchable-contact-multi-select.tsx'
    );
    expect(picker).toContain('<NameTagBadge tag={contact.name_tag} />');
    expect(picker).toContain('{contact.classification}');
    expect(picker).toContain('{contact.phone ??');
    expect(picker).toContain('<ContactPeekLine contactId={contact.id} />');
    expect(webSource('components/contacts/contact-peek-line.tsx')).toContain(
      '.select(CONTACT_LIST_COLUMNS)'
    );
    for (const source of [
      webSource('app/(dashboard)/calendar/page.tsx'),
      webSource('components/calendar/schedule-dialog.tsx'),
    ]) {
      expect(source).toContain(
        "'id, name, phone, last_inquired_property_id, name_tag, classification'"
      );
      expect(source).toContain('previewable');
    }
  });
});

describe('[UIX-001] form choices never look like the submit button', () => {
  it('[UIX-001] renders the selected ChoiceChip as a tint, not a solid fill', () => {
    const ui = mobileSource('components/ui.tsx');
    const chip = ui.slice(
      ui.indexOf('export function ChoiceChip'),
      ui.indexOf('export function Tag')
    );
    expect(chip).toContain(
      'backgroundColor: selected ? colors.primarySoft : colors.surface'
    );
    expect(chip).toContain("accessibilityRole={multi ? 'checkbox' : 'radio'}");
    expect(chip).not.toContain('colors.onPrimary');
  });

  it('[UIX-001] uses ChoiceChip, not FilterChip, in forms with a submit button', () => {
    for (const file of [
      'app/(app)/broadcast-new.tsx',
      'app/(app)/deal-edit.tsx',
      'app/(app)/greetings.tsx',
      'app/(app)/journey.tsx',
      'app/(app)/property-edit.tsx',
      'app/(den)/den/settings.tsx',
      'components/flyer-sheet.tsx',
      'components/guidance-value-screen.tsx',
      'components/lost-reason-sheet.tsx',
      'components/property-share-sheet.tsx',
      'components/showcase-share-sheet.tsx',
    ]) {
      const source = mobileSource(file);
      expect(source, file).toContain('<ChoiceChip');
      expect(source, file).not.toContain('<FilterChip');
    }
    const deal = mobileSource('app/(app)/deal/[id].tsx');
    expect(deal).toMatch(/<ChoiceChip\s+label="Percentage \(%\)"/);
    expect(deal).toMatch(/<ChoiceChip\s+label="Fixed amount"/);
    expect(mobileSource('app/(app)/(tabs)/calendar.tsx')).toMatch(
      /<ChoiceChip\s+label="Inform new participants"/
    );
  });
});

describe('[UIX-002] web form choices never look like the submit button', () => {
  it('[UIX-002] draws selected options as a tint, not a solid fill', () => {
    expect(
      webSource('components/inventory/showcase-share-dialog.tsx')
    ).not.toContain(
      "'border-primary bg-primary text-primary-foreground shadow-primary/20 font-bold shadow-md'"
    );
    const picker = webSource('components/ui/date-time-picker.tsx');
    expect(picker).not.toContain(
      "? 'bg-primary text-primary-foreground font-semibold'"
    );
    expect(picker).not.toContain(
      'bg-gradient-to-tr to-violet-600 font-bold text-white'
    );
    expect(webSource('components/showcase/showcase-view.tsx')).toContain(
      "? 'border-primary/60 bg-primary/15 text-primary'"
    );
    for (const file of [
      'components/contacts/contact-form.tsx',
      'app/(dashboard)/broadcasts/greetings-content.tsx',
    ]) {
      expect(webSource(file), file).not.toMatch(
        /variant=\{(salutation|sendChannel|audienceType) === [^}]*\? 'default' : 'outline'\}/
      );
    }
  });
});

describe('[UIX-003] web and mobile start from the same defaults', () => {
  it('[UIX-003] reads every shared default from one web module', () => {
    const mobileContacts = mobileSource('app/(app)/(tabs)/contacts.tsx');
    expect(mobileContacts).toContain('DEFAULT_CONTACT_CLASSIFICATION');
    expect(mobileContacts).not.toContain("setClassification('Buyer')");
    expect(mobileSource('lib/types.ts')).toContain(
      "from '@shared/lib/contacts/classifications'"
    );
    expect(webSource('components/contacts/contact-form.tsx')).toContain(
      'DEFAULT_CONTACT_CLASSIFICATION'
    );
    expect(
      webSource('app/(dashboard)/contacts/contacts-content.tsx')
    ).toContain('CONTACT_CLASSIFICATIONS.map(');

    expect(mobileSource('app/(app)/appointment-new.tsx')).toContain(
      'eventTypeFromParam(params.eventType)'
    );
    expect(webSource('app/(dashboard)/calendar/page.tsx')).toContain(
      'useState<EventTypeKey>(DEFAULT_EVENT_TYPE)'
    );

    expect(mobileSource('lib/property-search-store.ts')).toContain(
      'includeUnavailable: true,'
    );

    const mobileDeals = mobileSource('app/(app)/deals.tsx');
    expect(mobileDeals).toContain('DEFAULT_RECORDS_STATUS_FILTER');
    expect(mobileDeals).toContain('title="Nothing matches"');
    expect(mobileDeals).not.toContain('stageId: activeStage');
    expect(
      webSource('components/deals/transaction-workspace-index.tsx')
    ).toContain('DEFAULT_RECORDS_STATUS_FILTER');

    expect(mobileSource('app/(app)/greetings.tsx')).toContain(
      'pickedOccasionId ?? occasions[0]?.id'
    );
  });
});

describe('[UIX-005] the same value reads the same way on web and mobile', () => {
  it('[UIX-005] formats list and clock times through one shared module', () => {
    const mobileFormat = mobileSource('lib/format.ts');
    expect(mobileFormat).toContain("from '@shared/lib/format/list-time'");
    expect(mobileFormat).toContain('return listTime(iso);');
    expect(mobileFormat).toContain('return clockTime(iso);');

    const webInbox = webSource('components/inbox/conversation-list.tsx');
    expect(webInbox).toContain('listTime(conversation.last_message_at)');
    expect(webInbox).not.toContain('formatDistanceToNow');
    expect(webSource('components/inbox/message-bubble.tsx')).toContain(
      'clockTime(message.created_at)'
    );

    expect(
      webSource('app/(dashboard)/contacts/contacts-content.tsx')
    ).toContain('listTime(contact.last_contacted_at)');
    expect(mobileSource('app/(app)/(tabs)/contacts.tsx')).toContain(
      ": 'Never'"
    );

    const mobileCalendar = mobileSource('app/(app)/(tabs)/calendar.tsx');
    expect(mobileCalendar).toContain("from '@shared/lib/format/list-time'");
    expect(mobileCalendar).not.toContain('toLocaleTimeString');
  });

  it('[UIX-005] reads event type, sort and broadcast status labels from web modules', () => {
    expect(webSource('components/calendar/event-types.ts')).toContain(
      'EVENT_TYPE_LABELS'
    );
    for (const source of [
      mobileSource('app/(app)/(tabs)/calendar.tsx'),
      mobileSource('app/(app)/appointment-new.tsx'),
    ]) {
      expect(source).toContain('EVENT_TYPE_LABELS');
      expect(source).not.toMatch(/label: '(Site visit|Document|Documents)'/);
    }

    expect(mobileSource('lib/property-filters.ts')).toContain(
      "from '@shared/lib/inventory/property-sorts'"
    );

    const mobileBroadcasts = mobileSource('app/(app)/broadcasts.tsx');
    expect(mobileBroadcasts).toContain(
      'getBroadcastStatus(broadcast.status).label'
    );
    expect(mobileBroadcasts).not.toContain('{broadcast.status}');
    const mobileBroadcast = mobileSource('app/(app)/broadcast/[id].tsx');
    expect(mobileBroadcast).toContain('getRecipientStatus(item.status).label');
    expect(mobileBroadcast).not.toContain('{item.status}');
  });

  it('[UIX-005] words the remaining shared labels the same on both surfaces', () => {
    expect(mobileSource('lib/format.ts')).toContain("'No budget limit'");
    expect(
      webSource('app/(dashboard)/contacts/contacts-content.tsx')
    ).toContain("'No budget limit'");
    expect(webSource('components/contacts/contact-peek-line.tsx')).toContain(
      "'No budget limit'"
    );

    expect(webSource('components/inventory/property-actions-menu.tsx')).toMatch(
      /\bUnarchive\b/
    );
    expect(
      webSource('components/inventory/flyer-creator-dialog.tsx')
    ).toContain('Show Property Code');

    const board = webSource('app/(dashboard)/pipelines/pipelines-content.tsx');
    for (const text of [
      'Enter brokerage details',
      'starts the closing stretch. Record the brokerage rate or amount',
      'Fixed amount',
      "'Brokerage amount'",
      'Calculated brokerage:',
      'Save and move',
    ]) {
      expect(board).toContain(text);
    }

    expect(webSource('app/(dashboard)/calendar/page.tsx')).not.toMatch(
      /(Low|Medium|High) [Pp]riority</
    );

    expect(mobileSource('app/(app)/greetings.tsx')).toContain(
      'label={t.charAt(0).toUpperCase() + t.slice(1)}'
    );
  });
});

describe('[UIX-007] Broadcasts and Deals show the same information and actions on both surfaces', () => {
  it('[UIX-007] gives the mobile broadcast detail the web counts, actions and filter', () => {
    const web = webSource('app/(dashboard)/broadcasts/[id]/page.tsx');
    const mobile = mobileSource('app/(app)/broadcast/[id].tsx');
    for (const label of [
      'Total Recipients',
      'Sent',
      'Delivered',
      'Read',
      'Replied',
      'Failed',
    ]) {
      expect(web).toContain(`label="${label}"`);
      expect(mobile).toContain(`label="${label}"`);
    }
    for (const source of [web, mobile]) {
      expect(source).toContain('RECIPIENT_STATUS_FILTERS.map(');
      expect(source).toContain('hasRetryableRecipients(');
      expect(source).toContain('retryFailedSummary(');
      expect(source).toContain('BROADCAST_DELETE_CONFIRM');
      expect(source).toContain('/retry-failed`');
      expect(source).toMatch(/\.from\('broadcasts'\)\s*\.delete\(\)/);
    }
    expect(web).not.toContain('const RECIPIENT_STATUSES');
    expect(mobile).not.toContain('const STATUS_FILTERS');
    expect(mobile).toContain("from '@shared/lib/broadcast-status'");
    expect(mobile).toContain(
      ".in('status', [...RETRYABLE_RECIPIENT_STATUSES])"
    );
    expect(mobile).toContain('useAppDialog()');
    expect(mobile).toContain('title: BROADCAST_DELETE_CONFIRM');
    expect(mobile).toContain('canSendMessages(profile.account_role)');
    expect(mobile).toContain('!profile.is_read_only');
    expect(mobile).toContain('disabled={retryMutation.isPending || sending}');
    expect(mobile).toContain('disabled={deleteMutation.isPending || sending}');
    const retryRoute = webSource(
      'app/api/broadcasts/[id]/retry-failed/route.ts'
    );
    expect(retryRoute).toContain("requireRole('agent')");
    expect(retryRoute).toContain("request.headers.get('authorization')");

    expect(mobileSource('app/(app)/broadcasts.tsx')).toContain(
      '<Stat label="Replied" value={broadcast.replied_count} />'
    );
  });

  it('[UIX-007] computes the deal overview Money card with one shared rule', () => {
    const web = webSource('components/deals/deal-overview-panel.tsx');
    const mobile = mobileSource('app/(app)/deal/[id].tsx');
    for (const source of [web, mobile]) {
      expect(source).toContain('dealBrokerageShare(');
      expect(source).toContain('label="Your share"');
      expect(source).toContain('to co-brokers`}');
      expect(source).toContain("'Not yet'");
      expect(source).toContain("'No tranches yet'");
      expect(source).toContain('label="Payment schedule"');
      expect(source).toContain('Nothing to do on this deal');
      expect(source).toContain('Nobody on this deal yet');
    }
    expect(mobile).toContain("from '@shared/lib/pipelines/deal-money'");
    expect(mobile).toContain('co_broker_payout_total');
    expect(mobile).not.toContain("'Not set'");
    expect(mobile).not.toContain('Nothing open');
    expect(web).not.toContain('netOfPayouts(');
  });

  it('[UIX-007] shows the expected close date and a Won or Lost label on the board card', () => {
    const web = webSource('components/pipelines/deal-card.tsx');
    const mobile = mobileSource('app/(app)/deals.tsx');
    expect(web).toContain('deal.expected_close_date &&');
    expect(mobile).toContain('dateOnlyLabel(deal.expected_close_date)');
    expect(mobile).toContain('name="calendar-outline"');
    expect(web).toMatch(/Won\s*<\/span>/);
    expect(web).toMatch(/Lost\s*<\/span>/);
    expect(mobile).toContain("{deal.status === 'won' ? 'Won' : 'Lost'}");
    expect(mobile).not.toContain('{deal.status}');
    expect(mobileSource('lib/format.ts')).toContain(
      'export function dateOnlyLabel('
    );
  });
});

describe('[UIX-008] to-dos and journeys show the same labels and actions on web and mobile', () => {
  const webCalendar = webSource('app/(dashboard)/calendar/page.tsx');
  const mobileCalendar = mobileSource('app/(app)/(tabs)/calendar.tsx');
  const mobileJourney = mobileSource('app/(app)/journey.tsx');
  const mobileSheets = mobileSource('components/journey-reason-sheets.tsx');

  it('[UIX-008] labels to-do priority, overdue and deal tasks from one shared module', () => {
    expect(webCalendar).toContain("} from '@/lib/calendar/todo-groups';");
    expect(mobileCalendar).toContain(
      "} from '@shared/lib/calendar/todo-groups';"
    );
    for (const source of [webCalendar, mobileCalendar]) {
      expect(source).toContain('isTodoOverdue(');
      expect(source).toContain('TODO_PRIORITY_LABELS[todo.priority]');
      expect(source).toContain('OVERDUE_TODO_LABEL');
      expect(source).toContain('DEAL_TASK_LABEL');
      expect(source).not.toContain("'Deal task'");
    }
    expect(webCalendar).not.toMatch(/>\s*Deal\s*</);
    expect(webCalendar).not.toContain('{todo.priority}');
    expect(mobileCalendar).not.toContain('due.getTime() < now.getTime()');
  });

  it('[UIX-008] sorts journeys through one shared module with priority', () => {
    expect(mobileSource('lib/journey-overview.ts')).toContain(
      "} from '@shared/lib/journey/sort';"
    );
    expect(webSource('components/journey/shared.ts')).toContain(
      "} from '@/lib/journey/sort';"
    );
    expect(mobileJourney).toContain(
      '(Object.keys(JOURNEY_SORT_LABELS) as JourneySort[]).map'
    );
    expect(mobileJourney).toContain(
      'priority: priorityBySubject.get(row.subject_id) ?? null,'
    );
    for (const source of [
      mobileJourney,
      webSource('components/journey/journey-overview.tsx'),
    ]) {
      expect(source).toContain(".from('journey_priorities')");
      expect(source).toContain("{ onConflict: 'account_id,mode,subject_id' }");
      expect(source).toContain('JOURNEY_PRIORITY_ORDER.map((priority) =>');
      expect(source).toContain('Clear priority');
    }
    expect(mobileJourney).toContain(
      '{JOURNEY_PRIORITY_LABELS[group.priority]}'
    );
  });

  it('[UIX-008] closes a journey with a chosen or typed reason as web does', () => {
    const webDialog = webSource('components/journey/close-journey-dialog.tsx');
    for (const source of [webDialog, mobileSheets]) {
      expect(source).toContain(
        'placeholder="Add the specific context for future reference"'
      );
      expect(source).toContain('JOURNEY_CLOSURE_REASONS[status].map(');
    }
    expect(webDialog).toContain('maxLength={500}');
    expect(mobileSheets).toContain('maxLength={JOURNEY_REASON_MAX_LENGTH}');
    expect(mobileJourney).toContain('<CloseJourneySheet');
    expect(mobileJourney).toContain("action: 'close',");
    expect(mobileJourney).not.toContain('function chooseClosure');
  });

  it('[UIX-008] drops and reactivates a journey branch through the web route', () => {
    const webSheet = webSource('components/journey/journey-item-sheet.tsx');
    for (const source of [webSheet, mobileSheets]) {
      expect(source).toContain('Why is this being dropped?');
      expect(source).toContain('QUICK_DROP_REASONS.map(');
      expect(source).toContain('placeholder="Reason (shown on the map)"');
    }
    expect(mobileSheets).toContain('`Drop at ${stageName}…`');
    expect(mobileSource('lib/api.ts')).toContain("'/api/journey/status'");
    expect(webSource('components/journey/journey-section.tsx')).toContain(
      "fetch('/api/journey/status'"
    );
    expect(mobileJourney).toContain('<DropBranchSheet');
    expect(mobileJourney).toContain(
      "void changeBranchStatus(item, 'reactivate');"
    );
    const route = webSource('app/api/journey/status/route.ts');
    expect(route).toContain(".from('journey_events')");
    expect(route).toContain(
      "event_type: action === 'drop' ? 'dropped' : 'reactivated',"
    );
    expect(mobileJourney).not.toContain("from('journey_events')");
    expect(webSource('components/journey/journey-section.tsx')).not.toMatch(
      /logEvent\(item\.id, '(dropped|reactivated)'/
    );
    expect(mobileJourney).toContain("error.code === 'LISTING_SYNC_FAILED'");
  });
});

describe('[UIX-011] property and deal screens never strand or silently drop work', () => {
  it('[UIX-011] tells a missing property apart from a failed load on detail and edit', () => {
    for (const screen of [
      'app/(app)/property/[id].tsx',
      'app/(app)/property-edit.tsx',
    ]) {
      const source = mobileSource(screen);
      expect(source).toContain('<LoadErrorState');
      expect(source).toContain('onRetry={() => void refetch()}');
      expect(source).toContain('<NotFoundState');
      expect(source).toContain('title="Property not found"');
    }
    expect(mobileSource('components/load-error.tsx')).toContain(
      '<PrimaryButton label="Back" onPress={() => router.back()} />'
    );
  });

  it('[UIX-011] holds Save while photos upload and keeps going past a failed photo', () => {
    const edit = mobileSource('app/(app)/property-edit.tsx');
    expect(edit).toContain('onBusyChange={setPhotosBusy}');
    expect(edit).toContain(
      "label={photosBusy ? 'Uploading photos…' : 'Save changes'}"
    );
    expect(edit).toContain('disabled={photosBusy}');
    const photos = mobileSource('components/property-photo-editor.tsx');
    expect(photos).toContain('uploadEach(');
    expect(photos).toContain(
      'uploadProgressLabel(progress.done, progress.total)'
    );
    expect(photos).toContain("label: 'Retry failed'");
    expect(photos).toContain('onChange((prev) => [...prev, path])');
    expect(photos).toContain('accessibilityLabel="Undo remove photo"');
    expect(photos.match(/hitSlop=\{11\}/g)).toHaveLength(2);
  });

  it('[UIX-011] asks before discarding unsaved property and deal edits, never after a save', () => {
    const guard = mobileSource('lib/use-discard-guard.ts');
    expect(guard).toContain(
      "import { usePreventRemove } from 'expo-router/react-navigation';"
    );
    expect(guard).toContain("title: 'Discard changes?'");
    expect(mobileSource('app/(app)/property-edit.tsx')).toContain(
      'useDiscardGuard(draft !== initialDraft, dialog)'
    );
    expect(mobileSource('app/(app)/deal-edit.tsx')).toContain(
      'useDiscardGuard(\n    draft !== initialDraft && !deleting,'
    );
    for (const screen of [
      'app/(app)/property-edit.tsx',
      'app/(app)/deal-edit.tsx',
    ]) {
      expect(mobileSource(screen)).toContain('allowLeave();');
    }
  });

  it('[UIX-011] scrolls to a property form error, buzzes, and clears it on any field change', () => {
    const source = mobileSource('app/(app)/property-edit.tsx');
    expect(source).toContain(
      'scrollRef.current?.scrollTo({ y: 0, animated: true });'
    );
    expect(source).toContain('showError(invalid);');
    expect(source).toContain(
      'errorState && errorState.draft === draft ? errorState.text : null'
    );
  });

  it('[UIX-011] reads a deal value with commas through the shared parser on both surfaces', () => {
    const mobile = mobileSource('app/(app)/deal-edit.tsx');
    expect(mobile).toContain('value: parseAmountInput(value) ?? 0,');
    expect(mobile).toContain(
      '<PriceHint value={parseAmountInput(value)} currency={dealCurrency} />'
    );
    expect(mobile).not.toContain('parseFloat(value)');
    const web = webSource('components/pipelines/deal-form.tsx');
    expect(web).toContain('const dealValue = parseAmountInput(value) ?? 0;');
    expect(mobileSource('app/(app)/property-edit.tsx')).toContain(
      'const num = parseAmountInput;'
    );
  });

  it('[UIX-011] labels the deal form and says why Create is disabled', () => {
    const source = mobileSource('app/(app)/deal-edit.tsx');
    for (const label of ['"Title"', '"Contact"', '"Property"', '"Notes"']) {
      expect(source).toContain(`label=${label}`);
    }
    expect(source).toContain('const missing = dealFormMissing({');
    expect(source).toContain('disabled={missing !== null || deleting}');
  });

  it('[UIX-011] keeps the Money draft across tabs and refetches and says when nothing changed', () => {
    const source = mobileSource('app/(app)/deal/[id].tsx');
    expect(source).not.toContain('key={JSON.stringify(data)}');
    expect(source).toContain('onDraftChange={setMoneyDraft}');
    expect(source).toContain(
      'const draft = { ...toDraft(data), ...storedDraft };'
    );
    expect(source).toContain(
      'if (next[key] !== base[key]) touched[key] = next[key];'
    );
    expect(source).toContain(
      "label={dirty ? 'Save financials' : 'No changes'}"
    );
    expect(source).toContain('disabled={!dirty}');
  });

  it('[UIX-011] shows a retry instead of an empty or endless state when a load fails', () => {
    const workspace = mobileSource('app/(app)/deal/[id].tsx');
    expect(workspace.match(/<TabLoadError /g)).toHaveLength(7);
    expect(workspace).toContain('label="Couldn’t load the money details"');
    const deals = mobileSource('app/(app)/deals.tsx');
    expect(deals).toContain('<LoadErrorState title="Couldn’t load deals"');
    expect(deals).toContain('pipelinesQuery.isLoading ||');
    expect(mobileSource('app/(app)/journey.tsx')).toContain(
      'loadFailed && buckets.length === 0'
    );
    const list = mobileSource('app/(app)/(tabs)/properties.tsx');
    expect(list).toContain('error && properties.length === 0 && !isLoading');
    expect(list).toContain('isFetchingNextPage ? (');
  });

  it('[UIX-011] confirms Reopen on a paid deal', () => {
    expect(mobileSource('app/(app)/deals.tsx')).toContain(
      "title: 'Move back to Brokerage Pending?'"
    );
  });

  it('[UIX-011] refreshes property status after deal saves and the board after a journey removal', () => {
    const keys = mobileSource('lib/deal-workspace.ts');
    for (const line of [
      "['properties'],",
      "['property'],",
      "['property-edit'],",
    ]) {
      expect(keys).toContain(line);
    }
    expect(mobileSource('app/(app)/journey.tsx')).toContain(
      '...DEAL_SAVED_QUERY_KEYS.map((queryKey) =>'
    );
  });
  it('[UIX-011] web deal value and photo removal match mobile', () => {
    const form = webSource('components/pipelines/deal-form.tsx');
    expect(form).toContain('inputMode="decimal"');
    expect(form).toContain('dealValue: parseAmountInput(value) ?? 0,');
    const media = webSource(
      'components/inventory/property-form/media-section.tsx'
    );
    expect(media).toContain("toast('Photo removed', {");
    expect(media).toContain("label: 'Undo',");
  });
});

describe('[UIX-006] contacts and inbox show the same things on web and mobile', () => {
  it('[UIX-006] labels lead temperature and VIP from one shared module', () => {
    const webList = webSource('app/(dashboard)/contacts/contacts-content.tsx');
    expect(webList).toContain("from '@/lib/contacts/lead-temp'");
    expect(webList).toContain('leadTempLabel(leadTemp)');
    expect(webList).toContain('VIP_BADGE_LABEL');

    const mobileList = mobileSource('app/(app)/(tabs)/contacts.tsx');
    expect(mobileList).toContain("from '@shared/lib/contacts/lead-temp'");
    expect(mobileList).toContain('leadTempLabel(contact.lead_temp)');
    expect(mobileList).toContain('label={VIP_BADGE_LABEL}');

    for (const source of [
      webSource('components/contacts/contact-detail-view.tsx'),
      webSource('components/contacts/contact-form.tsx'),
    ]) {
      expect(source).toContain('LEAD_TEMP_OPTIONS.map');
      expect(source).not.toContain('<option value="HOT">');
    }

    const mobileDetail = mobileSource('app/(app)/contact/[id].tsx');
    expect(mobileDetail).toContain("from '@shared/lib/contacts/lead-temp'");
    expect(mobileDetail).toContain('LEAD_TEMP_OPTIONS.map');
    expect(mobileDetail).toContain('<ChoiceChip');
    expect(mobileDetail).toContain('lead_temp: leadTemp,');
    expect(mobileDetail).toContain('leadTempLabel(contact.lead_temp)');
  });

  it('[UIX-006] lists archived contacts in their own mobile segment', () => {
    const mobileList = mobileSource('app/(app)/(tabs)/contacts.tsx');
    expect(mobileList).toContain("{ key: 'archived', label: 'Archived' }");
    expect(mobileList).toContain(".eq('is_archived', segment === 'archived')");
    expect(mobileList).not.toContain(".eq('is_archived', false)");
    expect(mobileList).toContain('archived: data?.archived ?? 0');
    expect(webSource('lib/contacts/list-queries.ts')).toContain(
      "query.eq('is_archived', true)"
    );
  });

  it('[UIX-006] offers one inbox filter list on both surfaces', () => {
    const webInbox = webSource('components/inbox/conversation-list.tsx');
    expect(webInbox).toContain("from '@/lib/conversations/inbox-filters'");
    expect(webInbox).toContain('INBOX_FILTERS.map');
    expect(webInbox).toContain("filter === 'unread'");
    expect(webInbox).toContain('c.unread_count > 0');

    const mobileInbox = mobileSource('app/(app)/(tabs)/index.tsx');
    expect(mobileInbox).toContain(
      "from '@shared/lib/conversations/inbox-filters'"
    );
    expect(mobileInbox).toContain('PRIMARY_INBOX_FILTERS');
    expect(mobileInbox).toContain(
      "filter === 'open' || filter === 'pending' || filter === 'closed'"
    );
    expect(mobileInbox).not.toMatch(/const FILTERS = \[/);
  });

  it('[UIX-006] blocks the mobile composer up front once the window closes', () => {
    expect(webSource('components/inbox/message-thread.tsx')).toContain(
      'customerSessionInfo(messages)'
    );
    const webComposer = webSource('components/inbox/message-composer.tsx');
    expect(webComposer).toContain('CUSTOMER_WINDOW_COMPOSER_PLACEHOLDER');
    expect(webComposer).toContain('CUSTOMER_WINDOW_COMPOSER_NOTICE');

    const mobileThread = mobileSource('app/(app)/conversation/[id].tsx');
    expect(mobileThread).toContain(
      "from '@shared/lib/conversations/customer-session'"
    );
    expect(mobileThread).toContain(
      'customerSessionInfo([...messages, ...lastCustomerMessage])'
    );
    expect(mobileThread).toMatch(
      /\.eq\('sender_type', 'customer'\)\s*\.order\('created_at', \{ ascending: false \}\)\s*\.limit\(1\)/
    );
    expect(mobileThread).toContain('editable={!sessionExpired}');
    expect(mobileThread).toContain('CUSTOMER_WINDOW_COMPOSER_PLACEHOLDER');
    expect(mobileThread).toContain('CUSTOMER_WINDOW_COMPOSER_NOTICE');
    expect(mobileThread).toContain('windowBlocked || sessionExpired');
    expect(mobileThread).toContain('isReengagementError(');
  });
});

describe('[ACC-009] mobile sign-in sends the same auth phone as web', () => {
  it('[ACC-009] routes every mobile auth phone through the shared authPhone rule', () => {
    const format = mobileSource('lib/format.ts');
    expect(format).toContain(
      "import { authPhone } from '@shared/lib/format/phone';"
    );
    expect(format).toMatch(
      /export function cleanPhoneInput\(raw: string\): string \| null \{\s*return authPhone\(raw, AUTH_DEFAULT_COUNTRY_CODE\);/
    );
    expect(webSource('lib/whatsapp/phone-utils.ts')).toContain(
      'return authPhone(raw, DEFAULT_COUNTRY_CODE);'
    );
    for (const screen of [
      'app/(auth)/login.tsx',
      'app/(auth)/den-login.tsx',
      'app/(app)/verify-phone.tsx',
    ]) {
      const source = mobileSource(screen);
      expect(source).toContain(
        "import { cleanPhoneInput } from '@/lib/format';"
      );
      expect(source).toContain('phone: cleanPhone,');
    }
  });
});

describe('[UIX-009] mobile lists page, failed loads retry and edits are not lost', () => {
  const thread = mobileSource('app/(app)/conversation/[id].tsx');
  const inbox = mobileSource('app/(app)/(tabs)/index.tsx');
  const contacts = mobileSource('app/(app)/(tabs)/contacts.tsx');
  const contact = mobileSource('app/(app)/contact/[id].tsx');
  const quickAdd = contacts.slice(
    contacts.indexOf('function QuickAddContact('),
    contacts.indexOf('function ContactRow(')
  );
  const contactRow = contacts.slice(contacts.indexOf('function ContactRow('));

  it('[UIX-009] pages a thread backwards through older messages', () => {
    expect(thread).toContain('useInfiniteQuery({');
    expect(thread).toContain("queryKey: ['messages', id],");
    expect(thread).toContain(
      'getNextPageParam: (last) => nextKeysetCursor(last, PAGE_SIZE)'
    );
    expect(thread).toContain('query.or(olderThanCursor(cursor))');
    expect(thread).toContain("queryKey: ['messages', id, 'last-customer'],");
    expect(thread).toContain('void fetchOlderMessages();');
    expect(thread).toContain('ListFooterComponent={');
  });

  it('[UIX-009] pages the inbox and searches it on the server', () => {
    expect(inbox).toContain('useInfiniteQuery({');
    expect(inbox).toContain(': nextOffset(all, INBOX_PAGE_SIZE)');
    expect(inbox).toContain('.range(offset, offset + INBOX_PAGE_SIZE - 1)');
    expect(inbox).not.toContain('.limit(200)');
    expect(inbox).toContain('onEndReached={loadMore}');
    expect(inbox).toContain('inboxFilterPlan(scope.filter)');
    expect(inbox).toContain('query.or(scope.searchFilter)');
    expect(inbox).not.toContain('c.contact?.name?.toLowerCase().includes(q)');
  });

  it('[UIX-009] pages contacts and builds search from the shared filter', () => {
    expect(contacts).toContain('useInfiniteQuery({');
    expect(contacts).toContain(
      '.range(offset, offset + CONTACTS_PAGE_SIZE - 1)'
    );
    expect(contacts).toContain('contactTextSearchFilters(q)');
    expect(contacts).not.toContain('orFilter');
    expect(webSource('lib/contacts/list-queries.ts')).toContain(
      "import { contactTextSearchFilters } from '@/lib/contacts/search-filter';"
    );
  });

  it('[UIX-009] offers Retry when a later page fails to load', () => {
    for (const source of [thread, inbox, contacts]) {
      expect(source).toContain('isFetchNextPageError');
      expect(source).toContain('<InlineLoadError');
    }
    expect(inbox).toContain('const searchFailed =');
    expect(inbox).toContain("select('id, contacts!inner(id)')");
    expect(inbox).toContain('matchesLoadedSearch(c, shortSearch)');
    expect(inbox).toContain('nextActiveOffset(activeIds, all.length)');
    expect(inbox).toMatch(
      /!isFetchingNextPage &&\s*!isFetchNextPageError\s*\)/
    );
    expect(thread).toContain(
      'prev.trim() && prev !== restoredDraft ? prev : seedDraft'
    );
  });

  it('[UIX-009] says a failed load failed and offers to try again', () => {
    for (const source of [thread, inbox, contacts, contact]) {
      expect(source).toContain('<LoadErrorState');
    }
    for (const source of [thread, inbox, contacts, contact]) {
      expect(source).toContain("from '@/components/load-error'");
    }
    expect(mobileSource('components/load-error.tsx')).toContain('Retry');
    expect(contact).toContain('title="Contact not found"');
    expect(contact).not.toContain('{isLoading || !contact ? (');
  });

  it('[UIX-009] confirms before discarding unsaved contact edits', () => {
    expect(contact).toContain(
      "import { usePreventRemove } from 'expo-router/react-navigation';"
    );
    expect(contact).toContain('usePreventRemove(editing && dirty');
    expect(contact).toContain("title: 'Discard changes?'");
    expect(contact).toContain('onDirtyChange={setDirty}');
    expect(contact).toContain('keyboardVerticalOffset={headerHeight}');
    expect(contact).toContain('<RefreshControl');
  });

  it('[UIX-009] keeps the quick-add draft until a contact is added', () => {
    expect(quickAdd.match(/reset\(\);/g)).toHaveLength(1);
    expect(quickAdd).toContain('style={sheetScrollArea}');
    expect(quickAdd).toContain('keyboardShouldPersistTaps="handled"');
    expect(quickAdd).toContain("queryKey: ['contact-counts']");
    expect(contactRow).toContain('{hasPhone(contact) ? (');
  });

  it('[UIX-009] keeps a composer draft per thread and phone hints per country', () => {
    expect(thread).toContain('useState(() => composerDraft(conversationId))');
    expect(thread).toContain('saveComposerDraft(conversationId, draft)');
    expect(mobileSource('lib/auth-store.ts')).toContain(
      'clearComposerDrafts();'
    );
    for (const source of [contacts, contact]) {
      expect(source).not.toMatch(/placeholder="[^"]*(98765|99002)/);
      expect(source).toContain('phoneHints(countryCode)');
    }
  });

  it('[UIX-009] refetches stale screens when the app returns to the foreground', () => {
    expect(mobileSource('lib/query.ts')).toContain(
      'focusManager.setEventListener('
    );
  });
});

describe('[UIX-010] mobile screens say when something failed and guard unsaved work', () => {
  it('[UIX-010] shows a retryable error instead of an empty state when a load fails', () => {
    const calendar = mobileSource('app/(app)/(tabs)/calendar.tsx');
    expect(calendar).toContain('isError && !data ? (');
    expect(calendar).toContain('todosQuery.isError && !todosQuery.data');
    expect(calendar).toContain('upcomingAppointmentsQuery.isError');
    expect(calendar.match(/<LoadErrorState/g)?.length).toBe(3);

    const credits = mobileSource('app/(app)/credits.tsx');
    expect(credits).toContain('Couldn’t load balance');
    expect(credits).toContain('history.isError && transactions.length === 0');

    const broadcasts = mobileSource('app/(app)/broadcasts.tsx');
    expect(broadcasts).toContain('isLoading ? null : isError ? (');

    const detail = mobileSource('app/(app)/broadcast/[id].tsx');
    expect(detail).toContain('recipientsFailed ? (');
    expect(detail).toContain('onRefresh={pull.onRefresh}');

    const notifications = mobileSource('app/(app)/notifications.tsx');
    expect(notifications).toContain('isError ? (');
    expect(notifications).toContain('onRefresh={pull.onRefresh}');
    expect(mobileSource('lib/use-notifications.ts')).toContain(
      'isError: query.isError && !query.data'
    );

    const profile = mobileSource('components/profile-edit-sheet.tsx');
    expect(profile).toContain('accountLoadFailed');
    expect(profile).toContain('Retry loading the workspace name');
  });

  it('[UIX-010] pages broadcast recipients instead of stopping at 500', () => {
    const detail = mobileSource('app/(app)/broadcast/[id].tsx');
    expect(detail).toContain('useInfiniteQuery({');
    expect(detail).toContain('.range(from, from + RECIPIENT_PAGE_SIZE - 1)');
    expect(detail).toContain('onEndReached={');
    expect(detail).not.toContain('.limit(500)');
    expect(detail).toContain(
      'canManage && (hasRetryableRecipients(filtered) || retryableCount > 0)'
    );
    expect(detail).toContain(
      ".in('status', [...RETRYABLE_RECIPIENT_STATUSES])"
    );
  });

  it('[UIX-010] asks before discarding a draft or a paid compose', () => {
    const greetings = mobileSource('app/(app)/greetings.tsx');
    expect(greetings).toContain("title: 'Discard draft?'");
    expect(greetings).toContain("title: 'Replace your text?'");
    expect(greetings).toContain('costs ${cost} credits again');
    expect(greetings).toContain('onClose={requestClose}');
    expect(greetings).toContain('onPress={compose}');

    const calendar = mobileSource('app/(app)/(tabs)/calendar.tsx');
    expect(calendar.match(/title: 'Discard changes\?'/g)?.length).toBe(2);
    expect(calendar).toContain('onClose={requestCloseEdit}');
    expect(calendar).toContain('onClose={requestClose}');

    const create = mobileSource('app/(app)/appointment-new.tsx');
    expect(create).toContain(
      "import { usePreventRemove } from 'expo-router/react-navigation';"
    );
    expect(create).toContain('usePreventRemove(dirty && !saving');
    expect(create).toContain('navigation.dispatch(data.action)');
  });

  it('[UIX-010] edits the current to-do and never saves one twice', () => {
    const calendar = mobileSource('app/(app)/(tabs)/calendar.tsx');
    expect(calendar).toMatch(
      /function openEdit\(\) \{\s*haptic\.tap\(\);\s*loadEdit\(\);\s*setEditing\(true\);/
    );
    expect(calendar).toContain('onPress={openEdit}');
    expect(calendar).toContain('saving.current) return;');
    expect(calendar).toMatch(
      /todoIconButton: \{\s*minWidth: 44,\s*minHeight: 44,/
    );
    expect(calendar.match(/style=\{styles\.todoIconButton\}/g)?.length).toBe(2);
  });

  it('[UIX-010] keeps an event’s length and confirms a start in the past', () => {
    const calendar = mobileSource('app/(app)/(tabs)/calendar.tsx');
    const create = mobileSource('app/(app)/appointment-new.tsx');
    expect(calendar.match(/movedEventEnd\(/g)?.length).toBe(2);
    expect(calendar).not.toContain('newStart.getTime() + 60 * 60 * 1000');
    for (const source of [calendar, create]) {
      expect(source).toContain("from '@/lib/event-timing'");
      expect(source).toContain('startsInPast(');
      expect(source).toContain('PAST_START_CONFIRM.message');
    }
    expect(calendar).toContain('onPress={requestSaveReschedule}');
    expect(create).toContain('onPress={requestSave}');
  });

  it('[UIX-010] shows notices where they can be seen', () => {
    expect(mobileSource('app/(app)/greetings.tsx')).toMatch(
      /showAppDialog\(\{\s*title: 'Greeting on its way'/
    );
    const compose = mobileSource('app/(app)/broadcast-new.tsx');
    expect(compose.indexOf('<Banner kind="error"')).toBeGreaterThan(
      compose.indexOf('label="Preview"')
    );
    expect(compose).toContain('scrollRef.current?.scrollToEnd');
  });

  it('[UIX-010] marks the app offline from its own requests, with no native module', () => {
    const pkg = JSON.parse(mobileSource('package.json')) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies['@react-native-community/netinfo']).toBeUndefined();
    expect(mobileSource('lib/supabase.ts')).toContain(
      'global: { fetch: trackedFetch }'
    );
    expect(mobileSource('lib/api.ts')).toContain(
      'await trackedFetch(url, { ...init, signal: controller.signal })'
    );
    expect(mobileSource('lib/tracked-fetch.ts')).not.toContain('onlineManager');
    expect(mobileSource('lib/online.ts')).not.toContain('onlineManager');
    const layout = mobileSource('app/_layout.tsx');
    expect(layout).toContain('useOnlineTracking();');
    expect(layout).toContain('<OfflineBar />');
    expect(mobileSource('components/offline-bar.tsx')).toContain(
      'Offline — showing saved data'
    );
  });

  it('[UIX-010] offers resend, sign-out confirmation and honest copy', () => {
    const verify = mobileSource('app/(app)/verify-phone.tsx');
    expect(verify).toContain('useResendCooldown()');
    expect(verify).toContain("'Resend code'");
    expect(verify).toContain('refreshError');
    expect(mobileSource('app/(auth)/login.tsx')).toContain(
      'useResendCooldown()'
    );

    const notifications = mobileSource('app/(app)/notifications.tsx');
    expect(notifications).toContain('notificationTarget(item)');
    expect(notifications).toContain('disabled={!target}');

    const more = mobileSource('app/(app)/(tabs)/more.tsx');
    expect(more).toContain("title: 'Sign out?'");
    expect(more).toContain('onPress={confirmSignOut}');

    const broadcasts = mobileSource('app/(app)/broadcasts.tsx');
    expect(broadcasts).not.toContain('CSV uploads');
    expect(broadcasts).toContain('a pasted list of numbers');
    expect(mobileSource('app/(app)/broadcast-new.tsx')).toContain(
      "'all' | 'tags' | 'csv' | null"
    );

    const greetings = mobileSource('app/(app)/greetings.tsx');
    expect(greetings).toContain('!canManage');
    expect(greetings).toContain('Tap + to write one');
  });
});
