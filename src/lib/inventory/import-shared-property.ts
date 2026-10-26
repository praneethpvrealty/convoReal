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
