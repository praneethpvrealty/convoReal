// ============================================================
// What the Engine is allowed to learn, and what happens when it does.
//
// One registry, because the decision belongs to the FIELD and not to
// whichever learner happened to reach it. A seller's floor price is
// always reviewed by a human, whether it arrived from an agent's
// WhatsApp reply or a portal sync. A buyer's stated budget is always
// applied on the spot, because the qualification ladder reads it back
// on the very next message and a review queue would stall the
// conversation it is meant to serve.
//
// The registry is also the write whitelist. A learner proposes a field
// name; nothing outside this table can reach a column, so a model that
// returns "is_published" or "account_id" is ignored rather than
// obeyed.
// ============================================================

export type LearnedEntity = 'property' | 'contact';

/** 'auto' writes on sight and leaves an audit row. 'propose' writes
 *  nothing until a human says so. */
export type Disposition = 'auto' | 'propose';

export type LearnedFactSource =
  | 'agent_reply'
  | 'lead_message'
  | 'owner_reply'
  | 'portal_sync'
  /** The next-morning read-back over a whole thread (src/lib/sweep/),
   *  as opposed to the four above, which all fire behind a single
   *  message. Worth telling apart in a review queue: a fact inferred
   *  from a conversation deserves more scepticism than one read out of
   *  the sentence that had just been typed. */
  | 'daily_sweep';

export type ValueKind = 'currency' | 'rate' | 'count' | 'percent' | 'boolean' | 'list';

/**
 * How an approved fact reaches the record. Most are a column write.
 * Tags are not: attaching one means finding or minting a row in `tags`
 * and joining it through `contact_tags`, which is a different write
 * with a different permission (minting a tag is admin+). Naming the
 * target here keeps that out of every learner.
 */
export type ApplyTarget = 'column' | 'contact_tags';

export interface FieldPolicy {
  entity: LearnedEntity;
  field: string;
  /** Column on the entity's table. Same as `field` today; kept explicit
   *  so a renamed column never silently stops being written. Ignored
   *  when `applyAs` is not 'column'. */
  column: string;
  label: string;
  disposition: Disposition;
  kind: ValueKind;
  applyAs?: ApplyTarget;
  /** Bounds for numeric fields, in the column's own units. */
  min?: number;
  max?: number;
}

const POLICIES: FieldPolicy[] = [
  // ── Property: commercial facts a human must confirm ──────────
  // An agent quoting a rate to one buyer can be a negotiating
  // position rather than a standing truth, and a mis-parse that
  // silently repriced live inventory would be worse than the
  // retyping it saves.
  {
    entity: 'property',
    field: 'seller_final_price',
    column: 'seller_final_price',
    label: "Seller's final price",
    disposition: 'propose',
    kind: 'currency',
    min: 100_000,
    max: 100_000_000_000,
  },
  {
    entity: 'property',
    field: 'seller_final_price_per_sqft',
    column: 'seller_final_price_per_sqft',
    label: "Seller's final rate (per Sq.Ft.)",
    disposition: 'propose',
    kind: 'rate',
    min: 100,
    max: 500_000,
  },

  // ── Contact: what a buyer said they want ─────────────────────
  // Auto, and it has to be: nextQualifier reads these back to decide
  // the next question, and matching reads them to decide what to
  // send. A pending queue here would mean the bot asking a buyer
  // something they answered thirty seconds ago.
  {
    entity: 'contact',
    field: 'pref_budget_min',
    column: 'pref_budget_min',
    label: 'Budget (min)',
    disposition: 'auto',
    kind: 'currency',
    min: 1_000,
    max: 100_000_000_000,
  },
  {
    entity: 'contact',
    field: 'pref_budget_max',
    column: 'pref_budget_max',
    label: 'Budget (max)',
    disposition: 'auto',
    kind: 'currency',
    min: 1_000,
    max: 100_000_000_000,
  },
  {
    entity: 'contact',
    field: 'no_budget',
    column: 'no_budget',
    label: 'No fixed budget',
    disposition: 'auto',
    kind: 'boolean',
  },
  {
    entity: 'contact',
    field: 'pref_land_area_min_sqft',
    column: 'pref_land_area_min_sqft',
    label: 'Plot size min (sq.ft)',
    disposition: 'auto',
    kind: 'count',
    min: 50,
    max: 10_000_000,
  },
  {
    entity: 'contact',
    field: 'pref_land_area_max_sqft',
    column: 'pref_land_area_max_sqft',
    label: 'Plot size max (sq.ft)',
    disposition: 'auto',
    kind: 'count',
    min: 50,
    max: 10_000_000,
  },
  {
    entity: 'contact',
    field: 'pref_bhk_min',
    column: 'pref_bhk_min',
    label: 'Bedrooms (min)',
    disposition: 'auto',
    kind: 'count',
    min: 1,
    max: 20,
  },
  {
    entity: 'contact',
    field: 'pref_bhk_max',
    column: 'pref_bhk_max',
    label: 'Bedrooms (max)',
    disposition: 'auto',
    kind: 'count',
    min: 1,
    max: 20,
  },
  {
    entity: 'contact',
    field: 'pref_areas',
    column: 'pref_areas',
    label: 'Preferred areas',
    disposition: 'auto',
    kind: 'list',
  },
  {
    entity: 'contact',
    field: 'pref_excluded_areas',
    column: 'pref_excluded_areas',
    label: 'Excluded areas',
    disposition: 'auto',
    kind: 'list',
  },
  {
    entity: 'contact',
    field: 'pref_projects',
    column: 'pref_projects',
    label: 'Named projects',
    disposition: 'auto',
    kind: 'list',
  },
  {
    entity: 'contact',
    field: 'pref_property_types',
    column: 'pref_property_types',
    label: 'Property types',
    disposition: 'auto',
    kind: 'list',
  },
  {
    entity: 'contact',
    field: 'pref_property_categories',
    column: 'pref_property_categories',
    label: 'Property categories',
    disposition: 'auto',
    kind: 'list',
  },
  {
    entity: 'contact',
    field: 'pref_listing_types',
    column: 'pref_listing_types',
    label: 'Deal types',
    disposition: 'auto',
    kind: 'list',
  },
  {
    entity: 'contact',
    field: 'pref_min_roi',
    column: 'pref_min_roi',
    label: 'Minimum yield',
    disposition: 'auto',
    kind: 'percent',
    min: 1,
    max: 100,
  },
  // The suggestion column itself is bookkeeping: writing it attaches
  // nothing and changes no matching, so it applies on sight like the
  // rest of the extraction. What it feeds is the row below.
  {
    entity: 'contact',
    field: 'pref_suggested_tags',
    column: 'pref_suggested_tags',
    label: 'Suggested tags',
    disposition: 'auto',
    kind: 'list',
  },
  // Attaching a real tag is not bookkeeping. Tags drive segments,
  // broadcasts and filters, and the taxonomy is shared across the
  // account — an auto-attached "Investor" that should have been
  // "Investors" is a duplicate every agent then has to work around.
  // So it is proposed, and approving it is what writes.
  {
    entity: 'contact',
    field: 'tags',
    column: 'tags',
    label: 'Tags',
    disposition: 'propose',
    kind: 'list',
    applyAs: 'contact_tags',
  },
];

const BY_KEY = new Map(POLICIES.map((p) => [`${p.entity}:${p.field}`, p]));

export function fieldPolicy(
  entity: LearnedEntity,
  field: string
): FieldPolicy | null {
  return BY_KEY.get(`${entity}:${field}`) ?? null;
}

export function dispositionFor(
  entity: LearnedEntity,
  field: string
): Disposition | null {
  return fieldPolicy(entity, field)?.disposition ?? null;
}

/** Every field a learner may target for this entity. */
export function learnableFields(entity: LearnedEntity): string[] {
  return POLICIES.filter((p) => p.entity === entity).map((p) => p.field);
}

/**
 * Coerces a learner's raw value to what the column takes, or null when
 * it is unusable.
 *
 * The bounds are not decoration. A model that reads "10.5k per sqft" as
 * 10.5 would otherwise propose a rate of ten and a half rupees, and a
 * reviewer working down a queue can approve a wrong number faster than
 * they can spot it.
 */
export function normalizeValue(
  policy: FieldPolicy,
  raw: unknown
): unknown | null {
  if (policy.kind === 'boolean') {
    return typeof raw === 'boolean' ? raw : null;
  }

  if (policy.kind === 'list') {
    if (!Array.isArray(raw)) return null;
    const cleaned = raw
      .filter((v): v is string => typeof v === 'string')
      .map((v) => v.trim())
      .filter(Boolean);
    // Deduped case-insensitively but kept as written — the display
    // casing is what an agent typed or a portal published.
    const seen = new Set<string>();
    const out: string[] = [];
    for (const v of cleaned) {
      const key = v.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(v);
    }
    return out;
  }

  if (raw === null || raw === '') return null;
  const num = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(num)) return null;
  if (policy.min !== undefined && num < policy.min) return null;
  if (policy.max !== undefined && num > policy.max) return null;
  return policy.kind === 'count' ? Math.round(num) : Math.round(num);
}

/**
 * A list value with unsupported REMOVALS put back.
 *
 * Extraction runs over the contact's whole brief, not just the newest
 * message, so every re-extraction restates the entire list — and
 * anything the model happens to omit reads as a deliberate deletion.
 * One buyer lost "Bangalore" from their areas on the message "only
 * commercial plots and building", which says nothing about location at
 * all. Nobody sees that happen: the areas simply stop matching, and
 * the contact looks like it was always that way.
 *
 * So a member the extraction dropped is kept unless the evidence
 * MENTIONS it. A buyer who says "not Bangalore any more" names the
 * thing they are dropping; a message about property types does not.
 *
 * The cost is a stale entry when someone narrows without naming what
 * they are giving up ("only Hebbal now" leaves Bangalore behind). That
 * is the right way round: a stale area over-matches and an agent sees
 * the listing, where a dropped area under-matches and nobody sees
 * anything.
 *
 * Additions are untouched — only removals need evidence.
 */
export function guardedListValue(
  previous: unknown,
  next: string[],
  evidence: string
): string[] {
  if (!Array.isArray(previous)) return next;
  const kept = new Set(next.map((v) => v.toLowerCase()));
  const said = (evidence || '').toLowerCase();

  const restored = previous.filter(
    (p): p is string =>
      typeof p === 'string' &&
      p.trim().length > 0 &&
      !kept.has(p.toLowerCase()) &&
      !said.includes(p.toLowerCase())
  );
  return restored.length ? [...next, ...restored] : next;
}

/**
 * Has this actually changed? Order-insensitive for lists, so a
 * re-extraction that reshuffled the same three areas is not a change
 * worth an audit row — or, on a proposed field, a review card.
 */
export function valuesDiffer(a: unknown, b: unknown): boolean {
  const bothLists = Array.isArray(a) && Array.isArray(b);
  if (bothLists) {
    const norm = (list: unknown[]) =>
      list
        .map((v) => String(v).toLowerCase())
        .sort()
        .join(' ');
    return norm(a) !== norm(b);
  }
  if (Array.isArray(a) || Array.isArray(b)) return true;
  if (a === null || a === undefined) return !(b === null || b === undefined);
  if (b === null || b === undefined) return true;
  return Number.isFinite(Number(a)) && Number.isFinite(Number(b))
    ? Number(a) !== Number(b)
    : String(a) !== String(b);
}

/** Human rendering for a review card or an audit line. */
export function formatValue(policy: FieldPolicy, value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (policy.kind === 'boolean') return value ? 'Yes' : 'No';
  if (policy.kind === 'list') {
    const list = Array.isArray(value) ? value : [];
    return list.length ? list.join(', ') : '—';
  }
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);
  if (policy.kind === 'currency') return '₹' + num.toLocaleString('en-IN');
  if (policy.kind === 'rate') return '₹' + num.toLocaleString('en-IN') + '/sq.ft.';
  if (policy.kind === 'percent') return `${num}%`;
  return String(num);
}
