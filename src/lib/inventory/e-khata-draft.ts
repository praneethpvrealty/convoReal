import type { ParsedPropertyDraft } from '@/lib/ai/gemini';

import {
  eKhataCity,
  eKhataDimensions,
  type EKhataFields,
} from './e-khata-fields';

export function eKhataDraftValues(
  fields: EKhataFields
): Partial<ParsedPropertyDraft> {
  const values: Partial<ParsedPropertyDraft> = {};
  if (fields.address) values.location = fields.address;
  const city = eKhataCity(fields);
  if (city) {
    values.city = city;
    values.state = 'Karnataka';
  }
  if (fields.latitude !== undefined && fields.longitude !== undefined) {
    const link = `https://www.google.com/maps?q=${fields.latitude},${fields.longitude}`;
    values.latitude = fields.latitude;
    values.longitude = fields.longitude;
    values.google_map_link = link;
    values.geo_resolved_from = link;
  }
  if (fields.site_area_sqft) {
    values.land_area = fields.site_area_sqft;
    values.land_area_unit = 'Sq.Ft.';
  }
  const dimensions = eKhataDimensions(fields);
  if (dimensions) values.dimensions = dimensions;
  if (fields.built_up_sqft) values.area_sqft = fields.built_up_sqft;
  if (fields.epid) values.khata_epid = fields.epid;
  if (fields.khata_form) values.khata_form = fields.khata_form;
  if (fields.year_built) values.year_built = fields.year_built;
  if (fields.ward || fields.ownership_type) {
    values.title = [fields.ownership_type || 'Property', fields.ward]
      .filter(Boolean)
      .join(' in ');
  }
  return values;
}

function isEmpty(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  );
}

/**
 * Merge an e-Khata into a WhatsApp listing draft. `prefer_khata` is for a
 * draft opened by the e-Khata itself, where the municipal record beats
 * the generic read of the same file; `fill_gaps` is for an e-Khata sent
 * into a draft already under way, where nothing the agent has given is
 * overwritten. A title is only ever supplied, never replaced.
 */
export function applyEKhataToDraft(
  draft: ParsedPropertyDraft,
  fields: EKhataFields,
  mode: 'prefer_khata' | 'fill_gaps'
): ParsedPropertyDraft {
  const next = { ...draft } as Record<string, unknown>;
  for (const [key, value] of Object.entries(eKhataDraftValues(fields))) {
    const replace =
      key === 'title' || mode === 'fill_gaps' ? isEmpty(next[key]) : true;
    if (replace) next[key] = value;
  }
  if (mode === 'fill_gaps' && !isEmpty(draft.latitude)) {
    next.google_map_link = draft.google_map_link;
    next.geo_resolved_from = draft.geo_resolved_from;
    next.latitude = draft.latitude;
    next.longitude = draft.longitude;
  }
  return next as unknown as ParsedPropertyDraft;
}
