// The enquired property, recovered from the portal's own words.
//
// A portal CRM export names what the lead enquired about only inside
// prose — "This user is looking for 3 BHK Residential House for Sale in
// Block 3rd Koramangala, Bangalore and has viewed your contact
// details." Resolving that to an inventory row is usually impossible:
// the listing is expired and was never in the Engine. But the anchored
// re-engagement template does not need a property row, it needs a
// description the lead will recognise as their own enquiry — and the
// prose already is one.
//
// The description feeds a body param of an approved template. Params
// cannot change a template's category, so extracting a richer
// description carries no Marketing-reclassification risk; the only
// hard rules are Meta's param rules (no newlines, bounded length),
// which sanitizeTemplateParam enforces.

import { sanitizeTemplateParam } from '@/lib/whatsapp/inventory-update-template';

/**
 * "This user is looking for X and has viewed your contact details." → X.
 *
 * Deliberately anchored on "looking for", which every portal's enquiry
 * blurb shares, rather than on any one portal's full sentence. Returns
 * null when the note carries no such phrase — the caller falls back to
 * the generic template, never to a message with a hole in it.
 *
 * The SQL twin in reengagement_batch_split (migration 223) must stay
 * at least as strict as this: a lead the split counts as anchored but
 * this function cannot describe would be failed at send time instead
 * of falling back.
 */
export function extractEnquiredPropertyFromNote(
  note: string | null | undefined
): string | null {
  if (!note) return null;

  const match = /looking for\s+([\s\S]+)/i.exec(note);
  if (!match) return null;

  let description = match[1]
    // MagicBricks: "... and has viewed your contact details."
    // Housing/99acres phrase their trailers differently, but all as an
    // "and has <verb>ed ..." clause bolted onto the requirement.
    .replace(/\s*\band\s+has\s+\w+ed\b[\s\S]*$/i, '')
    .replace(/[\s.,;:!-]+$/g, '')
    .trim();

  // The portal repeats the locality when sublocality and locality are
  // the same ("... in Kumaraswamy Layout, Kumaraswamy Layout,
  // Bangalore") — one of them is noise in a message a person reads.
  // The repeat is a suffix of the previous segment, not its equal:
  // "…for Sale in Kumaraswamy Layout" is followed by "Kumaraswamy
  // Layout".
  const segments = description.split(',').map((s) => s.trim());
  const deduped = segments.filter(
    (seg, i) =>
      i === 0 ||
      seg.length === 0 ||
      !segments[i - 1].toLowerCase().endsWith(seg.toLowerCase())
  );
  description = deduped.filter(Boolean).join(', ');

  if (description.length < 3) return null;
  return sanitizeTemplateParam(description);
}
