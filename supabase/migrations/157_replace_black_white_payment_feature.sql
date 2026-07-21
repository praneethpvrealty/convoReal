-- ============================================================
-- Replace the legally-loaded "black and white payment" phrasing in
-- property features (part-cash / part-cheque) with the neutral
-- "Mixed payment terms". Matches the AI-extraction normalization in
-- src/lib/ai/gemini.ts (normalizeListingFeatures), so existing listings
-- and future WhatsApp-parsed ones use the same label.
--
-- Order is preserved (WITH ORDINALITY); only rows that actually contain
-- the phrase are rewritten.
-- ============================================================

UPDATE properties
SET features = (
  SELECT array_agg(
    CASE
      WHEN lower(f) ~ 'black\s*(and|&|n)\s*white' THEN 'Mixed payment terms'
      ELSE f
    END
    ORDER BY ord
  )
  FROM unnest(features) WITH ORDINALITY AS t(f, ord)
),
updated_at = NOW()
WHERE features IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM unnest(features) AS f
    WHERE lower(f) ~ 'black\s*(and|&|n)\s*white'
  );
