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
  /** False parks the requirement: it stops being offered to co-brokers. */
  requirement_active?: boolean | null;
}

function compactINR(value: number): string {
  if (value >= 1_00_00_000) {
    const cr = value / 1_00_00_000;
    return `₹${cr % 1 === 0 ? cr.toFixed(0) : cr.toFixed(2).replace(/0$/, '')} Cr`;
  }
  if (value >= 1_00_000) {
    const l = value / 1_00_000;
    return `₹${l % 1 === 0 ? l.toFixed(0) : l.toFixed(2).replace(/0$/, '')} L`;
  }
  return `₹${Math.round(value).toLocaleString('en-IN')}`;
}

/**
 * Opaque, stable handle for a masked brief. A co-broker can quote it
 * back ("got something for REQ-A3F2") without ever learning who it is.
 */
export function requirementReference(id: string): string {
  return `REQ-${id.replace(/-/g, '').slice(0, 4).toUpperCase()}`;
}

function budgetLine(r: ShareableRequirement): string {
  if (r.no_budget) return 'Budget: No limit stated';
  const min = r.min_budget && Number(r.min_budget) > 0 ? Number(r.min_budget) : null;
  const max = r.max_budget && Number(r.max_budget) > 0 ? Number(r.max_budget) : null;
  if (min && max) return `Budget: ${compactINR(min)} – ${compactINR(max)}`;
  if (max) return `Budget: up to ${compactINR(max)}`;
  if (min) return `Budget: from ${compactINR(min)}`;
  return 'Budget: Not specified';
}

function cleanList(values: (string | null | undefined)[] | null | undefined): string[] {
  return (values || []).map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean);
}

/**
 * A requirement worth sending: not parked, and carrying something a
 * co-broker could act on. A card with only a name is noise to them.
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

  const lines = [who, budgetLine(r)];

  if (r.requirements?.trim()) {
    lines.push(`${mode === 'masked' ? 'Looking for' : 'Requirements'}: ${r.requirements.trim()}`);
  }

  const areas = cleanList(r.areas_of_interest);
  if (areas.length) lines.push(`Locations: ${areas.join(', ')}`);

  const projects = cleanList(r.projects_of_interest);
  if (projects.length) lines.push(`Projects: ${projects.join(', ')}`);

  // Tags and notes are the agent's own shorthand — a co-broker gets
  // neither. A note like "will stretch if pushed" is exactly what
  // masking exists to withhold.
  if (mode === 'full') {
    const tags = cleanList(r.tags);
    if (tags.length) lines.push(`Tags: ${tags.join(', ')}`);
    if (r.latestNote?.trim()) lines.push(`Notes: ${r.latestNote.trim()}`);
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
      ? '*CONSOLIDATED CLIENT REQUIREMENT*'
      : `*CONSOLIDATED CLIENT REQUIREMENTS (${sendable.length})*`;

  const blocks = sendable.map((r, i) => {
    const body = `• ${formatRequirement(r, mode)}`;
    return sendable.length === 1 ? body : `${i + 1}) ${body}`;
  });

  return [heading, '', blocks.join('\n\n')].join('\n');
}
