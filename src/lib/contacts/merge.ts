import { phoneMatchKey } from '@/lib/contacts/duplicate-key';

export interface MergeableContactProfile {
  phone: string | null;
  secondary_phones: string[] | null;
  email: string | null;
  company: string | null;
  lead_temp: string | null;
  source: string | null;
  classification: string | null;
  referrer: string | null;
  referrer_contact_id: string | null;
  assigned_agent_id: string | null;
  assigned_team_id: string | null;
  min_budget: number | null;
  max_budget: number | null;
  no_budget: boolean | null;
  min_roi: number | null;
  areas_of_interest: string[] | null;
  property_interests: string[] | null;
  requirements: string | null;
}

function unionStrings(
  target: string[] | null,
  source: string[] | null
): string[] {
  return Array.from(new Set([...(target ?? []), ...(source ?? [])])).filter(
    Boolean
  );
}

export function mergeSecondaryPhones(
  targetPhone: string | null,
  targetSecondary: string[] | null,
  sourcePhone: string | null,
  sourceSecondary: string[] | null
): string[] {
  const primaryKey = phoneMatchKey(targetPhone);
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const raw of [
    ...(targetSecondary ?? []),
    sourcePhone,
    ...(sourceSecondary ?? []),
  ]) {
    const phone = raw?.trim();
    if (!phone) continue;
    const key = phoneMatchKey(phone) ?? phone;
    if (key === primaryKey || seen.has(key)) continue;
    seen.add(key);
    merged.push(phone);
  }

  return merged;
}

export function buildContactMergePatch(
  source: MergeableContactProfile,
  target: MergeableContactProfile,
  updatedAt: string
): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    updated_at: updatedAt,
    secondary_phones: mergeSecondaryPhones(
      target.phone,
      target.secondary_phones,
      source.phone,
      source.secondary_phones
    ),
  };

  if (!target.email && source.email) patch.email = source.email;
  if (!target.company && source.company) patch.company = source.company;
  if (!target.lead_temp && source.lead_temp) patch.lead_temp = source.lead_temp;
  if (!target.source && source.source) patch.source = source.source;
  if (
    (!target.classification || target.classification === 'Others') &&
    source.classification &&
    source.classification !== 'Others'
  ) {
    patch.classification = source.classification;
  }
  if (!target.referrer && source.referrer) patch.referrer = source.referrer;
  if (!target.referrer_contact_id && source.referrer_contact_id) {
    patch.referrer_contact_id = source.referrer_contact_id;
  }
  if (!target.assigned_agent_id && source.assigned_agent_id) {
    patch.assigned_agent_id = source.assigned_agent_id;
  }
  if (!target.assigned_team_id && source.assigned_team_id) {
    patch.assigned_team_id = source.assigned_team_id;
  }
  if (!target.min_budget && source.min_budget)
    patch.min_budget = source.min_budget;
  if (!target.max_budget && source.max_budget)
    patch.max_budget = source.max_budget;
  if (target.no_budget == null && source.no_budget != null) {
    patch.no_budget = source.no_budget;
  }
  if (!target.min_roi && source.min_roi) patch.min_roi = source.min_roi;

  const areas = unionStrings(
    target.areas_of_interest,
    source.areas_of_interest
  );
  if (areas.length > 0) patch.areas_of_interest = areas;

  const interests = unionStrings(
    target.property_interests,
    source.property_interests
  );
  if (interests.length > 0) patch.property_interests = interests;

  let requirements = target.requirements?.trim() ?? '';
  const sourceRequirements = source.requirements?.trim() ?? '';
  if (sourceRequirements && !requirements.includes(sourceRequirements)) {
    requirements = requirements
      ? `${requirements}\n${sourceRequirements}`
      : sourceRequirements;
  }
  if (requirements) patch.requirements = requirements;

  return patch;
}
