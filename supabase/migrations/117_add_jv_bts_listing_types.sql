-- ============================================================
-- 117_add_jv_bts_listing_types.sql
--
-- Adds two new listing types alongside existing Sale/Rent:
--  - 'JV/JD'         Joint Venture / Joint Development: landowner
--                     contributes land, builder develops, proceeds
--                     shared per an agreed structure.
--  - 'Built to Suit'  Owner builds/fits out to an occupier's spec
--                     against a committed long-term lease.
--
-- Sale/Rent fields (price, rent_per_month, maintenance, advance, gst)
-- are reused where the semantics line up (advance = refundable
-- deposit for JV, security deposit for BTS; rent_per_month/maintenance
-- = expected rent/CAM for BTS). New columns below cover what's unique
-- to JV and BTS deals.
-- ============================================================

ALTER TABLE properties DROP CONSTRAINT IF EXISTS properties_listing_type_check;

ALTER TABLE properties
  ADD CONSTRAINT properties_listing_type_check
  CHECK (listing_type IN ('Sale', 'Rent', 'JV/JD', 'Built to Suit'));

ALTER TABLE properties
  -- JV/JD deal terms
  ADD COLUMN IF NOT EXISTS jv_structure TEXT CHECK (jv_structure IN ('Revenue Share', 'Area Share', 'Hybrid')),
  ADD COLUMN IF NOT EXISTS owner_share_percent NUMERIC,
  ADD COLUMN IF NOT EXISTS builder_share_percent NUMERIC,
  ADD COLUMN IF NOT EXISTS goodwill_amount NUMERIC,
  -- Built to Suit lease terms
  ADD COLUMN IF NOT EXISTS bts_lease_years NUMERIC,
  ADD COLUMN IF NOT EXISTS bts_lock_in_years NUMERIC,
  ADD COLUMN IF NOT EXISTS bts_escalation_percent NUMERIC;

COMMENT ON COLUMN properties.jv_structure IS
  'JV/JD deal structure: Revenue Share, Area Share, or Hybrid.';
COMMENT ON COLUMN properties.owner_share_percent IS
  'JV/JD: landowner''s share of revenue/area (%). owner_share_percent + builder_share_percent should sum to 100.';
COMMENT ON COLUMN properties.builder_share_percent IS
  'JV/JD: builder''s share of revenue/area (%).';
COMMENT ON COLUMN properties.goodwill_amount IS
  'JV/JD: non-refundable upfront goodwill payment to the landowner (INR).';
COMMENT ON COLUMN properties.bts_lease_years IS
  'Built to Suit: total committed lease term in years.';
COMMENT ON COLUMN properties.bts_lock_in_years IS
  'Built to Suit: lock-in period in years (must be <= bts_lease_years).';
COMMENT ON COLUMN properties.bts_escalation_percent IS
  'Built to Suit: agreed rent escalation percentage (e.g. 5%/yr or 15% every 3 years).';

-- Contact-side: AI-extracted / explicit listing intent, consumed by the
-- matching engine (src/lib/matching.ts) as a hard gate ahead of type
-- matching. Values: 'Sale' | 'Rent' | 'JV/JD' | 'Built to Suit'.
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS pref_listing_types TEXT[];

COMMENT ON COLUMN contacts.pref_listing_types IS
  'AI-extracted / inferred listing intent(s) the contact is looking for: Sale, Rent, JV/JD, Built to Suit. Used as a hard gate in matching so a buyer never surfaces as a match for a JV/BTS deal without stated intent.';
