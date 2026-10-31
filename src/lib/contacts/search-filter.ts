import { ilikeAcross, ilikeTerm } from '../postgrest-search';

/**
 * The free-text branch of a contacts search, as PostgREST `.or()` filters.
 * Web (`list-queries.ts`) and the mobile Contacts tab both build their
 * search from this, through `@shared/` on mobile, so it must stay free of
 * package imports.
 */

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
