// ── Showcase audience (migration 20261013041500) ──────────────────
// The gate in showcase-visibility.ts answers how much of a listing a
// stranger gets. The audience answers who gets it at all: a buyers-only
// listing is withheld from the co-broker view (mode=view), from a
// visitor the link names as an Agent contact, and from a hand-picked
// share to one. Rows are dropped where the catalogue is read, never
// hidden in the UI, because the public payload rides the RSC stream.
//
// Import-free on purpose: the mobile share sheet runs this through
// `@shared/`, so the pre-send check is one rule on both surfaces.

export type ShowcaseAudience = 'all' | 'buyers_only';

type AudienceFields = {
  showcase_audience?: string | null;
};

/** NULL derives to 'all': withholding a listing from co-brokers is a
 *  deliberate per-listing decision. */
export function effectiveShowcaseAudience(p: AudienceFields): ShowcaseAudience {
  return p.showcase_audience === 'buyers_only' ? 'buyers_only' : 'all';
}

export function isBuyersOnly(p: AudienceFields): boolean {
  return effectiveShowcaseAudience(p) === 'buyers_only';
}

/** PostgREST `.or()` filter for every row the co-broker view may list. */
export const AGENT_VIEW_AUDIENCE_FILTER =
  'showcase_audience.is.null,showcase_audience.neq.buyers_only';

export function isAgentViewMode(mode: string | null | undefined): boolean {
  return mode === 'view' || mode === 'agent';
}

/** The rows a viewer may see: every row for a buyer, the non-buyers-only
 *  rows for the co-broker view. */
export function forShowcaseViewer<T extends AudienceFields>(
  rows: T[],
  agentView: boolean
): T[] {
  return agentView ? rows.filter((row) => !isBuyersOnly(row)) : rows;
}

export function isAgentContact(contact: {
  classification?: string | null;
}): boolean {
  return contact.classification === 'Agent';
}

/**
 * The hand-picked listings a share may not carry: every buyers-only
 * pick when the share goes out as the co-broker link or to an
 * Agent-classified recipient. Checked before a message is composed, on
 * both surfaces, because the share ledger only hears about a send
 * after WhatsApp has opened.
 */
export function withheldFromCoBrokers<T extends AudienceFields>(
  picked: T[],
  share: {
    coBrokerAudience: boolean;
    recipients: Array<{ classification?: string | null }>;
  }
): T[] {
  if (!share.coBrokerAudience && !share.recipients.some(isAgentContact)) {
    return [];
  }
  return picked.filter(isBuyersOnly);
}

export function withheldShareNotice(count: number): string {
  return count === 1
    ? 'One picked listing is buyers only and cannot go to an agent. Unpick it, or switch the audience to clients.'
    : `${count} picked listings are buyers only and cannot go to an agent. Unpick them, or switch the audience to clients.`;
}
