-- ============================================================
-- Anchor the enquiry-seeded budgets written before
-- 20261004131500_pref_budget_anchor existed.
--
-- A contact qualifies when its only budget is a pref_budget_max within
-- 15% of the price of a listing it enquired about (the tolerance the
-- lead webhook uses to tie an enquiry to a listing) and no learned
-- fact ever filed that budget from the contact's own words.
--
-- Also drops contacts_inquired_prices, created by an earlier revision
-- of the same change and never read by deployed code.
-- ============================================================

UPDATE public.contacts AS c
SET pref_budget_anchor = c.pref_budget_max
WHERE c.pref_budget_anchor IS NULL
  AND c.pref_budget_max IS NOT NULL
  AND c.max_budget IS NULL
  AND c.pref_budget_min IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.contact_property_inquiries AS i
    JOIN public.properties AS p ON p.id = i.property_id
    WHERE i.contact_id = c.id
      AND i.account_id = c.account_id
      AND p.price > 0
      AND ABS(p.price - c.pref_budget_max) <= p.price * 0.15
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.learned_facts AS f
    WHERE f.entity_id = c.id
      AND f.entity_type = 'contact'
      AND f.field = 'pref_budget_max'
  );

DROP FUNCTION IF EXISTS public.contacts_inquired_prices(UUID, UUID[]);
