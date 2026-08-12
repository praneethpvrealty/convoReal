// ============================================================
// Column lists and compact row shapes for /api/v1.
//
// `Property` carries 50+ columns and `Contact` nearly as many. The
// consumer of this surface is a language model paying for every token
// it reads, so v1 returns a deliberately small projection rather than
// `select('*')` — enough to answer "which listing is this and does it
// fit", with the full record a `get` away.
//
// Two field lists per resource, and the distinction matters:
//
//   *_COLUMNS         — what goes on the wire.
//   MATCHING_*_COLUMNS — what src/lib/matching.ts actually reads.
//
// The matching engine degrades silently when a field it consults is
// absent: a contact whose `pref_budget_max` was not selected looks
// like a contact with no budget constraint, and scores accordingly.
// So the matching lists are derived from the engine's own field
// access, not from what looks useful, and the two are kept separate
// so trimming a response can never quietly change a score.
// ============================================================

import type { Contact, Property } from "@/types";

export const PROPERTY_COLUMNS = [
  "id",
  "title",
  "price",
  "price_per_sqft",
  "location",
  "sublocality",
  "city",
  "state",
  "type",
  "listing_type",
  "status",
  "project",
  "bedrooms",
  "bathrooms",
  "area_sqft",
  "area_unit",
  "land_area",
  "land_area_unit",
  "rent_per_month",
  "rental_income",
  "roi",
  "possession_date",
  "is_published",
  "created_at",
  "updated_at",
].join(", ");

/** Every property field src/lib/matching.ts consults, plus `id` to key
 *  the result. Superset of what the engine reads today so a new lookup
 *  in the engine does not silently start scoring against nulls. */
export const MATCHING_PROPERTY_COLUMNS = [
  "id",
  "title",
  "price",
  "location",
  "sublocality",
  "city",
  "type",
  "listing_type",
  "project",
  "bedrooms",
  "rent_per_month",
  "rental_income",
  "roi",
  "latitude",
  "longitude",
].join(", ");

export const CONTACT_COLUMNS = [
  "id",
  "name",
  "second_name",
  "phone",
  "email",
  "company",
  "classification",
  "lead_temp",
  "status",
  "min_budget",
  "max_budget",
  "no_budget",
  "areas_of_interest",
  "projects_of_interest",
  "property_interests",
  "requirements",
  "requirement_active",
  "last_contacted_at",
  "created_at",
  "updated_at",
].join(", ");

/** Every contact field the matching engine consults. `contact_notes`
 *  is a join, not a column — the engine reads note text when a
 *  contact has no structured preferences. */
export const MATCHING_CONTACT_COLUMNS = [
  "id",
  "name",
  "phone",
  "classification",
  "lead_temp",
  "min_budget",
  "max_budget",
  "no_budget",
  "min_roi",
  "areas_of_interest",
  "areas_of_interest_geo",
  "projects_of_interest",
  "property_interests",
  "requirements",
  "requirement_active",
  "strict_area_match",
  "strict_project_match",
  "is_archived",
  "is_dead",
  "pref_areas",
  "pref_excluded_areas",
  "pref_bhk_min",
  "pref_bhk_max",
  "pref_budget_min",
  "pref_budget_max",
  "pref_listing_types",
  "pref_projects",
  "pref_property_categories",
  "pref_property_types",
  "pref_min_roi",
  "pref_extracted_at",
  "contact_notes(note_text)",
].join(", ");

export interface V1Property {
  id: string;
  title: string;
  price: number | null;
  location: string | null;
  city: string | null;
  type: string | null;
  listing_type: string | null;
  status: string | null;
  project: string | null;
  bedrooms: number | null;
  area_sqft: number | null;
  rent_per_month: number | null;
  roi: number | null;
  is_published: boolean;
  updated_at: string | null;
}

export interface V1Contact {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  classification: string | null;
  lead_temp: string | null;
  budget: { min: number | null; max: number | null; unconstrained: boolean };
  areas_of_interest: string[];
  requirements: string | null;
  requirement_active: boolean;
  last_contacted_at: string | null;
}

export type Row = Record<string, unknown>;

/**
 * Narrow a PostgREST result to plain rows.
 *
 * `ctx.db` is an untyped `SupabaseClient`, so supabase-js parses the
 * select string at the type level to infer a row shape. It gives up on
 * embedded joins and on constants composed with a template literal,
 * yielding `GenericStringError` — a compile-time artefact, not a
 * runtime one; the rows are ordinary objects either way. Every v1
 * select is one or both of those shapes, so they all land here rather
 * than each growing its own `as unknown as` cast.
 */
export function asRows(data: unknown): Row[] {
  return (data ?? []) as Row[];
}

export function asRow(data: unknown): Row {
  return data as Row;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function list(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/**
 * `sublocality` + `location` → one readable line.
 *
 * Both columns are free text an agent typed or a Places lookup filled
 * in, and in real inventory they overlap almost always rather than
 * almost never: `sublocality` is typically a component of `location`
 * ("HSR Layout" inside "19th Main road, HSR Layout, Bengaluru,
 * Karnataka"). Prepending it unconditionally therefore repeats it on
 * most rows, not the rare one.
 *
 * The stored `location` is also frequently self-repeating, because the
 * intake path has appended the locality more than once over time —
 * "Agara, HSR Layout, Agara, HSR Layout, Bangalore, Karnataka", and one
 * row with the same phrase three times. That is upstream data, not
 * something this function can fix, but it should not be passed through
 * to a reader either.
 *
 * So: dedupe repeated comma segments, then add `sublocality` only when
 * the result genuinely does not already say it.
 */
function composeLocation(sublocality: string | null, location: string | null): string | null {
  const cleaned = location ? dedupeSegments(location) : null;
  if (!cleaned) return sublocality;
  if (!sublocality) return cleaned;
  return cleaned.toLowerCase().includes(sublocality.toLowerCase())
    ? cleaned
    : `${sublocality}, ${cleaned}`;
}

/** Drop comma-separated segments that have already appeared, keeping
 *  the first occurrence and the original order. */
function dedupeSegments(value: string): string | null {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const raw of value.split(",")) {
    const segment = raw.trim();
    if (!segment) continue;
    const key = segment.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(segment);
  }
  return kept.length > 0 ? kept.join(", ") : null;
}

/** Full-fidelity row → the compact wire shape. */
export function toV1Property(row: Row | Property): V1Property {
  const r = row as Row;
  return {
    id: String(r.id),
    title: str(r.title) ?? "(untitled)",
    price: num(r.price),
    location: composeLocation(str(r.sublocality), str(r.location)),
    city: str(r.city),
    type: str(r.type),
    listing_type: str(r.listing_type),
    status: str(r.status),
    project: str(r.project),
    bedrooms: num(r.bedrooms),
    area_sqft: num(r.area_sqft),
    rent_per_month: num(r.rent_per_month),
    roi: num(r.roi),
    is_published: Boolean(r.is_published),
    updated_at: str(r.updated_at),
  };
}

/** The single-property view. Same shape as the list row plus the
 *  fields that are too bulky to repeat across a page of results. */
export function toV1PropertyDetail(row: Row | Property) {
  const r = row as Row;
  return {
    ...toV1Property(r),
    description: str(r.description),
    state: str(r.state),
    price_per_sqft: num(r.price_per_sqft),
    bathrooms: num(r.bathrooms),
    area_unit: str(r.area_unit),
    land_area: num(r.land_area),
    land_area_unit: str(r.land_area_unit),
    rental_income: num(r.rental_income),
    possession_date: str(r.possession_date),
    created_at: str(r.created_at),
  };
}

export function toV1Contact(row: Row | Contact): V1Contact {
  const r = row as Row;
  const name = [str(r.name), str(r.second_name)].filter(Boolean).join(" ");
  return {
    id: String(r.id),
    name: name || null,
    phone: str(r.phone),
    email: str(r.email),
    classification: str(r.classification),
    lead_temp: str(r.lead_temp),
    budget: {
      min: num(r.min_budget),
      max: num(r.max_budget),
      unconstrained: Boolean(r.no_budget),
    },
    areas_of_interest: list(r.areas_of_interest),
    requirements: str(r.requirements),
    // Column defaults to true; only an explicit false parks a requirement.
    requirement_active: r.requirement_active !== false,
    last_contacted_at: str(r.last_contacted_at),
  };
}

/** The single-contact view: the list shape plus the stated brief, which
 *  is what a caller asking about one contact actually wants. */
export function toV1ContactDetail(row: Row | Contact) {
  const r = row as Row;
  return {
    ...toV1Contact(r),
    company: str(r.company),
    status: str(r.status),
    projects_of_interest: list(r.projects_of_interest),
    property_interests: list(r.property_interests),
    strict_area_match: Boolean(r.strict_area_match),
    strict_project_match: Boolean(r.strict_project_match),
    created_at: str(r.created_at),
  };
}
