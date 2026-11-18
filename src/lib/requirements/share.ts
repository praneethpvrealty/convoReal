import { formatInrCompact } from '@/lib/format/currency';

// ============================================================
// Consolidated requirement sharing — what leaves the Engine when an
// agent passes a brief to a co-broker.
//
// Two modes, because the audience differs:
//   full   — the agent's own record: name, tags, latest note.
//   masked — a co-broker's copy: the brief only, under an opaque
//            reference. No client name, no internal notes, no tags.
//
// Masking is structural, not a filter over prose: the requirement text
// is whatever the agent typed and is passed through verbatim. Callers
// warn about that at the point of sending.
//
// Pure module (no I/O) so the redaction rules are unit tested.
// ============================================================

export type RequirementShareMode = 'full' | 'masked';

export interface ShareableRequirement {
  id: string;
  name?: string | null;
  classification?: string | null;
  no_budget?: boolean | null;
  min_budget?: number | null;
  max_budget?: number | null;
  requirements?: string | null;
  areas_of_interest?: string[] | null;
  projects_of_interest?: string[] | null;
  /** Tag labels — full mode only. */
  tags?: (string | null | undefined)[] | null;
  /** Most recent note text — full mode only. */
  latestNote?: string | null;
  /** False parks the requirement: it stops matching and stops being
   *  offered to co-brokers. */
  requirement_active?: boolean | null;
  /** Public /req/<token> URL for interactive responses — appended in
   *  both modes when the caller minted a share link. */
  responseUrl?: string | null;
}

/**
 * Opaque, stable handle for a masked brief. A co-broker can quote it
 * back ("got something for REQ-A3F2") without ever learning who it is.
 */
export function requirementReference(id: string): string {
  return `REQ-${id.replace(/-/g, '').slice(0, 4).toUpperCase()}`;
}

function budgetLine(r: ShareableRequirement): string | null {
  if (r.no_budget) return 'Budget: No limit stated';
  const min =
    r.min_budget && Number(r.min_budget) > 0 ? Number(r.min_budget) : null;
  const max =
    r.max_budget && Number(r.max_budget) > 0 ? Number(r.max_budget) : null;
  if (min && max && min !== max)
    return `Budget: ${formatInrCompact(min)} – ${formatInrCompact(max)}`;
  if (max) return `Budget: up to ${formatInrCompact(max)}`;
  if (min) return `Budget: from ${formatInrCompact(min)}`;
  return null;
}

function cleanList(
  values: (string | null | undefined)[] | null | undefined
): string[] {
  return (values || [])
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter(Boolean);
}

function wordKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * One entry per place: "JP Nagar" and "jp nagar " are the same area, and
 * a brief resolved from explicit plus AI-extracted preferences lists
 * both.
 */
function uniqueList(
  values: (string | null | undefined)[] | null | undefined
): string[] {
  const seen = new Set<string>();
  return cleanList(values).filter((value) => {
    const key = wordKey(value) || value.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * What the requirement text does not already say. The text goes out
 * verbatim, so a location or project it names is not repeated on its
 * own line.
 */
function notStatedIn(values: string[], text: string): string[] {
  const haystack = ` ${wordKey(text)} `;
  return values.filter((value) => {
    const key = wordKey(value);
    return !key || !haystack.includes(` ${key} `);
  });
}

const STATES_AN_AMOUNT =
  /₹|\b(?:rs|inr)\b\.?\s*\d|\d\s*(?:cr|crore|crores|lakh|lakhs|lac|lacs|l|k)\b/i;

/**
 * A requirement worth sending: not parked, and carrying something a
 * co-broker could act on. A card with only a name is noise to them.
 * Parked rows are also skipped by the matching engine itself — this is
 * the share-side half of the same rule.
 */
export function isShareable(r: ShareableRequirement): boolean {
  if (r.requirement_active === false) return false;
  return Boolean(
    r.requirements?.trim() ||
    cleanList(r.areas_of_interest).length ||
    cleanList(r.projects_of_interest).length ||
    r.no_budget ||
    r.min_budget ||
    r.max_budget
  );
}

export function formatRequirement(
  r: ShareableRequirement,
  mode: RequirementShareMode
): string {
  const who =
    mode === 'masked'
      ? `Requirement ${requirementReference(r.id)}${r.classification ? ` (${r.classification})` : ''}`
      : `Client Profile: ${r.name || 'Unnamed'}${r.classification ? ` (${r.classification})` : ''}`;

  const text = r.requirements?.trim() ?? '';
  const lines = [who];

  // A budget the text already states is not stated twice: the typed
  // figure is the one the agent wrote, and two ranges read as a
  // contradiction.
  const budget = budgetLine(r);
  if (budget && !(text && !r.no_budget && STATES_AN_AMOUNT.test(text))) {
    lines.push(budget);
  }

  if (text) {
    lines.push(
      `${mode === 'masked' ? 'Looking for' : 'Requirements'}: ${text}`
    );
  }

  const areas = notStatedIn(uniqueList(r.areas_of_interest), text);
  if (areas.length) lines.push(`Locations: ${areas.join(', ')}`);

  const projects = notStatedIn(uniqueList(r.projects_of_interest), text);
  if (projects.length) lines.push(`Projects: ${projects.join(', ')}`);

  // Tags and notes are the agent's own shorthand — a co-broker gets
  // neither. A note like "will stretch if pushed" is exactly what
  // masking exists to withhold.
  if (mode === 'full') {
    const tags = uniqueList(r.tags);
    if (tags.length) lines.push(`Tags: ${tags.join(', ')}`);
    if (r.latestNote?.trim()) lines.push(`Notes: ${r.latestNote.trim()}`);
  }

  if (r.responseUrl?.trim()) {
    lines.push(`Got a match? Respond here: ${r.responseUrl.trim()}`);
  }

  return lines.join('\n• ');
}

/**
 * One message carrying several briefs. Numbered past the first, so a
 * co-broker can reply "the 3rd one" — and so five requirements arrive
 * as one message instead of five.
 */
export function buildRequirementDigest(
  requirements: ShareableRequirement[],
  mode: RequirementShareMode
): string {
  const sendable = requirements.filter(isShareable);
  if (sendable.length === 0) return '';

  const heading =
    sendable.length === 1
      ? '*CLIENT REQUIREMENT*'
      : `*CLIENT REQUIREMENTS (${sendable.length})*`;

  const blocks = sendable.map((r, i) => {
    const body = `• ${formatRequirement(r, mode)}`;
    return sendable.length === 1 ? body : `${i + 1}) ${body}`;
  });

  return [heading, '', blocks.join('\n\n')].join('\n');
}
