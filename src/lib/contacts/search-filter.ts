import { ilikeAcross, ilikeTerm } from '../postgrest-search';

export const CONTACT_SEARCH_COLUMNS = [
  'name',
  'second_name',
  'name_tag',
  'phone',
  'email',
  'company',
  'source',
  'requirements',
  'classification',
];

export function contactTextSearchFilters(raw: string): string[] {
  const term = ilikeTerm(raw);
  if (!term) return [];
  const filters = [ilikeAcross(CONTACT_SEARCH_COLUMNS, term)];
  const element = term.replace(/['{}]/g, '').trim();
  if (element) filters.push(`secondary_phones.cs.{"${element}"}`);
  const digits = raw.replace(/\D/g, '');
  if (digits.length >= 4 && digits !== term) {
    filters.push(`phone.ilike."%${digits}%"`);
  }
  return filters;
}
