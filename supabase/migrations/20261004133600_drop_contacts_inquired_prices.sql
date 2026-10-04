-- ============================================================
-- Drop contacts_inquired_prices.
--
-- An earlier revision of the INB-029 change applied it to infer an
-- enquiry-seeded budget from enquired listing prices. The stored
-- contacts.pref_budget_anchor (migration 20261004131500) replaced that
-- inference before any deployed code read the function.
--
-- No backfill accompanies the anchor: nothing recorded whether a
-- legacy pref_budget_max came from the lead webhook or from the
-- preference extractor, and inferring it from prices would reclassify
-- stated budgets. Legacy budgets keep their implied floor; budgets the
-- webhook seeds from now on carry the anchor.
-- ============================================================

DROP FUNCTION IF EXISTS public.contacts_inquired_prices(UUID, UUID[]);
