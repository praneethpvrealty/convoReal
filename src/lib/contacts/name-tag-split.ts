// Phonebook names often carry a quick-reference qualifier after the real
// name — "Nataraj Bank DSA", "Ramesh HDFC", "Suresh Plumber 2". On import we
// suggest moving that qualifier into the contact's Name Tag so outbound
// messages (which use `name` alone) stay clean: "Hi Nataraj", not
// "Hi Nataraj Bank DSA". Deterministic on purpose — no AI call — and only a
// suggestion: every import surface keeps the fields editable.

// Role/trade/context words that mark where the qualifier starts. Lowercase.
const DESCRIPTOR_WORDS = new Set([
  // finance & channels
  'bank', 'dsa', 'loan', 'loans', 'finance', 'insurance', 'chit', 'chits',
  // real-estate roles
  'agent', 'broker', 'builder', 'developer', 'owner', 'buyer', 'seller',
  'tenant', 'lead', 'ref', 'referral', 'client',
  'realty', 'realtors', 'properties', 'property', 'estate', 'land', 'lands',
  'site', 'sites', 'plot', 'plots', 'layout', 'flat', 'flats', 'pg', 'rent',
  'rental', 'resale',
  // trades & services
  'driver', 'plumber', 'electrician', 'painter', 'carpenter', 'contractor',
  'mason', 'borewell', 'tiles', 'granite', 'marble', 'steel', 'cement',
  'sand', 'bricks', 'interior', 'interiors', 'fabrication', 'welding',
  // professionals & offices
  'advocate', 'lawyer', 'auditor', 'surveyor', 'valuer', 'notary', 'engineer',
  'architect', 'office', 'shop', 'store', 'agency', 'travels', 'courier',
  // registration / civic context
  'khata', 'registration', 'survey', 'panchayat', 'corporation', 'court',
]);

// Acronyms like DSA, SBI, HDFC, LIC, CA — all-caps, 2+ letters. Single
// letters are excluded so initials ("Praneeth Kumar S") never trigger.
function isDescriptorToken(token: string): boolean {
  const bare = token.replace(/[^\p{L}\p{N}]/gu, '');
  if (!bare) return false;
  if (/\d/.test(bare)) return true;
  if (DESCRIPTOR_WORDS.has(bare.toLowerCase())) return true;
  return bare.length >= 2 && bare === bare.toUpperCase() && /^[A-Z]+$/.test(bare);
}

const LOCALITY_SUFFIXES = new Set([
  'block',
  'cross',
  'layout',
  'main',
  'nagar',
  'phase',
  'road',
  'sector',
  'stage',
]);

function localityQualifierStart(tokens: string[]): number | null {
  for (let index = 1; index < tokens.length - 1; index++) {
    const prefix = tokens[index].replace(/[^\p{L}]/gu, '');
    const suffix = tokens[index + 1]
      .replace(/[^\p{L}]/gu, '')
      .toLowerCase();
    if (
      prefix.length >= 2 &&
      prefix.length <= 4 &&
      /^[A-Z][a-z]*$/.test(prefix) &&
      LOCALITY_SUFFIXES.has(suffix)
    ) {
      return index;
    }
  }
  return null;
}

export interface NameTagSplit {
  name: string;
  nameTag: string;
}

/** Suggest splitting "Nataraj Bank DSA" into name "Nataraj" + tag "Bank DSA".
 *  Returns null when the string looks like a plain name and should be left
 *  alone. The tag starts at the first descriptor token; everything before it
 *  stays as the name. */
export function suggestNameTagSplit(fullName: string): NameTagSplit | null {
  const tokens = fullName.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null;

  const descriptorAt = tokens.findIndex(isDescriptorToken);
  const localityAt = localityQualifierStart(tokens);
  const firstDescriptor =
    localityAt !== null && (descriptorAt === -1 || localityAt < descriptorAt)
      ? localityAt
      : descriptorAt;
  // No qualifier found, or the name would be empty ("Bank Manager Ravi").
  if (firstDescriptor <= 0) return null;

  return {
    name: tokens.slice(0, firstDescriptor).join(' '),
    nameTag: tokens.slice(firstDescriptor).join(' '),
  };
}
