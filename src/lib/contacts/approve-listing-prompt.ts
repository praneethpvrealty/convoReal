export interface ApproveListingPrompt {
  title: string;
  message: string;
  pickLabel: string;
  skipLabel: string;
}

interface PendingLead {
  last_inquired_property_id?: string | null;
  source?: string | null;
  areas_of_interest?: string[] | null;
  pref_areas?: string[] | null;
}

export function approveListingPrompt(
  contact: PendingLead
): ApproveListingPrompt | null {
  if (contact.last_inquired_property_id) return null;
  const named = [
    ...(contact.areas_of_interest ?? []),
    ...(contact.pref_areas ?? []),
  ]
    .map((area) => area.trim())
    .find(Boolean);
  const from = contact.source?.trim();
  const enquiry = named
    ? `Their ${from ? `${from} ` : ''}enquiry names "${named}", but no listing is linked to this lead.`
    : 'No listing is linked to this lead.';
  return {
    title: 'Which listing did they enquire about?',
    message: `${enquiry} Pick it and they are sent its details on approval, or approve without one and nothing is sent.`,
    pickLabel: 'Pick a listing',
    skipLabel: 'Approve without a listing',
  };
}
