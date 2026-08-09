// ============================================================
// Projects: the shared half of a multi-unit listing.
//
// Grouping used to be a string. `properties.project` still holds the
// name and still drives the public /projects/[slug] page and the
// named-project match, so nothing here replaces it — a project row
// carries what the string never could: one map pin, one brochure, one
// set of amenities, and a unit count that means something.
//
// Pricing is the reason this module has no `price` field. "From
// ₹8,200/sqft" is min(price/area) over AVAILABLE units, recomputed on
// read: stored, it would be wrong the day the cheapest unit sells, and
// a premium unit would need special handling instead of simply
// carrying a higher price and no longer being the minimum.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Project, ProjectUnitStats, Property } from '@/types';
import { slugifyProject } from '@/lib/inventory/project-slug';

/** A project plus what its units currently add up to. */
export interface ProjectWithStats extends Project {
  stats: ProjectUnitStats;
}

const EMPTY_STATS: Omit<ProjectUnitStats, 'project_id'> = {
  units: 0,
  available: 0,
  sold_or_contract: 0,
  min_price: null,
  max_price: null,
  min_rate_per_sqft: null,
  max_rate_per_sqft: null,
  min_bedrooms: null,
  max_bedrooms: null,
};

/**
 * A slug that is free within this account.
 *
 * The uniqueness is enforced by an index, so this only avoids the
 * round-trip of a rejected insert — two "Sattva Exotic" projects in one
 * brokerage become sattva-exotic and sattva-exotic-2 rather than an
 * error the agent has to interpret.
 */
export async function availableProjectSlug(
  db: SupabaseClient,
  accountId: string,
  name: string,
): Promise<string> {
  const base = slugifyProject(name) || 'project';
  const { data } = await db
    .from('projects')
    .select('slug')
    .eq('account_id', accountId)
    .like('slug', `${base}%`);

  const taken = new Set((data ?? []).map((r) => r.slug as string));
  if (!taken.has(base)) return base;
  for (let n = 2; n < 100; n++) {
    if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
  }
  return `${base}-${Date.now()}`;
}

/**
 * Every project in the account with its live unit numbers.
 *
 * Two queries regardless of project count: the rows, and one grouped
 * aggregate over properties. Counting units per project in the browser
 * would mean shipping every unit row to render a list of projects.
 */
export async function listProjects(
  db: SupabaseClient,
  accountId: string,
): Promise<ProjectWithStats[]> {
  const [{ data: rows, error }, { data: statRows }] = await Promise.all([
    db
      .from('projects')
      .select('*')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false }),
    db.rpc('project_unit_stats', { p_account_id: accountId }),
  ]);
  if (error) {
    console.error('[projects] list failed:', error);
    return [];
  }

  const byId = new Map<string, ProjectUnitStats>(
    ((statRows ?? []) as ProjectUnitStats[]).map((s) => [s.project_id, s]),
  );

  return ((rows ?? []) as Project[]).map((p) => ({
    ...p,
    stats: byId.get(p.id) ?? { project_id: p.id, ...EMPTY_STATS },
  }));
}

/** One project by slug, or null. */
export async function projectBySlug(
  db: SupabaseClient,
  accountId: string,
  slug: string,
): Promise<Project | null> {
  const { data, error } = await db
    .from('projects')
    .select('*')
    .eq('account_id', accountId)
    .eq('slug', slug)
    .maybeSingle();
  if (error) {
    console.error('[projects] lookup failed:', error);
    return null;
  }
  return (data as Project) ?? null;
}

/**
 * The units in a project, ordered the way a buyer reads a tower:
 * tower, then floor, then unit number. Sold units are included — a
 * grid that hides them looks smaller than the project is, and "3 of 12
 * sold" is the more persuasive line anyway.
 */
export async function projectUnits(
  db: SupabaseClient,
  accountId: string,
  projectId: string,
): Promise<Property[]> {
  const { data, error } = await db
    .from('properties')
    .select('*')
    .eq('account_id', accountId)
    .eq('project_id', projectId)
    .order('tower', { ascending: true, nullsFirst: true })
    .order('floor_number', { ascending: true, nullsFirst: true })
    .order('unit_no', { ascending: true, nullsFirst: true });
  if (error) {
    console.error('[projects] units failed:', error);
    return [];
  }
  return (data ?? []) as Property[];
}

/**
 * Attach units to a project, or detach them with a null projectId.
 *
 * The name on `properties.project` follows automatically — a trigger
 * sets it from the project, so the string every existing reader
 * depends on cannot drift from the link.
 *
 * Returns how many rows actually moved: RLS refusing the write comes
 * back as zero rows rather than an error, and a caller reporting
 * "attached" on that would be lying.
 */
export async function setUnitsProject(
  db: SupabaseClient,
  accountId: string,
  propertyIds: string[],
  projectId: string | null,
): Promise<number> {
  if (propertyIds.length === 0) return 0;
  const { data, error } = await db
    .from('properties')
    .update({ project_id: projectId })
    .eq('account_id', accountId)
    .in('id', propertyIds)
    .select('id');
  if (error) {
    console.error('[projects] attach failed:', error);
    throw error;
  }
  return data?.length ?? 0;
}

/**
 * The project a freshly-intaken listing belongs to, if the account
 * already has one by that name.
 *
 * WhatsApp intake produced orphans: an agent forwarding four floor
 * plans from one tower got four unrelated listings, each repeating the
 * project name as text and none of them counted in it. The name is
 * already in the message — matching it to a project the agent created
 * is the difference between "12 units, from ₹8,200/sqft" and twelve
 * listings that happen to share a string.
 *
 * Match is on the slug, so "Sattva Exotic", "sattva exotic" and
 * "Sattva  Exotic" all find the same row. Never CREATES a project: an
 * agent naming a tower in passing has not decided to track it as one,
 * and a project invented from a typo would be worse than no link at
 * all — the text column still carries the name either way.
 */
export async function matchProjectByName(
  db: SupabaseClient,
  accountId: string,
  projectName: string | null | undefined,
): Promise<string | null> {
  const slug = slugifyProject(projectName ?? '');
  if (!slug) return null;
  try {
    const { data, error } = await db
      .from('projects')
      .select('id')
      .eq('account_id', accountId)
      .eq('slug', slug)
      .maybeSingle();
    if (error) {
      console.error('[projects] name match failed:', error);
      return null;
    }
    return (data?.id as string) ?? null;
  } catch (err) {
    // Never let this cost the listing. An unlinked property is a
    // working property; a failed insert is not.
    console.error('[projects] name match threw:', err);
    return null;
  }
}
