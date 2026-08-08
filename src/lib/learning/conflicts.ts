// ============================================================
// "Something disagrees with this record — which is right?"
//
// Three sources ask an agent the same question and used to ask it in
// three places (or, for two of them, nowhere):
//
//   a fact learned from a chat that contradicts the listing
//   a portal copy whose price or extent differs from ours
//   — and, in time, anything else that notices a conflict
//
// They resolve differently, so the type keeps them apart: a proposal
// has a value the Engine can write once someone says yes, while portal
// drift has two numbers and no idea which is correct — that is settled
// by a survey or a phone call, not by picking the newer row. What they
// share is the only thing that matters for a queue: an agent has to
// look, and until they do the record is not trustworthy.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { fieldPolicy, formatValue, type LearnedEntity } from './fields';
import {
  findPortalDiscrepancies,
  type PortalListingFigures,
} from '@/lib/portals/listing-reconcile';

export interface ProposalConflict {
  kind: 'proposal';
  id: string;
  entity: LearnedEntity;
  entityId: string;
  entityLabel: string;
  field: string;
  fieldLabel: string;
  currentText: string;
  proposedText: string;
  evidence: string;
  source: string;
  createdAt: string;
}

export interface PortalDriftConflict {
  kind: 'portal_drift';
  /** Stable within a response, for React keys — there is no row. */
  id: string;
  entity: 'property';
  entityId: string;
  entityLabel: string;
  field: string;
  fieldLabel: string;
  oursText: string;
  theirsText: string;
  portalLabel: string;
  listingUrl: string | null;
}

export type ConflictItem = ProposalConflict | PortalDriftConflict;

interface FactRow {
  id: string;
  entity_type: LearnedEntity;
  entity_id: string;
  field: string;
  previous_value: unknown;
  value: unknown;
  evidence: string;
  source: string;
  created_at: string;
}

/** Turns stored facts into review cards, dropping any whose field has
 *  left the registry or whose record has been deleted. */
export function toProposalConflicts(
  rows: FactRow[],
  labels: Map<string, string>
): ProposalConflict[] {
  const out: ProposalConflict[] = [];
  for (const row of rows) {
    const policy = fieldPolicy(row.entity_type, row.field);
    if (!policy) continue;
    const entityLabel = labels.get(`${row.entity_type}:${row.entity_id}`);
    if (!entityLabel) continue;

    out.push({
      kind: 'proposal',
      id: row.id,
      entity: row.entity_type,
      entityId: row.entity_id,
      entityLabel,
      field: row.field,
      fieldLabel: policy.label,
      currentText: formatValue(policy, row.previous_value),
      proposedText: formatValue(policy, row.value),
      evidence: row.evidence,
      source: row.source,
      createdAt: row.created_at,
    });
  }
  return out;
}

const PORTAL_FIELD_LABELS: Record<string, string> = {
  price: 'Price',
  area_sqft: 'Area',
  bedrooms: 'Bedrooms',
};

function portalValueText(field: string, value: number): string {
  if (field === 'price') return '₹' + value.toLocaleString('en-IN');
  if (field === 'area_sqft') return `${value.toLocaleString('en-IN')} sq.ft.`;
  return String(value);
}

export function toPortalConflicts(
  propertyId: string,
  entityLabel: string,
  property: Parameters<typeof findPortalDiscrepancies>[0],
  listings: PortalListingFigures[]
): PortalDriftConflict[] {
  return findPortalDiscrepancies(property, listings).map((d) => ({
    kind: 'portal_drift' as const,
    id: `${propertyId}:${d.portal}:${d.field}`,
    entity: 'property' as const,
    entityId: propertyId,
    entityLabel,
    field: d.field,
    fieldLabel: PORTAL_FIELD_LABELS[d.field] ?? d.field,
    oursText: portalValueText(d.field, d.ours),
    theirsText: portalValueText(d.field, d.theirs),
    portalLabel: d.portalLabel,
    listingUrl: d.listingUrl,
  }));
}

/** Cap on rows read per source. A queue nobody can finish is a queue
 *  nobody starts; the newest items are the ones still actionable. */
const MAX_PER_SOURCE = 100;

/**
 * Everything awaiting an agent's judgement, for the whole account or
 * for one listing. Proposals first — they are one tap from resolved,
 * where portal drift needs a phone call.
 */
export async function loadConflicts(
  db: SupabaseClient,
  accountId: string,
  propertyId?: string | null
): Promise<ConflictItem[]> {
  let factQuery = db
    .from('learned_facts')
    .select(
      'id, entity_type, entity_id, field, previous_value, value, evidence, source, created_at'
    )
    .eq('account_id', accountId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(MAX_PER_SOURCE);
  if (propertyId) {
    factQuery = factQuery.eq('entity_type', 'property').eq('entity_id', propertyId);
  }

  let portalQuery = db
    .from('portal_import_items')
    .select('portal, listing_url, price, area_sqft, bedrooms, matched_property_id')
    .eq('account_id', accountId)
    .not('matched_property_id', 'is', null)
    .in('match_status', ['linked', 'auto_matched', 'imported'])
    .limit(MAX_PER_SOURCE);
  if (propertyId) portalQuery = portalQuery.eq('matched_property_id', propertyId);

  const [{ data: facts }, { data: portalRows }] = await Promise.all([
    factQuery,
    portalQuery,
  ]);

  // One lookup for every record either source mentions. Ids are
  // collected first so this stays a single bounded query per table
  // rather than one per row.
  const propertyIds = new Set<string>();
  const contactIds = new Set<string>();
  for (const row of (facts ?? []) as FactRow[]) {
    (row.entity_type === 'property' ? propertyIds : contactIds).add(row.entity_id);
  }
  for (const row of portalRows ?? []) {
    propertyIds.add(row.matched_property_id as string);
  }

  const [properties, contacts] = await Promise.all([
    propertyIds.size
      ? db
          .from('properties')
          .select('id, title, property_code, price, area_sqft, land_area, land_area_unit, bedrooms')
          .eq('account_id', accountId)
          .in('id', [...propertyIds])
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    contactIds.size
      ? db
          .from('contacts')
          .select('id, name, phone')
          .eq('account_id', accountId)
          .in('id', [...contactIds])
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);

  const labels = new Map<string, string>();
  const propertyById = new Map<string, Record<string, unknown>>();
  for (const p of (properties.data ?? []) as Record<string, unknown>[]) {
    const id = p.id as string;
    propertyById.set(id, p);
    labels.set(
      `property:${id}`,
      [p.title, p.property_code].filter(Boolean).join(' · ')
    );
  }
  for (const c of (contacts.data ?? []) as Record<string, unknown>[]) {
    labels.set(
      `contact:${c.id as string}`,
      (c.name as string) || (c.phone as string) || 'Contact'
    );
  }

  const proposals = toProposalConflicts((facts ?? []) as FactRow[], labels);

  const byProperty = new Map<string, PortalListingFigures[]>();
  for (const row of portalRows ?? []) {
    const id = row.matched_property_id as string;
    const list = byProperty.get(id) ?? [];
    list.push({
      portal: row.portal as PortalListingFigures['portal'],
      listingUrl: row.listing_url as string | null,
      price: row.price as number | null,
      areaSqft: row.area_sqft as number | null,
      bedrooms: row.bedrooms as number | null,
    });
    byProperty.set(id, list);
  }

  const drift: PortalDriftConflict[] = [];
  for (const [id, listings] of byProperty) {
    const property = propertyById.get(id);
    const label = labels.get(`property:${id}`);
    if (!property || !label) continue;
    drift.push(...toPortalConflicts(id, label, property, listings));
  }

  return [...proposals, ...drift];
}
