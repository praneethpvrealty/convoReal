import type { DealMilestoneStatus } from './milestones';
import { isSamePerson, type DealStakeholder } from './stakeholders';
import type { DealUpdateSnapshot, DealUpdateVisibility } from './updates';
import {
  projectBundleForAudience,
  type Audience,
  type DealParties,
  type DealVisibility,
  type ProjectableDeal,
  type VisibleItem,
} from './visibility';

/**
 * What a stakeholder link shows. Built only from rows that already
 * carry a visibility, projected through the resolver, and never from
 * anything the resolver has not seen. This is the single payload
 * builder for the public deal-share routes.
 */

export interface ExternalDealSource {
  id: string;
  title: string;
  status: string;
  property_label: string | null;
  deal_group_id: string | null;
  stakeholders: readonly Pick<
    DealStakeholder,
    'id' | 'side' | 'contact_id' | 'phone' | 'email'
  >[];
  milestones: readonly {
    id: string;
    title: string;
    status: DealMilestoneStatus;
    position: number;
    target_date: string | null;
    completed_at: string | null;
    visibility: DealVisibility;
  }[];
  events: readonly {
    id: string;
    event_type: string;
    title: string;
    created_at: string;
    visibility: DealVisibility;
  }[];
  documents: readonly {
    id: string;
    title: string;
    category: string;
    status: string | null;
    expires_at: string | null;
    superseded_by: string | null;
    mime_type: string | null;
    visibility: DealVisibility;
  }[];
  updates?: readonly {
    id: string;
    headline: string;
    body: string | null;
    snapshot: DealUpdateSnapshot;
    supersedes_update_id: string | null;
    published_by_name: string | null;
    created_at: string;
    visibility: DealUpdateVisibility;
  }[];
}

export interface ExternalUpdateView {
  id: string;
  headline: string;
  body: string | null;
  snapshot: DealUpdateSnapshot;
  supersedes_update_id: string | null;
  superseded: boolean;
  published_by_name: string | null;
  created_at: string;
}

export interface ExternalDealView {
  id: string;
  title: string;
  status: string;
  property_label: string | null;
  progress: { total: number; done: number };
  milestones: Array<{
    id: string;
    title: string;
    status: DealMilestoneStatus;
    target_date: string | null;
    completed_at: string | null;
  }>;
  timeline: Array<{
    id: string;
    event_type: string;
    title: string;
    created_at: string;
  }>;
  documents: Array<{
    id: string;
    title: string;
    category: string;
    status: string | null;
    expires_at: string | null;
    superseded: boolean;
    mime_type: string | null;
  }>;
  updates: ExternalUpdateView[];
}

export interface ExternalPortalView {
  stakeholder: { name: string; role: string; side: string };
  deal: ExternalDealView;
  bundle: ExternalDealView[];
}

/** Parties of a deal are its stakeholders, by side. Internal-side
 *  stakeholders (the brokerage's own people) are party to nothing
 *  externally. */
export function partiesFromStakeholders(
  stakeholders: readonly Pick<DealStakeholder, 'id' | 'side'>[]
): DealParties {
  return {
    buyer_party_ids: stakeholders
      .filter((s) => s.side === 'buyer')
      .map((s) => s.id),
    seller_party_ids: stakeholders
      .filter((s) => s.side === 'seller')
      .map((s) => s.id),
  };
}

type Tagged = VisibleItem & {
  kind: 'milestone' | 'event' | 'document' | 'update';
};

function toProjectable(source: ExternalDealSource): ProjectableDeal {
  const items: Tagged[] = [
    ...source.milestones.map((m) => ({ ...m, kind: 'milestone' as const })),
    ...source.events.map((e) => ({ ...e, kind: 'event' as const })),
    ...source.documents.map((d) => ({ ...d, kind: 'document' as const })),
    ...(source.updates ?? []).map((u) => ({ ...u, kind: 'update' as const })),
  ];
  return {
    id: source.id,
    title: source.title,
    status: source.status,
    property_label: source.property_label,
    parties: partiesFromStakeholders(source.stakeholders),
    items,
  };
}

function toView(
  deal: Record<string, unknown>,
  items: VisibleItem[],
  source: ExternalDealSource
): ExternalDealView {
  const tagged = items as Tagged[];
  const milestones = tagged
    .filter((i) => i.kind === 'milestone')
    .map((m) => ({
      id: String(m.id),
      title: String(m.title),
      status: m.status as DealMilestoneStatus,
      target_date: (m.target_date as string | null) ?? null,
      completed_at: (m.completed_at as string | null) ?? null,
      position: Number(m.position),
    }))
    .sort((a, b) => a.position - b.position)
    .map(({ position: _p, ...rest }) => {
      void _p;
      return rest;
    });
  const total = source.milestones.length;
  const done = source.milestones.filter(
    (m) => m.status === 'completed' || m.status === 'skipped'
  ).length;
  return {
    id: String(deal.id),
    title: String(deal.title),
    status: String(deal.status),
    property_label: (deal.property_label as string | null) ?? null,
    // Progress counts the whole checklist, not only the visible rows:
    // "3 of 15" is honest, "3 of 3" is not.
    progress: { total, done },
    milestones,
    timeline: tagged
      .filter((i) => i.kind === 'event')
      .map((e) => ({
        id: String(e.id),
        event_type: String(e.event_type),
        title: String(e.title),
        created_at: String(e.created_at),
      }))
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),
    documents: tagged
      .filter((i) => i.kind === 'document')
      .map((d) => ({
        id: String(d.id),
        title: String(d.title),
        category: String(d.category),
        status: (d.status as string | null) ?? null,
        expires_at: (d.expires_at as string | null) ?? null,
        superseded: Boolean(d.superseded_by),
        mime_type: (d.mime_type as string | null) ?? null,
      })),
    updates: projectUpdates(tagged),
  };
}

/** Updates the audience may see, newest first. An update that a later
 *  visible update corrects is kept and marked, never hidden: the
 *  snapshot is the record of what was said. */
function projectUpdates(tagged: Tagged[]): ExternalUpdateView[] {
  const rows = tagged.filter((i) => i.kind === 'update');
  const supersededIds = new Set(
    rows
      .map((u) => u.supersedes_update_id as string | null)
      .filter((id): id is string => Boolean(id))
  );
  return rows
    .map((u) => ({
      id: String(u.id),
      headline: String(u.headline),
      body: (u.body as string | null) ?? null,
      snapshot: u.snapshot as DealUpdateSnapshot,
      supersedes_update_id: (u.supersedes_update_id as string | null) ?? null,
      superseded: supersededIds.has(String(u.id)),
      published_by_name: (u.published_by_name as string | null) ?? null,
      created_at: String(u.created_at),
    }))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

/**
 * The stakeholder's view of their deal and, when it is bundled, of the
 * sibling deals they are the same person on. Every deal goes through
 * the resolver as its own audience: on a sibling the party id is the
 * matching stakeholder row there, never the one from the primary deal.
 */
export function buildExternalPortalView(args: {
  stakeholder: DealStakeholder;
  deal: ExternalDealSource;
  siblings?: readonly ExternalDealSource[];
}): ExternalPortalView | null {
  const { stakeholder, deal, siblings = [] } = args;
  const primaryAudience: Audience = {
    kind: 'external',
    side: stakeholder.side,
    partyId: stakeholder.id,
  };
  const [primary] = projectBundleForAudience(
    [toProjectable(deal)],
    primaryAudience
  );
  if (!primary) return null;

  const bundle: ExternalDealView[] = [];
  for (const sibling of siblings) {
    if (sibling.id === deal.id) continue;
    const twin = stakeholderTwinOn(stakeholder, sibling);
    if (!twin) continue;
    const [projected] = projectBundleForAudience([toProjectable(sibling)], {
      kind: 'external',
      side: stakeholder.side,
      partyId: twin.id,
    });
    if (projected)
      bundle.push(toView(projected.deal, projected.items, sibling));
  }

  return {
    stakeholder: {
      name: stakeholder.name,
      role: stakeholder.role,
      side: stakeholder.side,
    },
    deal: toView(primary.deal, primary.items, deal),
    bundle,
  };
}

/** The stakeholder's own row on a bundle sibling — the same person, on
 *  the same side — or null when they are not party to it. The view
 *  uses this to decide which siblings to show; the document route uses
 *  it to decide which siblings' documents may be fetched. */
export function stakeholderTwinOn(
  stakeholder: Pick<DealStakeholder, 'side' | 'contact_id' | 'phone' | 'email'>,
  sibling: Pick<ExternalDealSource, 'stakeholders'>
): ExternalDealSource['stakeholders'][number] | null {
  return (
    sibling.stakeholders.find(
      (s) => s.side === stakeholder.side && isSamePerson(stakeholder, s)
    ) ?? null
  );
}

/** Whether one document may be fetched by this stakeholder. The same
 *  rule the view applies, re-checked at the byte boundary. */
export function canStakeholderOpenDocument(
  stakeholder: Pick<DealStakeholder, 'side'>,
  document: { visibility: DealVisibility }
): boolean {
  const [projected] = projectBundleForAudience(
    [
      {
        id: 'doc-check',
        parties: {
          buyer_party_ids: ['me'],
          seller_party_ids: ['me'],
        },
        items: [{ visibility: document.visibility }],
      },
    ],
    { kind: 'external', side: stakeholder.side, partyId: 'me' }
  );
  return Boolean(projected && projected.items.length === 1);
}
