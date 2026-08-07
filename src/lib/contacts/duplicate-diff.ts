export interface ComparableContact {
  phone?: string | null;
  email?: string | null;
  classification?: string | null;
  status?: string | null;
  source?: string | null;
  company?: string | null;
  second_name?: string | null;
  requirements?: string | null;
  min_budget?: number | null;
  max_budget?: number | null;
  areas_of_interest?: string[] | null;
  property_interests?: string[] | null;
  last_contacted_at?: string | null;
}

export interface FieldDifference {
  label: string;
  values: string[];
  /** Every record holds a value and they disagree. */
  conflict: boolean;
}

const FIELDS: { key: keyof ComparableContact; label: string }[] = [
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email' },
  { key: 'classification', label: 'Classification' },
  { key: 'status', label: 'Status' },
  { key: 'source', label: 'Source' },
  { key: 'company', label: 'Company' },
  { key: 'second_name', label: 'Second name' },
  { key: 'min_budget', label: 'Min budget' },
  { key: 'max_budget', label: 'Max budget' },
  { key: 'areas_of_interest', label: 'Areas of interest' },
  { key: 'property_interests', label: 'Property interests' },
  { key: 'requirements', label: 'Requirements' },
  { key: 'last_contacted_at', label: 'Last contacted' },
];

// toFixed always leaves two decimals, so trim what they do not earn:
// 14.70 → 14.7, 15.00 → 15. Safe only because the decimal point is
// always present, which keeps this off the integer digits.
function trimZeros(value: number): string {
  return value.toFixed(2).replace(/\.?0+$/, '');
}

function formatBudget(value: number): string {
  if (value >= 1e7) return `₹${trimZeros(value / 1e7)} Cr`;
  if (value >= 1e5) return `₹${trimZeros(value / 1e5)} L`;
  return `₹${value.toLocaleString('en-IN')}`;
}

function display(key: keyof ComparableContact, value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  if (Array.isArray(value)) return value.length ? value.join(', ') : '';
  if (key === 'min_budget' || key === 'max_budget') return formatBudget(Number(value));
  if (key === 'last_contacted_at') {
    return new Date(String(value)).toLocaleDateString('en-IN');
  }
  return String(value);
}

/**
 * What differs between the records offered as one person.
 *
 * Two shapes of difference read very differently to whoever is deciding.
 * One record holding a budget the other lacks is the case *for* merging —
 * the union is richer than either side. Both holding a budget and
 * disagreeing is the case against, and a name group that pairs an Owner
 * with a Buyer is the shape of a mistake, not of a duplicate. Only
 * fields that actually differ are returned; matching ones are not a
 * discrepancy and would bury the ones that are.
 */
export function diffContacts(contacts: ComparableContact[]): FieldDifference[] {
  if (contacts.length < 2) return [];

  const differences: FieldDifference[] = [];
  for (const { key, label } of FIELDS) {
    const values = contacts.map((c) => display(key, c[key]));
    const present = values.filter((v) => v !== '');
    if (present.length === 0) continue;
    if (new Set(values).size === 1) continue;
    differences.push({
      label,
      values,
      conflict: present.length === contacts.length && new Set(present).size > 1,
    });
  }
  return differences;
}
