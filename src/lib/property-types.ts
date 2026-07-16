/**
 * Canonical property type taxonomy, shared between the server-side AI
 * parsers (src/lib/ai/gemini.ts, preference extraction) and the
 * client-side matching engine (src/lib/matching.ts).
 */

export const PROPERTY_TYPE_VALUES = [
  "Flat/ Apartment", "Residential House", "Villa", "Builder Floor Apartment",
  "Residential Land/ Plot", "Penthouse", "Studio Apartment", "Residential PG building",
  "PG/ Hostel", "Commercial Office Space", "Office in IT Park/ SEZ", "Commercial Shop",
  "Commercial Showroom", "Commercial Building", "Commercial Land", "Warehouse/ Godown",
  "Industrial Land", "Industrial Building", "Industrial Shed", "Agricultural Land",
  "Farm House", "Others",
] as const;

/**
 * Deterministic mapping of free text onto the canonical type enum. Used as
 * a backstop after AI parsing and to normalize legacy/manual type strings
 * before matching. Keyword-matches common phrasing so a real answer
 * survives even when the model's own mapping doesn't land exactly.
 */
export function normalizePropertyType(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const exact = PROPERTY_TYPE_VALUES.find((v) => v.toLowerCase() === trimmed.toLowerCase());
  if (exact) return exact;

  const lower = trimmed.toLowerCase();
  // Whole commercial buildings / mixed-use developments — must run
  // FIRST: their descriptions routinely mention the unit types inside
  // ("…with Hotel, Offices, Gym & Penthouse"), and any of those
  // keywords would otherwise win even though the asset being sold is
  // the building itself.
  if (lower.includes("mixed use") || lower.includes("mixed-use")) return "Commercial Building";
  if (
    lower.includes("commercial") &&
    (lower.includes("building") || lower.includes("complex") || lower.includes("development"))
  ) {
    return "Commercial Building";
  }
  if (lower.includes("hotel") || lower.includes("hypermarket") || (lower.includes("mall") && !lower.includes("small"))) {
    return "Commercial Building";
  }
  if (lower.includes("hostel")) return "PG/ Hostel";
  if (/\bpg\b/i.test(trimmed) || lower.includes("paying guest")) {
    return lower.includes("building") ? "Residential PG building" : "PG/ Hostel";
  }
  if (lower.includes("penthouse")) return "Penthouse";
  if (lower.includes("studio")) return "Studio Apartment";
  if (lower.includes("villa")) return "Villa";
  if (lower.includes("builder floor")) return "Builder Floor Apartment";
  if (lower.includes("farm house") || lower.includes("farmhouse")) return "Farm House";
  if (lower.includes("agricultural") || lower.includes("farmland") || lower.includes("farm land")) return "Agricultural Land";
  if (lower.includes("warehouse") || lower.includes("godown")) return "Warehouse/ Godown";
  if (lower.includes("industrial") && lower.includes("shed")) return "Industrial Shed";
  if (lower.includes("industrial") && lower.includes("building")) return "Industrial Building";
  if (lower.includes("industrial") && lower.includes("land")) return "Industrial Land";
  if (lower.includes("sez") || lower.includes("it park")) return "Office in IT Park/ SEZ";
  if (lower.includes("office")) return "Commercial Office Space";
  if (lower.includes("showroom")) return "Commercial Showroom";
  if (lower.includes("shop")) return "Commercial Shop";
  if (lower.includes("commercial") && lower.includes("land")) return "Commercial Land";
  if (lower.includes("plot") || (lower.includes("land") && !/industrial|commercial|agricultural/.test(lower))) return "Residential Land/ Plot";
  if (lower.includes("flat") || lower.includes("apartment")) return "Flat/ Apartment";
  if (lower.includes("house") || lower.includes("bungalow") || lower.includes("independent")) return "Residential House";
  // Preserve whatever was said rather than silently discarding it — an
  // account owner can still correct it later in the manual edit form.
  return trimmed;
}
