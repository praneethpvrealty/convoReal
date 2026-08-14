-- ============================================================
-- Clear the yield stored against listings that cannot have one.
--
-- `properties.roi` was computed as rental_income * 12 / price by every
-- writer. For a Rent or Built to Suit listing `price` holds the MONTHLY
-- rent, so a ₹15.5 L/month office stored 1200% and showed it on the
-- detail screen; a JV/JD deal has no asking price to divide by at all.
--
-- src/lib/inventory/rental-yield.ts is now the single rule and both
-- write routes derive `roi` from it, so this only has to clean up the
-- rows written before that.
-- ============================================================

UPDATE properties
SET roi = NULL
WHERE roi IS NOT NULL
  AND listing_type IN ('Rent', 'Built to Suit', 'JV/JD');
