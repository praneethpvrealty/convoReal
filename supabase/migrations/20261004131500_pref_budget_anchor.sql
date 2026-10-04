-- ============================================================
-- Where a contact's pref_budget_max came from.
--
-- The portal lead webhook (src/app/api/leads/email-webhook) seeds
-- pref_budget_max from the price of the listing a lead enquired
-- about. That is a ceiling the lead was willing to look at, not a
-- budget they stated, so src/lib/matching.ts must not imply a floor at
-- half of it: a ₹14.7 Cr enquirer who then asked for Horamavu was shown
-- nothing there under ₹7.35 Cr.
--
-- The webhook records the value it seeded here. While pref_budget_max
-- still equals it the budget is the enquiry's; a budget the lead states
-- afterwards replaces pref_budget_max and the two no longer agree.
-- Nullable and unread by anything already deployed.
-- ============================================================

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS pref_budget_anchor NUMERIC;

COMMENT ON COLUMN public.contacts.pref_budget_anchor IS
  'pref_budget_max as seeded from an enquired listing''s price by the portal lead webhook. Matching reads a budget equal to it as a ceiling with no implied floor.';
