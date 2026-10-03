// Scoped to what the table row, edit form, and delete/WhatsApp actions
// actually read — dropping `requirements` (free text) and other unused
// columns cuts payload size meaningfully at 25 rows/page. `.or()` search
// filters below reference DB columns directly, so they still work even
// though `requirements` isn't in the returned shape.
//
// buyer_alerts_consent(+_requested_at) are carried even though
// the list never renders them: the edit form opens from this
// row, and a consent control fed an absent value would show
// every contact as "Not asked yet" — a wrong answer to a
// compliance question, which is worse than a slightly larger page.
export const CONTACT_LIST_COLUMNS =
  'id, user_id, name, name_tag, phone, email, company, classification, avatar_url, lead_temp, last_contacted_at, last_inquired_property_id, referrer, referrer_contact_id, min_budget, max_budget, no_budget, areas_of_interest, property_interests, requirement_profiles, is_favorite, min_roi, source, status, is_dead, dead_reason, is_archived, created_at, updated_at, pref_budget_max, pref_areas, pref_property_categories, pref_property_types, buyer_alerts_consent, buyer_alerts_consent_requested_at';
