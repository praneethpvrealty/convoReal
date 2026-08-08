// Template channel for periodic reach digests to SOURCE AGENTS
// (partner agents whose inventory this account lists, e.g. Deepak when
// Suresh added Deepak's properties as agent-referred). Source agents
// rarely have an open 24-hour service window, so a pre-approved
// template is the primary path; an open window upgrades to the richer
// free-form per-property breakdown.
//
// ─────────────────────────────────────────────────────────────────
// READ THIS BEFORE SUBMITTING A NEW TEMPLATE FOR THE AGENT DIGEST
//
// The agent digest deliberately has NO template of its own. It sends
// through owner_property_digest — the same template the owner digest
// uses — because four attempts to get an agent-specific one approved as
// Utility all came back MARKETING:
//
//   agent_inventory_digest          2026-08-07  MARKETING
//   agent_listing_activity_update   2026-08-08  MARKETING
//   agent_property_digest           2026-08-08  MARKETING
//
// Each attempt stripped what looked like the promotional signal — a
// signup URL in a sample value, a 📣 emoji, "reach"/"performed across
// our buyer network" framing, then a fourth free-text param announced
// as "Next step:". The last one was near word-for-word identical to
// owner_property_digest (same 3 params, same footer, same two quick
// replies, three words different) and Meta still categorised it
// Marketing. Content parity does not reproduce the category.
//
// owner_property_digest was approved as Utility on 2026-07-16; every
// Marketing verdict landed 2026-08-06 or later. The most likely reading
// is that Meta tightened how it categorises recurring digests and the
// owner template is grandfathered — not that some wording is the magic
// one. Treat it as a fixed asset, not a control you can reproduce.
//
// Two Meta rules make each attempt permanent, which is why guessing is
// expensive:
//   1. Category is decided when Meta first reviews a template and can
//      never be edited afterwards — the API rejects the whole edit with
//      "You cannot update an approved template category".
//   2. Deleting a template reserves its name for four weeks, and it
//      refuses a category change for that entire window.
// So every submission burns a name for good. Three are already spent.
//
// If the digest must stop sharing the owner template, the honest paths
// are: appeal the category in WhatsApp Manager (Business Support,
// within 60 days of the verdict), or accept MARKETING and gate sends on
// explicit opt-in — marketing-category messages need it, count toward
// per-user marketing limits, and cost more. Do NOT submit a fifth name
// on a wording hunch.
//
// THE COUPLING THIS BUYS: owner and agent digests now share one Meta
// template. If it is ever re-categorised, paused for quality, or
// deleted, BOTH digests are affected at once. Quality signals from
// agents (blocks, "STOP UPDATES") land on the template the owners
// depend on too.
// ─────────────────────────────────────────────────────────────────

import { OWNER_DIGEST_TEMPLATE_NAME } from '@/lib/whatsapp/owner-digest-template';
import { sanitizeTemplateParam } from '@/lib/whatsapp/inventory-update-template';

/**
 * The agent digest sends through the owner digest's approved Utility
 * template. Its body reads correctly for a partner agent because {{2}}
 * carries the listings phrase ("your 3 referred listings (today)").
 */
export const AGENT_INVENTORY_DIGEST_TEMPLATE_NAME = OWNER_DIGEST_TEMPLATE_NAME;

/**
 * Agent-specific templates that were submitted before the switch above.
 * All three are approved but MARKETING. They stay listed so an account
 * that has one — and no approved owner digest — keeps receiving digests
 * rather than none, at the marketing rate. Newest first.
 */
export const LEGACY_AGENT_INVENTORY_DIGEST_TEMPLATE_NAMES = [
  'agent_property_digest',
  'agent_listing_activity_update',
  'agent_inventory_digest',
];

export const AGENT_INVENTORY_DIGEST_TEMPLATE_NAMES = [
  AGENT_INVENTORY_DIGEST_TEMPLATE_NAME,
  ...LEGACY_AGENT_INVENTORY_DIGEST_TEMPLATE_NAMES,
];

/**
 * Body params {{1}}..{{3}}: first name, listings phrase (with period),
 * compact reach summary — the same three owner_property_digest
 * declares, in the same order. Every param is guaranteed non-empty
 * (Meta rejects empty values) and newline-free (sanitizeTemplateParam).
 */
export function buildAgentInventoryDigestParams(
  contactName: string | null | undefined,
  propertyCount: number,
  periodLabel: string,
  summaryLine: string
): [name: string, listings: string, summary: string] {
  const firstName = contactName?.trim().split(/\s+/)[0] || 'there';
  const listingPhrase =
    propertyCount === 1 ? 'your referred listing' : `your ${propertyCount} referred listings`;
  return [
    sanitizeTemplateParam(firstName),
    sanitizeTemplateParam(`${listingPhrase} (${periodLabel})`),
    sanitizeTemplateParam(summaryLine || 'New buyer activity'),
  ];
}

/**
 * How many distinct {{N}} the stored template body expects. The legacy
 * agent_inventory_digest carries a fourth "Next step" param, and
 * sending a template fewer params than it declares is a Meta error.
 */
export function countTemplateBodyParams(bodyText: string | null | undefined): number {
  return new Set((bodyText || '').match(/\{\{\d+\}\}/g) ?? []).size;
}
