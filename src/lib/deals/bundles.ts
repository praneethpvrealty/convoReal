/**
 * Bundles: one buyer closing several deals at once — Adithi on Sites
 * #19 and #20. The rule lives in POST /api/deal-groups (two to twenty
 * deals, none already bundled); this module is the picker's vocabulary,
 * mirrored in mobile/lib/deal-workspace.ts and guarded by
 * mobile-parity.test.ts, so both surfaces offer the same deals in the
 * same order under the same default name.
 */

export const BUNDLE_MIN_DEALS = 2;
export const BUNDLE_MAX_DEALS = 20;
export const BUNDLE_NAME_MAX = 120;

export interface BundleCandidate {
  id: string;
  title: string;
  contact_id: string | null;
  contact_name: string | null;
  property_title: string | null;
  property_unit_no: string | null;
  stage_name: string | null;
  deal_group_id: string | null;
}

export interface BundleAnchor {
  id: string;
  contact_id: string | null;
}

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** "Property No. 19", else the property title, else the deal title. */
export function bundleCandidateLabel(
  row: Pick<BundleCandidate, 'title' | 'property_title' | 'property_unit_no'>
): string {
  const unit = clean(row.property_unit_no);
  if (unit) return `Property No. ${unit}`;
  return clean(row.property_title) ?? row.title;
}

/** The deals a bundle can take from this one: never itself, never a
 *  deal already in a bundle. The same buyer's deals come first, since
 *  that is what a bundle almost always is; the rest follow by label. */
export function bundleCandidates<T extends BundleCandidate>(
  rows: readonly T[],
  anchor: BundleAnchor
): T[] {
  return rows
    .filter((r) => r.id !== anchor.id && !r.deal_group_id)
    .sort((a, b) => {
      const aSame =
        Boolean(anchor.contact_id) && a.contact_id === anchor.contact_id;
      const bSame =
        Boolean(anchor.contact_id) && b.contact_id === anchor.contact_id;
      if (aSame !== bSame) return aSame ? -1 : 1;
      return bundleCandidateLabel(a).localeCompare(bundleCandidateLabel(b));
    });
}

/** Pre-ticked: the same buyer's other deals. */
export function sameBuyerIds(
  candidates: readonly BundleCandidate[],
  anchor: BundleAnchor
): string[] {
  if (!anchor.contact_id) return [];
  return candidates
    .filter((c) => c.contact_id === anchor.contact_id)
    .map((c) => c.id);
}

/** The buyer's name, else a plain label; never longer than the route
 *  accepts. */
export function defaultBundleName(
  contactName: string | null | undefined
): string {
  const who = clean(contactName);
  return (who ? `${who} — linked purchases` : 'Linked purchases').slice(
    0,
    BUNDLE_NAME_MAX
  );
}

/** Why the bundle cannot be created yet, or null when it can. */
export function bundleBlocker(
  name: string,
  selectedCount: number
): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'Give the bundle a name.';
  if (trimmed.length > BUNDLE_NAME_MAX) {
    return `Keep the name under ${BUNDLE_NAME_MAX} characters.`;
  }
  if (selectedCount < BUNDLE_MIN_DEALS) {
    return 'Pick at least one more deal to bundle with this one.';
  }
  if (selectedCount > BUNDLE_MAX_DEALS) {
    return `A bundle holds at most ${BUNDLE_MAX_DEALS} deals.`;
  }
  return null;
}
