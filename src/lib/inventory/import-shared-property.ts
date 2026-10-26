import { supabaseAdmin } from '@/lib/supabase/admin';
import { UserFacingError, type AccountContext } from '@/lib/auth/account';
import { findOrCreateContact } from '@/lib/contacts/find-or-create';
import {
  buildSharedPropertyCopy,
  SHARED_PROPERTY_COLUMNS,
} from '@/lib/inventory/shared-property-copy';
import {
  isLocationGuarded,
  localityLabel,
} from '@/lib/inventory/location-privacy';
import { isTeaserGated } from '@/lib/inventory/showcase-visibility';
import { hasMinRole } from '@/lib/auth/roles';

/**
 * Imports another account's published listing into the caller's own
 * inventory, preserving cross-account lineage:
 *   - source_property_id → the upstream listing, so the ORIGINAL source
 *     agent's digest can count buyers this copy reaches as indirect.
 *   - owner_contact_id → the sharing brokerage, find-or-created as an
 *     Agent contact (listing_source 'agent'), so the sharer gets their
 *     own reach digest from this account.
 *
 * Only what the public showcase already shows is copied: a teaser-gated
 * listing is withheld outright, a location-guarded one arrives with the
 * locality label in place of the exact address and pin, and internal
 * notes, deal remarks, documents, floor tenancies and deal mode stay
 * behind. The copy lands unpublished for review. Idempotent: importing
 * the same source again returns the existing copy.
 */

export type SharedPropertySource = Record<string, unknown> & {
  id: string;
  account_id: string;
  type: string;
  is_published?: boolean | null;
  showcase_visibility?: string | null;
  location_privacy?: string | null;
  sublocality?: string | null;
  city?: string | null;
  state?: string | null;
};

export type ImportSharedPropertyResult =
  | { kind: 'not_found' }
  | { kind: 'withheld' }
  | { kind: 'own_listing'; id: string }
  | { kind: 'already_imported'; id: string }
  | { kind: 'imported'; id: string; title: string };

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function sharedPropertyImportSource(
  source: SharedPropertySource
): SharedPropertySource {
  if (!isLocationGuarded(source)) return source;
  return {
    ...source,
    location: localityLabel(source),
    google_map_link: null,
    latitude: null,
    longitude: null,
    locality_place_id: null,
    locality_canonical: null,
  };
}

export async function findImportedCopy(
  ctx: AccountContext,
  sourceId: string
): Promise<{ id: string } | null> {
  const { data } = await ctx.supabase
    .from('properties')
    .select('id')
    .eq('account_id', ctx.accountId)
    .eq('source_property_id', sourceId)
    .maybeSingle();
  return data ? { id: data.id as string } : null;
}

export async function lookupSharedPropertySource(
  sourceId: string
): Promise<SharedPropertySource | null> {
  const { data } = await supabaseAdmin()
    .from('properties')
    .select(SHARED_PROPERTY_COLUMNS)
    .eq('id', sourceId)
    .maybeSingle();
  const source = data as SharedPropertySource | null;
  // Only published listings are reachable via share links — an
  // unpublished id would let arbitrary UUIDs probe private inventory.
  if (!source || !source.is_published) return null;
  return source;
}

export async function importSharedProperty(
  ctx: AccountContext,
  sourceId: string
): Promise<ImportSharedPropertyResult> {
  const source = await lookupSharedPropertySource(sourceId);
  if (!source) return { kind: 'not_found' };
  if (source.account_id === ctx.accountId) {
    return { kind: 'own_listing', id: source.id };
  }
  if (isTeaserGated(source)) return { kind: 'withheld' };

  const existing = await findImportedCopy(ctx, source.id);
  if (existing) return { kind: 'already_imported', id: existing.id };

  const admin = supabaseAdmin();
  // The sharing brokerage becomes an Agent contact in the importer's
  // book — the same card a manual agent-referred listing would use.
  const [{ data: sourceAccount }, { data: sharerProfiles }] = await Promise.all(
    [
      admin
        .from('accounts')
        .select('name')
        .eq('id', source.account_id)
        .maybeSingle(),
      admin
        .from('profiles')
        .select('full_name, phone, org_role')
        .eq('account_id', source.account_id)
        .not('phone', 'is', null)
        .limit(10),
    ]
  );
  const sharer =
    (sharerProfiles || []).find((p) => p.org_role === 'org_manager') ||
    (sharerProfiles || [])[0] ||
    null;

  let sharerContactId: string | null = null;
  if (sharer?.phone) {
    const result = await findOrCreateContact(admin, {
      accountId: ctx.accountId,
      userId: ctx.userId,
      phone: sharer.phone,
      name: sharer.full_name || sourceAccount?.name || null,
      company: sourceAccount?.name || null,
      source: 'Shared Inventory',
      classification: 'Agent',
    });
    sharerContactId = result.contactId;
  }

  const { data: created, error: insertError } = await ctx.supabase
    .from('properties')
    .insert(
      buildSharedPropertyCopy(sharedPropertyImportSource(source), {
        accountId: ctx.accountId,
        userId: ctx.userId,
        ownerContactId: sharerContactId,
      })
    )
    .select('id, title')
    .single();

  if (insertError || !created) {
    console.error('[importSharedProperty] Insert error:', insertError);
    throw new UserFacingError('Failed to import property', 500);
  }

  return {
    kind: 'imported',
    id: created.id as string,
    title: created.title as string,
  };
}

/** The most listings one showcase probe may ask about. The ids travel
 *  in the query string, so the bound keeps the URL short; the showcase
 *  splits a larger catalog into several probes. */
export const MAX_VIEWER_LOOKUP = 60;

/** Who the caller is to one published listing, as the showcase's
 *  "Add to my inventory" control needs it. */
export interface ShowcaseImportViewer {
  /** The listing belongs to the caller's own account. */
  own: boolean;
  /** The caller may import it: agent or above, not read-only, the
   *  listing is another account's and is not teaser-gated. */
  canImport: boolean;
  /** The caller's account's existing copy of the listing, if any. */
  importedId: string | null;
}

/**
 * The caller's relationship to each published listing among `ids`.
 * An unpublished or unknown id is left out of the answer, exactly as the
 * public showcase leaves it out of the catalog.
 */
export async function showcaseImportViewers(
  ctx: AccountContext,
  ids: string[]
): Promise<Record<string, ShowcaseImportViewer>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return {};
  if (unique.length > MAX_VIEWER_LOOKUP) {
    throw new UserFacingError(
      `Ask about no more than ${MAX_VIEWER_LOOKUP} listings at a time`
    );
  }

  const { data: sourceRows, error: sourceError } = await supabaseAdmin()
    .from('properties')
    .select('id, account_id, is_published, showcase_visibility')
    .in('id', unique);
  if (sourceError) throw sourceError;
  const sources = (sourceRows ?? []).filter(
    (row) => row.is_published === true
  ) as Array<{
    id: string;
    account_id: string;
    showcase_visibility: string | null;
  }>;

  const foreignIds = sources
    .filter((row) => row.account_id !== ctx.accountId)
    .map((row) => row.id);
  const copies = new Map<string, string>();
  if (foreignIds.length > 0) {
    const { data: copyRows, error: copyError } = await ctx.supabase
      .from('properties')
      .select('id, source_property_id')
      .eq('account_id', ctx.accountId)
      .in('source_property_id', foreignIds);
    if (copyError) throw copyError;
    for (const row of copyRows ?? []) {
      copies.set(row.source_property_id as string, row.id as string);
    }
  }

  const canWrite = !ctx.isReadOnly && hasMinRole(ctx.role, 'agent');
  const viewers: Record<string, ShowcaseImportViewer> = {};
  for (const source of sources) {
    const own = source.account_id === ctx.accountId;
    viewers[source.id] = {
      own,
      canImport: !own && canWrite && !isTeaserGated(source),
      importedId: own ? null : (copies.get(source.id) ?? null),
    };
  }
  return viewers;
}
