-- ============================================================
-- 215_property_seller_final_price.sql
--
-- A listing carries two prices, and conflating them loses the one that
-- closes deals.
--
-- `price` is the LISTING/QUOTE price — what the property is advertised
-- at, what the showcase renders, what a share card quotes. It is the
-- only price a public surface may ever see.
--
-- `seller_final_price` is what the seller will actually accept. It is
-- learned late, usually in a WhatsApp thread ("seller's final price is
-- 10.5k per sqft"), and until now it lived only in that bubble: the
-- next buyer asking the same question got the sticker price or a
-- handover, and the agent retyped the answer.
--
-- Land and plots are quoted per Sq.Ft. as often as in total, and an
-- agent will state whichever one the seller gave them, so both are
-- stored. Neither is derived from the other here — area is not always
-- known, and inventing the total from a rate would put a number the
-- seller never said in front of a buyer.
--
-- Internal by construction: PUBLIC_PROPERTY_FIELDS and
-- DEN_PROPERTY_SELECT are allowlists, so a new column reaches no
-- external viewer until someone adds it there deliberately.
-- ============================================================

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS seller_final_price NUMERIC,
  ADD COLUMN IF NOT EXISTS seller_final_price_per_sqft NUMERIC,
  ADD COLUMN IF NOT EXISTS seller_final_price_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS seller_final_price_source TEXT;

ALTER TABLE properties
  DROP CONSTRAINT IF EXISTS properties_seller_final_price_source_check;
ALTER TABLE properties
  ADD CONSTRAINT properties_seller_final_price_source_check
  CHECK (seller_final_price_source IS NULL OR seller_final_price_source IN ('manual', 'chat'));

COMMENT ON COLUMN properties.price IS
  'Listing/quote price — the advertised figure. The only price a public surface may show.';
COMMENT ON COLUMN properties.seller_final_price IS
  'Lowest total the seller will accept. Internal: excluded from PUBLIC_PROPERTY_FIELDS and DEN_PROPERTY_SELECT.';
COMMENT ON COLUMN properties.seller_final_price_per_sqft IS
  'Lowest per-Sq.Ft. rate the seller will accept. Internal.';
COMMENT ON COLUMN properties.seller_final_price_source IS
  'How the final price was captured: manual (an agent typed it into the form) or chat (learned from a WhatsApp reply and approved).';
